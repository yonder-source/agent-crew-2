import assert from "node:assert/strict";
import { parseCodingResult, normalizeCodingValidation, isCodingDelivery } from "../dist/coding-result.js";

const runId = "run-fixture";
const workspacePath = "/workspaces/issue-7";
const workspaceBranch = "openclaw/issue-7";
const input = JSON.stringify({
  runId,
  status: "ok",
  result: { payloads: [{ text: "README updated" }, { text: "Checks passed" }] },
});
assert.deepEqual(parseCodingResult(input, workspacePath, workspaceBranch), {
  runId, status: "ok", text: "README updated\nChecks passed", workspacePath, workspaceBranch,
  validation: { status: "unknown", checks: [] },
});
assert.throws(() => parseCodingResult(input, workspacePath, ""), /assigned workspace/);
const validation = { status: "ok", checks: [{ command: "npm test", outcome: "ok", exitCode: 0 }] };
const report = JSON.stringify({ summary: "Committed README", validation, headCommit: "untrusted" });
const structured = parseCodingResult(JSON.stringify({ runId, status: "ok", result: { payloads: [{ text: report }] } }), workspacePath, workspaceBranch);
assert.deepEqual(structured.validation, validation);
assert.equal(structured.text, "Committed README");
assert.equal(structured.headCommit, undefined);
for (const malformed of [undefined, null, { status: "ok" }, { status: "ok", checks: [] },
  { status: "ok", checks: [{ command: "npm test", outcome: "ok", exitCode: 1 }] },
  { status: "ok", checks: [{ command: "npm test", outcome: "unknown" }] },
  { status: "ok", checks: [{ command: "", outcome: "ok" }] }]) {
  assert.deepEqual(normalizeCodingValidation(malformed), { status: "unknown", checks: [] });
}
const failed = { status: "failed", checks: [{ command: "npm test", outcome: "failed", exitCode: 1 }] };
assert.deepEqual(normalizeCodingValidation(failed), failed);
assert.deepEqual(normalizeCodingValidation({ ...validation, secret: "discard", checks: [
  { ...validation.checks[0], secret: "discard" },
] }), validation);
assert.equal(isCodingDelivery({ status: "ready", validation, headCommit: "a".repeat(40) }), true);
assert.equal(isCodingDelivery({ status: "ready", validation: failed, headCommit: "a".repeat(40) }), false);
assert.equal(isCodingDelivery({ status: "ready", validation }), false);
console.log("Coding result fixture preserves the assigned workspace and branch.");
