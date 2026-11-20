import assert from "node:assert/strict";
import { parseCodingResult } from "../dist/coding-result.js";

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
});
assert.throws(() => parseCodingResult(input, workspacePath, ""), /assigned workspace/);
console.log("Coding result fixture preserves the assigned workspace and branch.");
