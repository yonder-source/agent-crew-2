function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

type ValidationStatus = "ok" | "failed" | "unknown";
type ValidationCheck = { command: string; outcome: ValidationStatus; exitCode?: number; summary?: string };
export type CodingValidation = { status: ValidationStatus; summary?: string; checks: ValidationCheck[] };
export type CodingDelivery = { validation: CodingValidation } & (
  { status: "ready"; headCommit: string } |
  { status: "needs-inspection"; reason: "coding-failed" | "validation-failed" | "validation-unknown" | "worktree-unverified" }
);

function isValidationStatus(value: unknown): value is ValidationStatus {
  return value === "ok" || value === "failed" || value === "unknown";
}

function isSummary(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 4_000);
}

export function isCodingValidation(value: unknown): value is CodingValidation {
  if (!isRecord(value) || !isValidationStatus(value.status) || !isSummary(value.summary) ||
      !isArray(value.checks) || value.checks.length > 100) return false;
  if (!value.checks.every((check) => isRecord(check) &&
      typeof check.command === "string" && check.command.trim().length > 0 && check.command.length <= 2_000 &&
      isValidationStatus(check.outcome) && isSummary(check.summary) &&
      (check.exitCode === undefined || (typeof check.exitCode === "number" && Number.isSafeInteger(check.exitCode))) &&
      !(check.outcome === "ok" && check.exitCode !== undefined && check.exitCode !== 0))) return false;
  return value.status !== "ok" || (value.checks.length > 0 && value.checks.every((check) =>
    isRecord(check) && check.outcome === "ok"));
}

export function normalizeCodingValidation(value: unknown): CodingValidation {
  if (!isCodingValidation(value)) return { status: "unknown", checks: [] };
  return {
    status: value.status, ...(value.summary !== undefined ? { summary: value.summary } : {}),
    checks: value.checks.map((check) => ({
      command: check.command, outcome: check.outcome,
      ...(check.exitCode !== undefined ? { exitCode: check.exitCode } : {}),
      ...(check.summary !== undefined ? { summary: check.summary } : {}),
    })),
  };
}

export function isCodingDelivery(value: unknown): value is CodingDelivery {
  if (!isRecord(value) || !isCodingValidation(value.validation)) return false;
  if (value.status === "needs-inspection") return value.headCommit === undefined &&
    ["coding-failed", "validation-failed", "validation-unknown", "worktree-unverified"].includes(String(value.reason));
  return value.status === "ready" && value.validation.status === "ok" &&
    typeof value.headCommit === "string" && /^[a-f0-9]{40,64}$/.test(value.headCommit);
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

  // The CLI status describes the model turn, not the task's validation outcome.
  let report: unknown;
  try { report = JSON.parse(text) as unknown; } catch { report = undefined; }
  const validation = normalizeCodingValidation(isRecord(report) ? report.validation : undefined);
  const summary = isRecord(report) && typeof report.summary === "string" && report.summary.length <= 4_000
    ? report.summary : text;
  const requestInput = isRecord(report) ? report.requestInput : undefined;
  if (requestInput !== undefined && (typeof requestInput !== "string" ||
      requestInput.trim().length === 0 || requestInput.length > 4_000)) {
    throw new Error("Coding input request is invalid.");
  }
  return { runId: result.runId, status: result.status, text: summary, workspacePath, workspaceBranch, validation,
    ...(typeof requestInput === "string" ? { requestInput: requestInput.trim() } : {}) };
}
