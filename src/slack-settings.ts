import { parseSlackSettings } from "./config.mjs";
import { SLACK_SECRET_PATHS } from "./slack-credentials.js";
import type { ConnectionCheck } from "./repository-validation.js";

export type SlackSettings = Partial<Record<"coding" | "designer", {
  agentId: string; channelId: string; userIds: string[];
}>>;

type SlackDraft = Record<"codingAgentId" | "designerAgentId" | "codingChannelId" |
  "designerChannelId" | "codingUserIds" | "designerUserIds", string>;

export function draftSlackSettings(draft: SlackDraft): SlackSettings {
  const settings: SlackSettings = {};
  for (const role of ["coding", "designer"] as const) {
    const channelId = draft[`${role}ChannelId`].trim();
    const users = draft[`${role}UserIds`].trim();
    if (!channelId && !users) continue;
    settings[role] = { agentId: draft[`${role}AgentId`].trim(), channelId,
      userIds: users.split(/[\s,]+/).filter(Boolean) };
  }
  return parseSlackSettings(settings);
}

// Only fixed read-only endpoints; callers never receive tokens or provider errors.
export async function validateSlackSettings(settings: SlackSettings,
  readSecret: (path: string) => Promise<string>, request: typeof fetch = fetch): Promise<ConnectionCheck[]> {
  const checks: ConnectionCheck[] = [];
  if (Object.keys(settings).length === 0) return checks;
  try {
    const deadline = AbortSignal.timeout(30_000);
    const token = (await readSecret(SLACK_SECRET_PATHS.botToken)).trim();
    if (!token.startsWith("xoxb-")) throw new Error("Invalid credential");
    const api = async (method: "conversations.info" | "users.info", key: string, id: string) => {
      const response = await request(`https://slack.com/api/${method}?${key}=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]), redirect: "error",
      });
      if (!response.ok) throw new Error("Slack read failed");
      const value: unknown = await response.json();
      if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== true) {
        throw new Error("Slack read failed");
      }
      return value as Record<string, unknown>;
    };
    const users = new Map<string, boolean>();
    for (const role of ["coding", "designer"] as const) {
      const entry = settings[role];
      if (!entry) continue;
      let channelReady = false;
      try {
        const { channel } = await api("conversations.info", "channel", entry.channelId);
        channelReady = typeof channel === "object" && channel !== null && "id" in channel &&
          channel.id === entry.channelId && "is_member" in channel && channel.is_member === true &&
          "is_archived" in channel && channel.is_archived === false;
      } catch { /* Static operator feedback below. */ }
      checks.push({ id: `${role}-slack-channel`, status: channelReady ? "passed" : "failed",
        message: channelReady ? `${role} channel is active and the bot is a member.`
          : `Verify the ${role} channel ID, bot membership and channel read permission.` });
      for (const id of entry.userIds) {
        if (users.has(id)) continue;
        let ready = false;
        try {
          const { user } = await api("users.info", "user", id);
          ready = typeof user === "object" && user !== null && "id" in user && user.id === id &&
            "deleted" in user && user.deleted === false && "is_bot" in user && user.is_bot === false &&
            "is_app_user" in user && user.is_app_user === false;
        } catch { /* Static operator feedback below. */ }
        users.set(id, ready);
      }
      const usersReady = entry.userIds.every((id) => users.get(id) === true);
      checks.push({ id: `${role}-slack-users`, status: usersReady ? "passed" : "failed",
        message: usersReady ? `${role} authorized users are active human accounts.`
          : `Verify the ${role} user IDs and users:read permission.` });
    }
  } catch {
    checks.push({ id: "slack-settings", status: "failed", message: "Slack validation requires a readable bot credential." });
  }
  return checks;
}
