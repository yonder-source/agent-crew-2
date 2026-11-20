import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAppClient } from "../dist/github-app.js";
import { cloneRepository, prepareTaskBase, verifyTaskWorkspace } from "../dist/repository-clone.js";
import { validateCheckout } from "../dist/repository-validation.js";
import { parseConfig } from "../dist/config.mjs";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const requests = [];
const client = new GitHubAppClient({
  readPrivateKey: async () => privateKey,
  fetcher: async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: options.body ? JSON.parse(options.body) : null });
    if (path === "/app/installations") return Response.json([{ id: 17, account: { login: "owner" }, permissions: { contents: "write", issues: "read", pull_requests: "write" } }]);
    if (path.endsWith("/access_tokens")) return Response.json({ token: "fixture-token", expires_at: "2099-01-01T00:00:00Z" });
    if (path === "/installation/repositories") return Response.json({ repositories: [
      { id: 23, full_name: "owner/repo", default_branch: "main" },
    ] });
    throw new Error("Unexpected GitHub request");
  },
});
assert.deepEqual(await client.listAccessibleRepositories("123"), [
  { repository: "owner/repo", installationId: 17, installationAccount: "owner" },
]);
assert.equal(await client.installationTokenForRepository("123", 17, "owner/repo"), "fixture-token");
assert.deepEqual(requests.at(-1).body, { repository_ids: [23], permissions: { contents: "read" } });
const requestsBeforeIssue = requests.length;
assert.equal(await client.issueTokenForRepository("123", 17, "owner/repo"), "fixture-token");
assert.deepEqual(requests.at(-1).body, { repository_ids: [23], permissions: { issues: "write" } });
await client.issueTokenForRepository("123", 17, "owner/repo");
assert.ok(requests.length > requestsBeforeIssue + 4, "Issue operations obtain fresh credentials rather than retaining an expiring token");
const appConfig = { environment: "test", github: { repository: "owner/repo", appId: "123", installationId: 17 }, coding: { repositoryPath: "/workspaces/repositories/owner/repo" } };
assert.equal(parseConfig(appConfig).github.appId, "123");
assert.throws(() => parseConfig({ ...appConfig, github: { repository: "owner/repo", appId: "123" } }), /configured together/);
assert.deepEqual(await client.repositoryAccess("123", 17, "owner/repo"), {
  repository: "owner/repo", permissions: { contents: "write", issues: "read", pull_requests: "write" },
});
await assert.rejects(client.installationTokenForRepository("123", 18, "owner/repo"), /installation is not available/);
await assert.rejects(client.installationTokenForRepository("123", 17, "owner/other"), /not accessible/);
await assert.rejects(client.listAccessibleRepositories("invalid"), /positive integer/);
const empty = new GitHubAppClient({ readPrivateKey: async () => privateKey, fetcher: async () => Response.json([]) });
assert.deepEqual(await empty.listAccessibleRepositories("123"), []);
const pages = [];
const paginated = new GitHubAppClient({
  readPrivateKey: async () => privateKey,
  fetcher: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/app/installations") return Response.json([{ id: 17, account: { login: "owner" } }]);
    if (parsed.pathname.endsWith("/access_tokens")) return Response.json({ token: "fixture-token", expires_at: "2099-01-01T00:00:00Z" });
    const page = Number(parsed.searchParams.get("page"));
    pages.push(page);
    return Response.json({ repositories: page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, full_name: `owner/repo-${index}`, default_branch: "main" })) : [] });
  },
});
assert.equal((await paginated.listAccessibleRepositories("123")).length, 100);
assert.deepEqual(pages, [1, 2]);
const rejected = new GitHubAppClient({ readPrivateKey: async () => privateKey, fetcher: async () => new Response("denied", { status: 403 }) });
await assert.rejects(rejected.listAccessibleRepositories("123"), /request failed/);
const unavailable = new GitHubAppClient({ readPrivateKey: async () => { throw new Error("missing"); } });
await assert.rejects(unavailable.listAccessibleRepositories("123"), /private key is unavailable/);

