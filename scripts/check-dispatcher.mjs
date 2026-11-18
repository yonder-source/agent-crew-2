import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const exec = promisify(execFile);
const compose = (...args) => exec("docker", ["compose", ...args], { timeout: 330_000, maxBuffer: 2_000_000 });
const inside = (...args) => compose("exec", "-T", "gateway", ...args);
const root = "/home/node/.openclaw/agent-crew-synthetic";
const issue = (issueNumber) => ({ repository: "synthetic/wbs2", issueNumber });
async function call(method, params) {
  const { stdout } = await inside("openclaw", "gateway", "call", method,
    "--token", "disposable-agent-crew-token", "--timeout", "120000", "--json", "--params", JSON.stringify(params));
  return JSON.parse(stdout);
}
async function tool(name, number) {
  const result = await call("tools.invoke", { name, args: issue(number) });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.output.details;
}
const dispatch = (number) => tool("agent_crew_dispatch", number);
const status = (number) => tool("agent_crew_status", number);
const resolve = (number, decision) => call("agent-crew.resolve", { ...issue(number), decision, note: "Synthetic operator inspected fixture" });
async function count() {
  const { stdout } = await inside("node", "-e", `const fs=require('node:fs'); const p=${JSON.stringify(root + ".starts")}; console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\\n').length:0)`);
  return Number(stdout.trim());
}
async function until(check) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await check()) return;
    await setTimeout(500);
  }
  throw new Error("Timed out waiting for synthetic workflow boundary");
}
async function ready() {
  await compose("up", "-d", "--wait", "--wait-timeout", "300", "gateway");
  await until(async () => {
    try { await call("health", {}); return true; } catch { return false; }
  });
}
async function waitForStopped() {
  const { stdout } = await compose("ps", "-a", "-q", "gateway");
  const containerId = stdout.trim();
  assert.ok(containerId, "Gateway container must exist after SIGKILL");
  const deadline = Date.now() + 30_000;
  let state;
  try {
    while (Date.now() < deadline) {
      const result = await exec("docker", ["inspect", "--format", "{{json .State}}", containerId],
        { timeout: Math.max(1, Math.min(5_000, deadline - Date.now())) });
      state = JSON.parse(result.stdout);
      if (state.Running === false && state.Restarting === false) return;
      await setTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
    }
    throw new Error("Timed out waiting for Gateway to stop after SIGKILL");
  } catch (error) {
    console.error("Gateway state after SIGKILL:", state);
    try {
      const logs = await compose("logs", "--tail", "100", "gateway");
      console.error(logs.stdout, logs.stderr);
    } catch (logError) {
      console.error("Could not read Gateway logs:", logError.message);
    }
    throw error;
  }
}
const hold = () => inside("touch", `${root}.hold`);
const release = () => inside("rm", "-f", `${root}.hold`);

assert.equal(await count(), 0, "Run in a fresh disposable Compose project");
console.log("Checking ordered synthetic starts and duplicates...");
await hold();
const first = dispatch(1);
await until(async () => await count() === 1);
assert.equal((await status(1)).status, "starting");
const duplicate = dispatch(1);
const second = dispatch(2);
await setTimeout(2000);
assert.equal(await count(), 1, "Second issue must wait behind the first");
assert.equal((await status(2)).status, "not-started");
await release();
const [a, duplicateA, b] = await Promise.all([first, duplicate, second]);
assert.equal(a.status, "completed");
assert.equal(b.status, "completed");
assert.equal(duplicateA.job.jobId, a.job.jobId);
assert.notEqual(a.job.sessionKey, b.job.sessionKey);
assert.equal(await count(), 2);
const described = await call("sessions.describe", { key: a.job.sessionKey });
assert.ok(described.session.sessionId, "Native session must exist");
assert.equal(described.session.pluginExtensions.find((x) => x.pluginId === "agent-crew" && x.namespace === "agent-crew-job").value.jobId, a.job.jobId);

console.log("Checking real crash recovery and explicit retry...");
await hold();
const interrupted = dispatch(3).catch(() => undefined);
await until(async () => await count() === 3);
const starting = await status(3);
assert.equal(starting.status, "starting");
// A real process interruption after admission persistence and before result storage.
await compose("kill", "-s", "SIGKILL", "gateway");
await waitForStopped();
await interrupted;
await ready();
assert.equal((await status(1)).job.jobId, a.job.jobId);
assert.equal((await dispatch(1)).status, "completed");
assert.equal((await status(3)).status, "needs-inspection");
assert.equal((await dispatch(3)).job.jobId, starting.job.jobId);
assert.equal(await count(), 3, "Restart must not relaunch uncertain work");
const beforeDenied = await status(3);
const lowScope = `
  import { callGatewayFromCli } from "/app/dist/plugin-sdk/gateway-runtime.js";
  const options = { url: "ws://127.0.0.1:18789", token: "disposable-agent-crew-token", timeout: "30000", json: true };
  const scope = { scopes: ["operator.read"] };
  await callGatewayFromCli("health", options, {}, scope);
  try {
    await callGatewayFromCli("agent-crew.resolve", options,
      ${JSON.stringify({ ...issue(3), decision: "retry", note: "low scope" })}, scope);
    process.exitCode = 1;
    console.error("Resolution unexpectedly succeeded with operator.read");
  } catch (error) {
    if (!String(error).includes("operator.admin")) throw error;
    console.log("Low-scope resolution denied");
  }
`;
const denied = await inside("node", "--input-type=module", "-e", lowScope);
assert.match(denied.stdout, /Low-scope resolution denied/);
assert.deepEqual(await status(3), beforeDenied);
assert.equal(await count(), 3);
await release();
assert.equal((await resolve(3, "retry")).job.status, "retry-approved");
await compose("restart", "gateway");
await ready();
assert.equal((await status(3)).status, "retry-approved");
const retried = await dispatch(3);
assert.equal(retried.status, "completed");
assert.notEqual(retried.job.jobId, starting.job.jobId);
assert.match(retried.job.decision, /^retry:/);
assert.equal(await count(), 4);

console.log("Checking abandonment persistence...");
await hold();
const abandonedRun = dispatch(4).catch(() => undefined);
await until(async () => await count() === 5);
await compose("kill", "-s", "SIGKILL", "gateway");
await waitForStopped();
await abandonedRun;
await ready();
assert.equal((await resolve(4, "abandon")).job.status, "abandoned");
await release();
await compose("restart", "gateway");
await ready();
assert.equal((await dispatch(4)).status, "abandoned");
assert.equal(await count(), 5);
console.log("Synthetic WBS2 native sessions, serialization, duplicate suppression, crash recovery and operator decisions passed.");
