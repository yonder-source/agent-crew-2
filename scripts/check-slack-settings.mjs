import assert from "node:assert/strict";
import { draftSlackSettings, validateSlackSettings } from "../dist/slack-settings.js";
import { parseConfig, parseSlackSettings } from "../src/config.mjs";
import { connectionConfig } from "../dist/setup-config.js";

const draft = { codingAgentId: "coding", designerAgentId: "designer", codingChannelId: "C123",
  designerChannelId: "G456", codingUserIds: "U2, U1 U2", designerUserIds: "U1" };
const settings = draftSlackSettings(draft);
assert.deepEqual(settings.coding.userIds, ["U1", "U2"]);
assert.deepEqual(parseConfig({ environment: "test", slack: settings }).slack, settings);
for (const field of ["codingChannelId", "codingUserIds", "designerAgentId"]) {
  assert.throws(() => draftSlackSettings({ ...draft, [field]: "" }));
}
for (const value of [null, [], { other: {} }, { coding: { ...settings.coding, userIds: ["xoxb-secret"] } }]) {
  assert.throws(() => parseSlackSettings(value));
}
const calls = [];
const request = async (url, options) => {
  const endpoint = new URL(url);
  calls.push(endpoint);
  assert.equal(options.headers.Authorization, "Bearer xoxb-fixture");
  assert.equal(options.redirect, "error");
  const id = endpoint.searchParams.get("user");
  return { ok: true, json: async () => id ? { ok: true, user: { id, deleted: false, is_bot: false, is_app_user: false } }
    : { ok: true, channel: { id: endpoint.searchParams.get("channel"), is_member: true, is_archived: false } } };
};
const checks = await validateSlackSettings(settings, async () => "xoxb-fixture", request);
assert.equal(checks.length, 4);
assert.ok(checks.every(check => check.status === "passed"));
assert.equal(calls.filter(url => url.pathname.endsWith("users.info")).length, 2, "Shared users are checked once");
for (const response of [
  { ok: true, channel: { id: "C123", is_member: false, is_archived: false } },
  { ok: true, channel: { id: "C123", is_member: true, is_archived: true } },
  { ok: true, user: { id: "U1", deleted: true, is_bot: false } },
  { ok: true, user: { id: "U1", deleted: false, is_bot: false, is_app_user: true } },
  { ok: true, user: { id: "U1", deleted: false, is_bot: false } },
  { ok: false, error: "xoxb-secret-provider-error" },
]) {
  const result = await validateSlackSettings(settings, async () => "xoxb-fixture",
    async () => ({ ok: true, json: async () => response }));
  assert.ok(result.some(check => check.status === "failed"));
  assert.ok(!JSON.stringify(result).includes("xoxb-secret"));
}
const missing = await validateSlackSettings(settings, async () => { throw new Error("secret-path"); }, request);
assert.equal(missing[0].status, "failed");
assert.ok(!JSON.stringify(missing).includes("secret-path"));
const snapshot = { hash: "revision", config: { channels: { slack: { groupPolicy: "disabled" } },
  plugins: { entries: { "agent-crew": { config: { environment: "test" } } } } } };
const replacement = connectionConfig(snapshot, { repository: "owner/repo", appId: "123", installationId: 1,
  agentId: "coding", repositoryPath: "/repo", pollIntervalMs: 30_000, slack: settings });
const config = JSON.parse(replacement.raw);
assert.deepEqual(config.plugins.entries["agent-crew"].config.slack, settings);
assert.equal(config.plugins.entries["agent-crew"].config.github.pollIntervalMs, 30_000);
assert.equal(config.channels.slack.groupPolicy, "disabled");
console.log("Slack settings validation and persistence checks passed.");
