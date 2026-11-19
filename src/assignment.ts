export type AssignedIssue = {
  repository: string;
  number: number;
  jobId: string;
  sessionKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function trustedSessionKey(context: unknown): string | null {
  if (!isRecord(context)) return null;
  const sessionKey = context.sessionKey;
  if (typeof sessionKey !== "string" || sessionKey.trim() === "") return null;
  return sessionKey;
}

export function assignedIssueFromSession(
  session: unknown,
  expectedSessionKey: string,
  configuredRepository: string,
  bootId: string,
): AssignedIssue {
  if (!isRecord(session)) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  const extensions = session.pluginExtensions;
  if (!Array.isArray(extensions)) throw new Error("This session has no active Agent Crew issue assignment.");
  const matches = extensions.filter((item: unknown) => {
    return isRecord(item) && item.pluginId === "agent-crew" && item.namespace === "agent-crew-job";
  });
  if (matches.length !== 1) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  const extension: unknown = matches[0];
  if (!isRecord(extension)) {
    throw new Error("This session has invalid Agent Crew assignment metadata; operator inspection is required.");
  }
  const job = extension.value;
  if (!isRecord(job)) {
    throw new Error("This session has invalid Agent Crew assignment metadata; operator inspection is required.");
  }
  const validStatus = job.status === "active" || (job.status === "starting" && job.bootId === bootId);
  if (typeof job.repository !== "string" || job.repository !== configuredRepository ||
      typeof job.number !== "number" || !Number.isSafeInteger(job.number) || job.number < 1 ||
      typeof job.jobId !== "string" || job.jobId.trim() === "" ||
      job.sessionKey !== expectedSessionKey || !validStatus) {
    throw new Error("This session has no active Agent Crew issue assignment.");
  }
  return {
    repository: job.repository,
    number: job.number,
    jobId: job.jobId,
    sessionKey: job.sessionKey,
  };
}
