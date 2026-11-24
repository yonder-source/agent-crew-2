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
  const publicationWorkflow = join(root, "publication-issue.lobster");
  await writeFile(join(root, "workflows/publication-call.mjs"),
    await readFile("scripts/publication-call.mjs"));
  await writeFile(publicationWorkflow,
    (await readFile("infra/local-dev/openclaw/workflows/publication-issue.lobster", "utf8"))
      .replace("/app/extensions/agent-crew/scripts/publication-call.mjs", join(root, "workflows/publication-call.mjs")));
  const marker = join(root, "injected");
  const captured = join(root, "argv.json");
  const publicationCaptured = join(root, "publication-argv.json");
  const args = {
    agentId: "coding", sessionKey: `agent:coding:agent-crew-${"a".repeat(32)}`,
    workspacePath: "/workspaces/fixture with spaces", workspaceBranch: "openclaw/agent-crew-issue-1",
    prompt: `Issue text with "quotes", newlines\n$(touch ${marker}); \`touch ${marker}\` | json`,
    timeoutSeconds: "1200",
  };
  const executable = join(root, "openclaw");
  const validation = { status: "ok", checks: [{ command: "npm test", outcome: "ok", exitCode: 0 }] };
  const usage = { total: 123, input: 100, output: 23 };
  const report = JSON.stringify({ summary: "fixture complete", validation });
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');
const argv=process.argv.slice(2);
if(argv[0]==='gateway'){
  fs.writeFileSync(${JSON.stringify(publicationCaptured)},JSON.stringify(argv));
  console.log(JSON.stringify({
    repository:'owner/repo',issueNumber:1,status:'published',
    branch:'openclaw/agent-crew-issue-1',headCommit:'${"b".repeat(40)}',
    validation:{status:'ok'},pullRequest:{
      number:8,url:'https://github.com/owner/repo/pull/8',state:'open',draft:true,
    },
  }));
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(captured)},JSON.stringify(argv));
console.log(JSON.stringify({runId:'fixture-run',status:'ok',result:{meta:{agentMeta:{usage:${JSON.stringify(usage)}}},payloads:[{text:${JSON.stringify(report)}}]}}));\n`);
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
    workspacePath: args.workspacePath, workspaceBranch: args.workspaceBranch,
    validation, usage: { status: "reported", ...usage } }]);
  assert.deepEqual(JSON.parse(await readFile(captured, "utf8")), [
    "agent", "--json", "--agent", args.agentId, "--session-key", args.sessionKey,
    "--message", args.prompt, "--timeout", args.timeoutSeconds,
  ]);
  const publication = spawnSync(process.execPath, [lobster, "run", "--mode", "tool", "--file",
    publicationWorkflow, "--args-json", JSON.stringify({
      sessionKey: args.sessionKey, agentId: args.agentId,
    })], {
    encoding: "utf8", timeout: 15_000,
    env: { LOBSTER_OPENCLAW_BIN: executable, PATH: `${root}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: root, TMPDIR: root },
  });
  assert.equal(publication.status, 0, publication.stderr || publication.stdout);
  const publicationEnvelope = JSON.parse(publication.stdout);
  assert.deepEqual(publicationEnvelope.output, [{
    repository: "owner/repo", issueNumber: 1, status: "published",
    branch: "openclaw/agent-crew-issue-1", headCommit: "b".repeat(40),
    validation: { status: "ok" },
    pullRequest: { number: 8, url: "https://github.com/owner/repo/pull/8", state: "open", draft: true },
  }]);
  const publicationArgv = JSON.parse(await readFile(publicationCaptured, "utf8"));
  assert.deepEqual(publicationArgv.slice(0, 4), [
    "gateway", "call", "agent-crew.publication.accept", "--params",
  ]);
  assert.deepEqual(JSON.parse(publicationArgv[4]), {
    sessionKey: args.sessionKey, agentId: args.agentId,
  });
  assert.deepEqual(publicationArgv.slice(5), ["--json"]);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  console.log("Native Lobster coding/publication workflows: exact CLI args, safe issue text and result handoff passed (fake CLI; no model run).");
} finally {
  await rm(root, { recursive: true, force: true });
}
