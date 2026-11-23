import assert from "node:assert/strict";
import { parseSlackTaskReply, authorizesSlackTaskReply, isReplyAfterSlackConnection } from "../dist/slack-task-reply.js";

const event = { channel: "slack", senderId: "U123", messageId: "100.000003", content: "Proceed" };
const context = { channelId: "slack", accountId: "default", senderId: "U123", messageId: "100.000003",
  sessionKey: "agent:main:slack:channel:C123:thread:100.000001" };
const reply = parseSlackTaskReply(event, context);
assert.equal(reply.channelId, "C123");
const thread = { channelId: "C123", agentId: "coding", userIds: ["U123"], threadTs: "100.000001", status: "ready",
  input: { runId: "run", status: "sent", messageTs: "100.000002" } };
assert.equal(authorizesSlackTaskReply(thread, reply, "run"), true);
for (const [input, host] of [
  [{ ...event, senderId: "U999" }, context],
  [event, { ...context, accountId: "other" }],
  [event, { ...context, sessionKey: "agent:main:slack:channel:C123" }],
  [{ ...event, content: "x".repeat(16_001) }, context],
  [{ ...event, messageId: "bad" }, { ...context, messageId: "bad" }],
  [{ ...event, channel: "webchat" }, context],
]) assert.equal(parseSlackTaskReply(input, host), undefined);
for (const changed of [
  { ...thread, userIds: ["U999"] }, { ...thread, channelId: "C999" }, { ...thread, threadTs: "100.000009" },
  { ...thread, input: { ...thread.input, runId: "other-run" } },
  { ...thread, input: { ...thread.input, status: "failed" } },
  { ...thread, acceptedReplyTs: reply.messageTs },
]) assert.equal(authorizesSlackTaskReply(changed, reply, "run"), false);
assert.equal(authorizesSlackTaskReply(thread, { ...reply, messageTs: "100.000001" }, "run"), false);
assert.equal(authorizesSlackTaskReply({ ...thread, input: { ...thread.input, messageTs: "100.10" } },
  { ...reply, messageTs: "100.2" }, "run"), true, "Timestamp comparison must be decimal, not lexical");
assert.equal(isReplyAfterSlackConnection(reply, 100_000), true);
assert.equal(isReplyAfterSlackConnection(reply, 101_000), false);
assert.equal(isReplyAfterSlackConnection(reply, undefined), false);
console.log("Slack task reply identity, authorization, replay and reconnect fixtures passed.");

assert.equal(parseSlackTaskReply(event, { ...context, sessionKey: context.sessionKey.toLowerCase() }).channelId, "C123",
  "The pinned runtime canonicalizes Slack session keys to lowercase");
