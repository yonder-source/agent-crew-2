import type { SlackTaskThread } from "./slack-task-thread.js";

export type SlackTaskReply = { channelId: string; threadTs: string; messageTs: string; userId: string; text: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{1,20}\.\d{1,9}$/.test(value);

// Identity comes only from the host's authenticated channel context, never message text.
export function parseSlackTaskReply(event: unknown, context: unknown): SlackTaskReply | undefined {
  if (!record(event) || !record(context) || event.channel !== "slack" || context.channelId !== "slack" ||
      context.accountId !== "default" || typeof context.sessionKey !== "string" ||
      typeof context.senderId !== "string" || !/^[UW][A-Z0-9]+$/.test(context.senderId) ||
      event.senderId !== context.senderId || event.messageId !== context.messageId || !timestamp(context.messageId) ||
      typeof event.content !== "string" || !event.content.trim() || event.content.length > 16_000) return undefined;
  const match = /^agent:[a-z][a-z0-9_-]*:slack:channel:([CG][A-Z0-9]+):thread:(\d{1,20}\.\d{1,9})$/.exec(context.sessionKey);
  if (!match?.[1] || !match[2]) return undefined;
  return { channelId: match[1], threadTs: match[2], messageTs: context.messageId,
    userId: context.senderId, text: event.content };
}

const at = (value: string): bigint => {
  const [seconds = "", fraction = ""] = value.split(".");
  return BigInt(seconds) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
};

export function authorizesSlackTaskReply(thread: SlackTaskThread, reply: SlackTaskReply, runId: string): boolean {
  return thread.status === "ready" && thread.channelId === reply.channelId && thread.threadTs === reply.threadTs &&
    thread.userIds.includes(reply.userId) && thread.input?.status === "sent" && thread.input.runId === runId &&
    timestamp(thread.input.messageTs) && timestamp(reply.messageTs) && at(reply.messageTs) > at(thread.input.messageTs) &&
    (thread.acceptedReplyTs === undefined || (timestamp(thread.acceptedReplyTs) && at(reply.messageTs) > at(thread.acceptedReplyTs)));
}

export function isReplyAfterSlackConnection(reply: SlackTaskReply, connectedAt: unknown): boolean {
  return typeof connectedAt === "number" && Number.isSafeInteger(connectedAt) && connectedAt >= 0 &&
    timestamp(reply.messageTs) && at(reply.messageTs) >= BigInt(connectedAt) * 1_000_000n;
}
