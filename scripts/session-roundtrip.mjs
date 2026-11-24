import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const port = process.env.OPENCLAW_GATEWAY_PORT ?? "18789";
const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? "disposable-agent-crew-token";
const key = "agent:main:agent-crew-wbs1";
const value = {
  jobId: "synthetic-wbs1", status: "probe", sessionKey: key,
  repository: "fixture/repo", number: 7, workspacePath: "/fixture/task",
  workspaceBranch: "openclaw/agent-crew-issue-7", baseCommit: "a".repeat(40),
  codingDelivery: { status: "ready", headCommit: "b".repeat(40), validation: {
    status: "ok", checks: [{ command: "fixture-check", outcome: "ok", exitCode: 0 }],
  } },
};
const params = JSON.stringify({ key, pluginId: "agent-crew", namespace: "agent-crew-job", value });

function call(method, input = "{}") {
  const result = spawnSync("openclaw", ["gateway", "call", method, "--port", port, "--token", token, "--params", input, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || `${method} failed`);
  return JSON.parse(result.stdout);
}

const verifyOnly = process.argv.includes("--verify-only");
if (!verifyOnly) {
  const current = call("sessions.describe", JSON.stringify({ key }));
  if (!current.session) {
    call("sessions.create", JSON.stringify({ key }));
  }
  call("sessions.pluginPatch", params);
}
const { session } = call("sessions.describe", JSON.stringify({ key }));
assert.ok(session, "synthetic Gateway session was not found");
const extension = session.pluginExtensions?.find((item) => item.pluginId === "agent-crew" && item.namespace === "agent-crew-job");
assert.deepEqual(extension?.value, value);
console.log("Synthetic session metadata roundtrip passed.");
