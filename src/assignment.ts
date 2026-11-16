export type AssignedIssue = {
  repository: string;
  number: number;
  jobId: string;
  sessionKey: string;
};

export function trustedSessionKey(context: unknown): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const sessionKey = (context as { sessionKey?: unknown }).sessionKey;
  if (typeof sessionKey !== "string" || sessionKey.trim() === "") return null;
  return sessionKey;
}

export function assignedIssueFromSession(
  session: unknown,
  expectedSessionKey: string,
  configuredRepository: string,
  bootId: string,
): AssignedIssue {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  const extensions = (session as { pluginExtensions?: unknown }).pluginExtensions;
  if (!Array.isArray(extensions)) throw new Error("This session has no active Agent Crew issue assignment.");
  const matches = extensions.filter((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const value = item as { pluginId?: unknown; namespace?: unknown };
    return value.pluginId === "agent-crew" && value.namespace === "agent-crew-job";
  });
  if (matches.length !== 1) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  const extension = matches[0];
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) {
    throw new Error("This session has invalid Agent Crew assignment metadata; operator inspection is required.");
  }
  const job = (extension as { value?: unknown }).value;
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Error("This session has invalid Agent Crew assignment metadata; operator inspection is required.");
  }
  const value = job as Record<string, unknown>;
  const validStatus = value.status === "active" || (value.status === "starting" && value.bootId === bootId);
  if (typeof value.repository !== "string" || value.repository !== configuredRepository ||
      typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1 ||
      typeof value.jobId !== "string" || value.jobId.trim() === "" ||
      value.sessionKey !== expectedSessionKey || !validStatus) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  return {
    repository: value.repository,
    number: value.number,
    jobId: value.jobId,
    sessionKey: value.sessionKey,
  };
}