const root = await mkdtemp(join(tmpdir(), "agent-crew-repository-check-"));
const previousRoot = process.env.AGENT_CREW_REPOSITORY_ROOT;
process.env.AGENT_CREW_REPOSITORY_ROOT = root;
const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
try {
  const checkout = join(root, "owner", "repo");
  await mkdir(checkout, { recursive: true });
  git("init", checkout);
  git("-C", checkout, "remote", "add", "origin", "https://github.com/owner/repo.git");
  const options = { repository: "owner/repo", repositoryPath: checkout, token: "fixture-token" };
  assert.equal((await cloneRepository(options)).status, "already-present");
  assert.equal((await validateCheckout("owner/repo", checkout)).status, "passed");
  assert.equal((await validateCheckout("owner/repo", join(root, "absent", "repo"))).status, "pending");
  await assert.rejects(readFile(join(root, "absent", "repo")), { code: "ENOENT" });
  git("-C", checkout, "remote", "set-url", "origin", "https://github.com/owner/other.git");
  await assert.rejects(cloneRepository(options), /remote does not match/);
  assert.equal((await validateCheckout("owner/repo", checkout)).status, "failed");
  assert.equal(git("-C", checkout, "remote", "get-url", "origin").trim(), "https://github.com/owner/other.git");
  const nonGit = join(root, "owner", "nongit");
  await mkdir(nonGit);
  await writeFile(join(nonGit, "keep"), "unchanged");
  await assert.rejects(cloneRepository({ ...options, repositoryPath: nonGit }), /not a Git repository/);
  assert.equal(await readFile(join(nonGit, "keep"), "utf8"), "unchanged");
  await assert.rejects(cloneRepository({ ...options, repositoryPath: "/tmp/outside-repository-root" }), /inside the configured/);
  await symlink(tmpdir(), join(root, "escape"));
  await assert.rejects(cloneRepository({ ...options, repositoryPath: join(root, "escape", "repo") }), /outside the configured/);
  assert.equal((await validateCheckout("owner/repo", join(root, "escape", "repo"))).status, "failed");
  assert.deepEqual((await readdir(join(root, "owner"))).sort(), ["nongit", "repo"]);
} finally {
  if (previousRoot === undefined) delete process.env.AGENT_CREW_REPOSITORY_ROOT;
  else process.env.AGENT_CREW_REPOSITORY_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
}
console.log("Repository discovery, scoped token and checkout protection fixtures passed.");


// Local Git regression: empty clone before the first remote main commit.
// Redirect only fetch to a temporary bare remote; no GitHub authentication claim.
const taskRoot = await mkdtemp(join(tmpdir(), "agent-crew-task-base-"));
const originalPath = process.env.PATH;
const gitFixture = (cwd, ...args) => {
  const result = spawnSync("/usr/bin/git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  const remote = join(taskRoot, "remote.git");
  const seed = join(taskRoot, "seed");
  const source = join(taskRoot, "source");
  gitFixture(taskRoot, "init", "--bare", "--initial-branch=main", remote);
  gitFixture(taskRoot, "clone", remote, source);
  gitFixture(source, "remote", "set-url", "origin", "https://github.com/owner/repo.git");
  gitFixture(taskRoot, "init", "--initial-branch=main", seed);
  for (const path of [seed, source]) {
    gitFixture(path, "config", "user.name", "Fixture");
    gitFixture(path, "config", "user.email", "fixture@example.invalid");
  }
  await writeFile(join(seed, "README.md"), "initial\n");
  gitFixture(seed, "add", ".");
  gitFixture(seed, "commit", "-m", "initial");
  gitFixture(seed, "remote", "add", "origin", remote);
  gitFixture(seed, "push", "origin", "main");
  const expected = gitFixture(seed, "rev-parse", "HEAD");
  const bin = join(taskRoot, "bin");
  await mkdir(bin);
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);const f=args.indexOf('fetch');
if(f>=0){const o=args.indexOf('origin',f);if(o>=0)args[o]=${JSON.stringify(remote)};}
const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);\n`);
  await chmod(wrapper, 0o700);
  process.env.PATH = `${bin}:${originalPath ?? "/usr/bin:/bin"}`;
  const options = { repository: "owner/repo", repositoryPath: source,
    branch: "openclaw/agent-crew-issue-1", token: "fixture-token" };
  await writeFile(join(source, "untracked"), "preserve");
  await assert.rejects(prepareTaskBase(options), /dirty/);
  await rm(join(source, "untracked"));
  const baseCommit = await prepareTaskBase(options);
  assert.equal(baseCommit, expected);
  assert.equal(gitFixture(source, "rev-parse", "refs/heads/main"), expected);
  assert.equal(gitFixture(source, "status", "--porcelain"), "");
  const workspacePath = join(taskRoot, "task");
  gitFixture(source, "worktree", "add", "-b", options.branch, workspacePath, baseCommit);
  await verifyTaskWorkspace({ ...options, workspacePath, baseCommit, newlyCreated: true });
  await assert.rejects(prepareTaskBase(options), /already exists/);
  const next = { ...options, branch: "openclaw/agent-crew-issue-2" };
  await writeFile(join(source, "README.md"), "ahead\n");
  gitFixture(source, "commit", "-am", "ahead");
  const localHead = gitFixture(source, "rev-parse", "HEAD");
  await assert.rejects(prepareTaskBase(next), /ahead of or divergent/);
  await writeFile(join(seed, "README.md"), "divergent\n");
  gitFixture(seed, "commit", "-am", "divergent");
  gitFixture(seed, "push", "origin", "main");
  await assert.rejects(prepareTaskBase(next), /ahead of or divergent/);
  assert.equal(gitFixture(source, "rev-parse", "HEAD"), localHead);
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(taskRoot, { recursive: true, force: true });
}
console.log("Task base: unborn main, dirty, ahead, divergence, collision and worktree binding passed (local Git fixtures).");
