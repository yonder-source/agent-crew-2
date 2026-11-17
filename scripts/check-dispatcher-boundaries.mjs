import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(process.env.DISPATCHER_SOURCE ?? "dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
let session = null;
let calls = [];
const tools = new Map();
let resolve;
const context = createContext({
  createHash, randomUUID, process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
  Type: new Proxy({}, { get: () => () => ({}) }),
  parseConfig: () => ({ environment: "test" }), definePluginEntry: (entry) => entry,
  callGatewayFromCli: async (method, _options, params) => {
    calls.push(method);
    if (method === "sessions.describe") return { session };
    if (method === "sessions.create") { session = { pluginExtensions: [] }; return {}; }
    if (method === "sessions.pluginPatch") {
      session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: params.value }];
      return {};
    }
    if (method === "tools.invoke") return { ok: true, output: { details: {
      ok: true, status: "needs_approval", requiresApproval: { resumeToken: "SECRET-CONTINUATION" },
    } } };
    throw new Error(`Unexpected method: ${method}`);
  },
});
runInContext(source, context);
context.entry.register({
  session: { state: { registerSessionExtension() {} } },
  registerTool: (tool) => tools.set(tool.name, tool),
  registerGatewayMethod: (_name, handler) => { resolve = handler; },
});
const params = { repository: "owner/repo", issueNumber: 1 };
const dispatch = () => tools.get("agent_crew_dispatch").execute("test", params);
const status = () => tools.get("agent_crew_status").execute("test", params);
const safe = (value) => assert.ok(!JSON.stringify(value).includes("SECRET-CONTINUATION"));
safe(await dispatch());
assert.equal(calls.filter((method) => method === "sessions.describe").length, 1);
assert.equal(session.pluginExtensions[0].value.workflowRef, "SECRET-CONTINUATION");
safe(await status());
safe(await dispatch());
session.pluginExtensions[0].value.status = "needs-inspection";
let resolution;
await resolve({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, value) => { assert.equal(ok, true); resolution = value; } });
safe(resolution);
const validJob = session.pluginExtensions[0].value;
for (const state of ["starting", "active", "completed", "needs-inspection", "abandoned"]) {
  session.pluginExtensions[0].value = { ...validJob, status: state };
  calls = [];
  assert.equal((await dispatch()).details.status, state);
  assert.deepEqual(calls, ["sessions.describe"], `${state} must block another start`);
}
session.pluginExtensions[0].value = { ...validJob, status: "retry-approved" };
calls = [];
await dispatch();
assert.equal(calls.filter((method) => method === "tools.invoke").length, 1);
for (const patch of [
  { repository: "other/repo" }, { number: 2 }, { sessionKey: "other" },
  { jobId: null }, { bootId: 0 }, { updatedAt: false }, { status: "unknown" },
  { workflowRef: {} }, { workflowStatus: [] }, { error: 1 }, { decision: null },
]) {
  session.pluginExtensions[0].value = { ...validJob, ...patch };
  calls = [];
  await assert.rejects(dispatch(), /Invalid issue admission metadata/);
  assert.deepEqual(calls, ["sessions.describe"]);
  await assert.rejects(status(), /Invalid issue admission metadata/);
}
for (const malformed of [undefined, false, [], { pluginExtensions: {} },
  { pluginExtensions: [null] }, { pluginExtensions: [{ pluginId: 1, namespace: "x" }] }]) {
  session = malformed;
  calls = [];
  await assert.rejects(dispatch(), /Invalid/);
  assert.deepEqual(calls, ["sessions.describe"]);
  await assert.rejects(status(), /Invalid/);
}
session = {};
calls = [];
safe(await dispatch());
assert.equal(calls.filter((method) => method === "sessions.describe").length, 1);
assert.ok(!calls.includes("sessions.create"));
console.log("Dispatcher boundary checks passed (mock Gateway; no runtime qualification)");
