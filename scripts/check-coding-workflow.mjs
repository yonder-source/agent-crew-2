import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run the pinned native Lobster with a fake OpenClaw CLI, never a model call.
const root = await mkdtemp(join(tmpdir(), "agent-crew-workflow-"));
try {
  // Recreate the deployed relative module layout outside lint source inputs.
  await mkdir(join(root, "dist"));
  await mkdir(join(root, "workflows"));
  await writeFile(join(root, "dist/coding-result.mjs"), await readFile("dist/coding-result.js", "utf8"));
  await writeFile(join(root, "workflows/coding-result.mjs"),
    (await readFile("infra/local-dev/openclaw/workflows/coding-result.mjs", "utf8"))
      .replace("../dist/coding-result.js", "../dist/coding-result.mjs"));
  const workflow = join(root, "coding-issue.lobster");
  await writeFile(workflow,
    (await readFile("infra/local-dev/openclaw/workflows/coding-issue.lobster", "utf8"))
      .replace("/app/extensions/agent-crew/workflows/coding-result.mjs", join(root, "workflows/coding-result.mjs")));
  const marker = join(root, "injected");
  const captured = join(root, "argv.json");
  const args = {
    agentId: "coding", sessionKey: "agent:coding:fixture",
    workspacePath: "/workspaces/fixture with spaces", workspaceBranch: "openclaw/agent-crew-issue-1",
    prompt: `Issue text with "quotes", newlines\n$(touch ${marker}); \`touch ${marker}\` | json`,
    timeoutSeconds: "1200",
  };
  const executable = join(root, "openclaw");
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(captured)},JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({runId:'fixture-run',status:'ok',result:{payloads:[{text:'fixture complete'}]}}));\n`);
  await chmod(executable, 0o700);
  const lobster = "/opt/agent-crew-lobster/node_modules/@openclaw/lobster/node_modules/@clawdbot/lobster/bin/lobster.js";
  const result = spawnSync(process.execPath, [lobster, "run", "--mode", "tool", "--file",
    workflow, "--args-json", JSON.stringify(args)], {
    encoding: "utf8", timeout: 15_000,
    env: { LOBSTER_OPENCLAW_BIN: executable, PATH: `${root}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: root, TMPDIR: root },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, "ok");
  assert.deepEqual(envelope.output, [{ runId: "fixture-run", status: "ok", text: "fixture complete",
    workspacePath: args.workspacePath, workspaceBranch: args.workspaceBranch }]);
  assert.deepEqual(JSON.parse(await readFile(captured, "utf8")), [
    "agent", "--json", "--agent", args.agentId, "--session-key", args.sessionKey,
    "--message", args.prompt, "--timeout", args.timeoutSeconds,
  ]);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  console.log("Native Lobster coding workflow: exact CLI args, safe issue text and result handoff passed (fake CLI; no model run).");
} finally {
  await rm(root, { recursive: true, force: true });
}
