import { SLACK_SECRET_PATHS } from "./slack-credentials.js";

export type SlackTaskThread = {
  agentId: string; channelId: string; userIds: string[];
  status: "creating" | "ready" | "failed";
  threadTs?: string;
  input?: { runId: string; status: "sending" | "sent" | "failed"; messageTs?: string };
};

const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function isSlackTaskThread(value: unknown): value is SlackTaskThread {
  if (!record(value) || typeof value.agentId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(value.agentId) ||
      typeof value.channelId !== "string" || !/^[CG][A-Z0-9]+$/.test(value.channelId) ||
      !Array.isArray(value.userIds) || value.userIds.length === 0 || value.userIds.length > 100 ||
      !value.userIds.every((id: unknown) => typeof id === "string" && /^[UW][A-Z0-9]+$/.test(id)) ||
      !["creating", "ready", "failed"].includes(String(value.status)) ||
      (value.threadTs !== undefined && !timestamp(value.threadTs)) ||
      (value.status === "ready" && !timestamp(value.threadTs))) return false;
  if (value.input === undefined) return true;
  return value.status === "ready" && record(value.input) && typeof value.input.runId === "string" &&
    value.input.runId.length > 0 && ["sending", "sent", "failed"].includes(String(value.input.status)) &&
    (value.input.messageTs === undefined || timestamp(value.input.messageTs)) &&
    (value.input.status !== "sent" || timestamp(value.input.messageTs));
}

// One fixed write endpoint, one attempt. A lost acknowledgement is not retried.
export async function postTaskSlackMessage(channelId: string, text: string, threadTs: string | undefined,
  readSecret: (path: string) => Promise<string>, request: typeof fetch = fetch): Promise<string> {
  try {
    if (!/^[CG][A-Z0-9]+$/.test(channelId) || !text || text.length > 8_000 ||
        (threadTs !== undefined && !timestamp(threadTs))) throw new Error("Invalid task message");
    const token = (await readSecret(SLACK_SECRET_PATHS.botToken)).trim();
    if (!token.startsWith("xoxb-")) throw new Error("Invalid credential");
    const characters = Array.from(text);
    const blocks = [];
    for (let offset = 0; offset < characters.length; offset += 2_500) {
      blocks.push({ type: "section", text: { type: "plain_text", text: characters.slice(offset, offset + 2_500).join(""), emoji: false } });
    }
    const response = await request("https://slack.com/api/chat.postMessage", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ channel: channelId, text: "Agent Crew task update", blocks,
        unfurl_links: false, unfurl_media: false, ...(threadTs === undefined ? {} : { thread_ts: threadTs }) }),
    });
    if (!response.ok) throw new Error("Slack delivery failed");
    const result: unknown = await response.json();
    if (!record(result) || result.ok !== true || result.channel !== channelId || !timestamp(result.ts)) {
      throw new Error("Slack delivery unacknowledged");
    }
    return result.ts;
  } catch {
    throw new Error("Slack task delivery failed or was not acknowledged; inspect before retrying.");
  }
}
