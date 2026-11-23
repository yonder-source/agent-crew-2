export const SLACK_SECRET_PATHS = {
  botToken: "/run/secrets/agent-crew-slack-bot-token",
  appToken: "/run/secrets/agent-crew-slack-app-token",
} as const;

type CredentialStatus = "available" | "missing" | "invalid" | "unavailable";

// Presence and recognizable token type only; this does not authenticate to Slack.
export async function slackCredentialStatus(
  readSecret: (path: string) => Promise<string>,
): Promise<Record<keyof typeof SLACK_SECRET_PATHS, CredentialStatus>> {
  const inspect = async (path: string, prefix: string): Promise<CredentialStatus> => {
    try {
      const value = (await readSecret(path)).trim();
      return value.startsWith(prefix) && value.length > prefix.length ? "available" : "invalid";
    } catch (error) {
      return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
        ? "missing" : "unavailable";
    }
  };
  const [botToken, appToken] = await Promise.all([
    inspect(SLACK_SECRET_PATHS.botToken, "xoxb-"),
    inspect(SLACK_SECRET_PATHS.appToken, "xapp-"),
  ]);
  return { botToken, appToken };
}
