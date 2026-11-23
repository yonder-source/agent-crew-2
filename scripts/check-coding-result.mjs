import assert from "node:assert/strict";
import { parseCodingResult, normalizeCodingValidation, isCodingDelivery, addCodingUsage, parseTokenBudget } from "../dist/coding-result.js";

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
  validation: { status: "unknown", checks: [] }, usage: { status: "unknown" },
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

const awaitingInput = (requestInput, status = "ok") => JSON.stringify({ runId, status,
  result: { payloads: [{ text: JSON.stringify({ summary: "Need a decision", requestInput, validation }) }] } });
assert.equal(parseCodingResult(awaitingInput("  Which behavior?  "), workspacePath, workspaceBranch).requestInput, "Which behavior?");
for (const question of ["", " ", null, true, "q".repeat(4_001)]) {
  assert.throws(() => parseCodingResult(awaitingInput(question), workspacePath, workspaceBranch), /input request/);
}
assert.equal(structured.requestInput, undefined, "Ordinary status must not cause waiting");

const nativeUsage = { total: 30, input: 10, output: 5, cacheRead: 15 };
const usageResult = (usage, reportUsage = { total: 999999 }) => parseCodingResult(JSON.stringify({runId, status: "ok", result: {
  meta: {agentMeta: {usage}}, payloads: [{text: JSON.stringify({summary: "Done", usage: reportUsage})}],
}}), workspacePath, workspaceBranch);
assert.deepEqual(usageResult(nativeUsage).usage, {status: "reported", ...nativeUsage});
assert.deepEqual(usageResult(undefined).usage, {status: "unknown"}, "Agent text cannot supply runtime usage");
for (const usage of [null, {}, {total: -1}, {total: 1.5}, {total: Number.MAX_SAFE_INTEGER + 1},
  {total: 1, input: 2}, {total: 1, input: -1}, {total: 1, output: null},
  {total: 30, usageReport: {state: "unavailable"}}, {total: 1, usageReport: {}},
  {total: 1, usageReport: {state: "estimated"}}]) {
  assert.deepEqual(usageResult(usage).usage, {status: "unknown"});
}
assert.deepEqual(usageResult({total: 0, input: 0, output: 0}).usage,
  {status: "reported", total: 0, input: 0, output: 0});
assert.deepEqual(usageResult({...nativeUsage, secret: "discard"}).usage, {status: "reported", ...nativeUsage});

assert.deepEqual(usageResult({...nativeUsage, usageReport: {state: "available"}}).usage,
  {status: "reported", ...nativeUsage});

assert.deepEqual(addCodingUsage({status: "reported", total: 10}, {status: "reported", total: 20}), {status: "reported", total: 30});
assert.deepEqual(addCodingUsage({status: "unknown"}, {status: "reported", total: 20}), {status: "unknown"});
assert.deepEqual(addCodingUsage({status: "reported", total: Number.MAX_SAFE_INTEGER}, {status: "reported", total: 1}), {status: "unknown"});
assert.equal(parseTokenBudget(""), undefined);
assert.equal(parseTokenBudget("100"), 100);
for (const limit of ["0", "-1", "1.5", "01", "1e3", " 100", "NaN", "9007199254740992"]) assert.throws(() => parseTokenBudget(limit));
