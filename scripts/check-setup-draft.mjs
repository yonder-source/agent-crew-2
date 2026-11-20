import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { callGatewayFromCli } from "/app/dist/plugin-sdk/gateway-runtime.js";

const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? "disposable-agent-crew-token";
const draft = {
  githubAppId: "1234", repository: "fixture/repository",
  repositoryPath: "/workspaces/repositories/fixture/repository", codingAgentId: "coding",
  designerAgentId: "", codingChannelId: "C123", designerChannelId: "",
  codingUserIds: "U123", designerUserIds: "", tokenBudget: "10000",
};

function call(method, params = {}) {
  const result = spawnSync("openclaw", ["gateway", "call", method, "--token", token,
    "--json", "--params", JSON.stringify(params)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

if (!process.argv.includes("--verify-only")) {
  const catalog = call("plugins.controlUi.list");
  const plugin = catalog.plugins.find((item) => item.pluginId === "agent-crew");
  assert.ok(plugin?.entryUrl, "Agent Crew UI must be present in the Gateway catalog");
  assert.deepEqual(plugin.uiCapabilities, ["page", "navigation"]);
  assert.equal(plugin.styles.length, 1, "Agent Crew UI stylesheet must be advertised");
  const before = call("agent-crew.setup.draft.get");
  assert.equal(before.draft, null);
  assert.equal(call("agent-crew.setup.draft.save", { draft }).saved, true);
  const after = call("agent-crew.setup.draft.get");
  assert.deepEqual(after.current, before.current, "Saving a draft must not apply settings");
  const options = { url: "ws://127.0.0.1:18789", token, timeout: "30000", json: true };
  await assert.rejects(callGatewayFromCli("agent-crew.setup.draft.get", options, {},
    { scopes: ["operator.read"] }), /operator.admin/);
  await assert.rejects(callGatewayFromCli("agent-crew.setup.draft.save", options, { draft },
    { scopes: ["operator.read"] }), /operator.admin/);
  await assert.rejects(callGatewayFromCli("agent-crew.setup.draft.save", options,
    { draft: { ...draft, privateKey: "fixture" } }), /SETUP_DRAFT_SAVE_FAILED|could not be saved/);
}
assert.deepEqual(call("agent-crew.setup.draft.get").draft, draft);
console.log("Setup draft and operator scope checks passed.");
