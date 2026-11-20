function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function parseCodingResult(input: string, workspacePath: string, workspaceBranch: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    throw new Error("OpenClaw coding run returned invalid JSON.");
  }

  const result = isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(result) || typeof result.runId !== "string" || !result.runId ||
      typeof result.status !== "string" || !result.status || !workspacePath || !workspaceBranch) {
    throw new Error("OpenClaw coding run result or assigned workspace is invalid.");
  }

  const runResult = isRecord(result.result) ? result.result : undefined;
  const payloads = isArray(runResult?.payloads) ? runResult.payloads : [];
  const text = payloads
    .filter((payload): payload is Record<string, unknown> & { text: string } =>
      isRecord(payload) && typeof payload.text === "string")
    .map((payload) => payload.text)
    .join("\n");

  return { runId: result.runId, status: result.status, text, workspacePath, workspaceBranch };
}
