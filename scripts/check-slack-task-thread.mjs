import assert from "node:assert/strict";
import { isSlackTaskThread, postTaskSlackMessage } from "../dist/slack-task-thread.js";

const binding = { agentId: "coding", channelId: "C123", userIds: ["U123"], status: "ready", threadTs: "100.001" };
assert.equal(isSlackTaskThread(binding), true);
assert.equal(isSlackTaskThread({ ...binding, input: { runId: "run", status: "sent", messageTs: "100.002" } }), true);
for (const value of [null, { ...binding, threadTs: "" }, { ...binding, userIds: [] },
  { ...binding, input: { runId: "run", status: "sent" } }]) assert.equal(isSlackTaskThread(value), false);
let calls = 0;
const request = async (url, options) => {
  calls += 1;
  assert.equal(url, "https://slack.com/api/chat.postMessage");
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, "Bearer xoxb-fixture");
  const body = JSON.parse(options.body);
  assert.equal(body.channel, "C123");
  assert.equal(body.thread_ts, "100.001");
  assert.equal(body.blocks[0].text.type, "plain_text");
  assert.ok(body.blocks.every(block => block.text.text.length <= 2_500));
  assert.equal(body.unfurl_links, false);
  return { ok: true, json: async () => ({ ok: true, channel: "C123", ts: "100.002" }) };
};
assert.equal(await postTaskSlackMessage("C123", "<!channel>" + "x".repeat(4_000), "100.001", async () => "xoxb-fixture", request), "100.002");
assert.equal(calls, 1);
for (const response of [{ ok: false, error: "secret-error" }, { ok: true, channel: "C999", ts: "100.001" },
  { ok: true, channel: "C123", ts: "bad" }]) {
  let attempts = 0;
  await assert.rejects(postTaskSlackMessage("C123", "Question", undefined, async () => "xoxb-fixture", async () => {
    attempts += 1; return { ok: true, json: async () => response };
  }), error => !error.message.includes("secret-error"));
  assert.equal(attempts, 1, "Uncertain delivery must not automatically retry");
}
await assert.rejects(postTaskSlackMessage("C123", "Question", undefined, async () => { throw new Error("secret-path"); }, request),
  error => !error.message.includes("secret-path"));
console.log("Slack task thread message and metadata fixtures passed.");
