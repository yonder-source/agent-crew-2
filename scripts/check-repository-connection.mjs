import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAppClient } from "../dist/github-app.js";
import {
  cloneRepository, prepareTaskBase, verifyTaskWorkspace, verifyTaskDelivery, commitTaskDelivery,
  inspectTaskRemoteHead, pushTaskBranch, TaskPushError,
} from "../dist/repository-clone.js";
import { validateCheckout } from "../dist/repository-validation.js";
import { parseConfig } from "../dist/config.mjs";
import { GitHubIssueError, OctokitGitHubIssueProvider } from "../dist/github-issues.js";

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
assert.equal(await client.publicationTokenForRepository("123", 17, "owner/repo"), "fixture-token");
assert.deepEqual(requests.at(-1).body, { repository_ids: [23], permissions: { contents: "write" } });
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

// Exercise issuance failure and explicit recovery through an actual issue operation.
let credentialMode = "valid";
let keyAvailable = true;
let issueTokenCount = 0;
let writeCount = 0;
let writeMode = "valid";
const authenticatedTokens = [];
const lifecycleClient = new GitHubAppClient({
  readPrivateKey: async () => {
    if (!keyAvailable) throw new Error("SECRET missing key path");
    return privateKey;
  },
  fetcher: async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/app/installations") return Response.json([{ id: 17, account: { login: "owner" } }]);
    if (path === "/installation/repositories") return Response.json({ repositories: [{ id: 23, full_name: "owner/repo", default_branch: "main" }] });
    assert.ok(path.endsWith("/access_tokens"));
    const body = JSON.parse(options.body);
    if (body.permissions.issues !== "write") return Response.json({ token: "enumeration-token", expires_at: "2099-01-01T00:00:00Z" });
    issueTokenCount += 1;
    if (credentialMode === "network") throw new Error("SECRET token transport detail");
    if (["401", "403", "500"].includes(credentialMode)) return new Response("SECRET token response", { status: Number(credentialMode) });
    return Response.json({ token: `SECRET-issued-token-${issueTokenCount}`, expires_at:
      credentialMode === "expired" ? "2000-01-01T00:00:00Z"
        : credentialMode === "invalid-expiry" ? "SECRET invalid expiry" : "2099-01-01T00:00:00Z" });
  },
});
const lifecycleProvider = new OctokitGitHubIssueProvider({
  getInstallationToken: () => lifecycleClient.issueTokenForRepository("123", 17, "owner/repo"),
  fetcher: async (_input, options) => {
    assert.equal(options.method, "PATCH");
    writeCount += 1;
    authenticatedTokens.push(new Headers(options.headers).get("authorization"));
    if (writeMode === "network") throw new Error("SECRET uncertain write");
    if (writeMode === "401") return Response.json({ message: "SECRET denied write" }, { status: 401 });
    return Response.json({ number: 7, title: "Fixture", body: "Changed", state: "open", labels: [] });
  },
});
for (const mode of ["expired", "invalid-expiry", "401", "403", "500", "network"]) {
  credentialMode = mode;
  const before = issueTokenCount;
  await assert.rejects(lifecycleProvider.updateIssueBody("owner/repo", 7, "Changed"), error =>
    error instanceof GitHubIssueError && error.code === "GITHUB_CREDENTIAL_UNAVAILABLE" && !error.message.includes("SECRET"));
  assert.equal(issueTokenCount, before + 1, "Credential failure must not automatically retry issuance or the issue write");
  assert.equal(writeCount, 0, "Invalid credentials must fail before an issue write is dispatched");
}
credentialMode = "valid";
keyAvailable = false;
await assert.rejects(lifecycleProvider.updateIssueBody("owner/repo", 7, "Changed"), { code: "GITHUB_CREDENTIAL_UNAVAILABLE" });
assert.equal(writeCount, 0);
keyAvailable = true;
await lifecycleProvider.updateIssueBody("owner/repo", 7, "Changed");
await lifecycleProvider.updateIssueBody("owner/repo", 7, "Changed");
assert.equal(writeCount, 2);
assert.notEqual(authenticatedTokens[0], authenticatedTokens[1], "Later operations must acquire fresh tokens after recovery");
for (const [mode, code] of [["401", "GITHUB_REQUEST_REJECTED"], ["network", "GITHUB_WRITE_UNCERTAIN"]]) {
  writeMode = mode;
  const beforeTokens = issueTokenCount;
  const beforeWrites = writeCount;
  await assert.rejects(lifecycleProvider.updateIssueBody("owner/repo", 7, "Changed"), error =>
    error instanceof GitHubIssueError && error.code === code && !error.message.includes("SECRET"));
  assert.equal(issueTokenCount, beforeTokens + 1);
  assert.equal(writeCount, beforeWrites + 1, "Credential recovery must not replay a failed or uncertain write");
}
console.log("App token lifecycle: expiry, failed issuance, fresh acquisition, key recovery and no write replay passed (fixtures).");

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
const u=args.indexOf('https://github.com/owner/repo.git');
if(u>=0)args[u]=${JSON.stringify(remote)};
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
  const delivery = { ...options, workspacePath, baseCommit };
  await assert.rejects(verifyTaskDelivery(delivery), /local task commit/);
  await writeFile(join(workspacePath, "README.md"), "task change\n");
  gitFixture(workspacePath, "commit", "-am", "feat: implement task");
  const taskHead = gitFixture(workspacePath, "rev-parse", "HEAD");
  assert.equal(await verifyTaskDelivery(delivery), taskHead);
  await writeFile(join(workspacePath, "untracked"), "pending\n");
  await assert.rejects(verifyTaskDelivery(delivery), /dirty or contains untracked/);
  await rm(join(workspacePath, "untracked"));
  await writeFile(join(workspacePath, "README.md"), "uncommitted\n");
  await assert.rejects(verifyTaskDelivery(delivery), /dirty or contains untracked/);
  gitFixture(workspacePath, "restore", "README.md");
  gitFixture(workspacePath, "switch", "-c", "wrong-branch");
  await assert.rejects(verifyTaskDelivery(delivery), /branch binding/);
  gitFixture(workspacePath, "switch", options.branch);
  gitFixture(workspacePath, "switch", "--orphan", "unrelated");
  await writeFile(join(workspacePath, "other"), "unrelated history\n");
  gitFixture(workspacePath, "add", "other");
  gitFixture(workspacePath, "commit", "-m", "unrelated");
  const unrelatedHead = gitFixture(workspacePath, "rev-parse", "HEAD");
  gitFixture(workspacePath, "switch", options.branch);
  gitFixture(workspacePath, "reset", "--hard", unrelatedHead);
  await assert.rejects(verifyTaskDelivery(delivery));
  gitFixture(workspacePath, "reset", "--hard", taskHead);
  // Native sandbox projections have independent Git metadata; only files reconcile.
  const promotionBranch = "openclaw/agent-crew-issue-3";
  const accepted = join(taskRoot, "accepted");
  const guest = join(taskRoot, "guest");
  gitFixture(source, "worktree", "add", "-b", promotionBranch, accepted, baseCommit);
  gitFixture(taskRoot, "clone", "--no-hardlinks", source, guest);
  gitFixture(guest, "switch", "-c", promotionBranch, baseCommit);
  gitFixture(guest, "config", "user.name", "Guest");
  gitFixture(guest, "config", "user.email", "guest@example.invalid");
  await writeFile(join(guest, "README.md"), "accepted guest change\n");
  gitFixture(guest, "commit", "-am", "feat: guest change");
  await writeFile(join(accepted, "README.md"), await readFile(join(guest, "README.md")));
  const promotion = { repositoryPath: source, workspacePath: accepted, branch: promotionBranch, baseCommit, issueNumber: 3 };
  await assert.rejects(verifyTaskDelivery(promotion), /local task commit/);
  await assert.rejects(commitTaskDelivery({ ...promotion, issueNumber: 4 }), /assigned branch/);
  await mkdir(join(accepted, ".npm"));
  await writeFile(join(accepted, ".npm/log"), "generated cache\n");
  await assert.rejects(commitTaskDelivery(promotion), /Project-local npm cache/);
  assert.equal(gitFixture(accepted, "rev-parse", "HEAD"), baseCommit);
  await rm(join(accepted, ".npm"), { recursive: true });
  gitFixture(source, "config", "filter.fixture.clean", "false");
  await assert.rejects(commitTaskDelivery(promotion), /executable Git filters/);
  assert.equal(gitFixture(accepted, "diff", "--cached", "--name-only"), "");
  gitFixture(source, "config", "--unset", "filter.fixture.clean");
  const hook = join(source, ".git/hooks/pre-commit");
  const hookMarker = join(taskRoot, "hook-executed");
  await writeFile(hook, `#!/bin/sh\ntouch '${hookMarker}'\nexit 1\n`);
  await chmod(hook, 0o700);
  gitFixture(source, "config", "commit.gpgsign", "true");
  const promoted = await commitTaskDelivery(promotion);
  await assert.rejects(readFile(hookMarker), { code: "ENOENT" });
  await rm(hook);
  gitFixture(source, "config", "--unset", "commit.gpgsign");
  assert.notEqual(promoted, baseCommit);
  assert.equal(gitFixture(accepted, "status", "--porcelain"), "");
  assert.equal(gitFixture(accepted, "show", "HEAD:README.md"), "accepted guest change");
  assert.equal(await commitTaskDelivery(promotion), promoted, "Repeated settlement must not create a duplicate commit");
  await assert.rejects(prepareTaskBase(options), /already exists/);
  const next = { ...options, branch: "openclaw/agent-crew-issue-2" };
  await writeFile(join(source, "README.md"), "ahead\n");
  gitFixture(source, "commit", "-am", "ahead");
  const localHead = gitFixture(source, "rev-parse", "HEAD");
  await assert.rejects(prepareTaskBase(next), /ahead of or divergent/);
  await writeFile(join(seed, "README.md"), "divergent\n");
  gitFixture(seed, "commit", "-am", "divergent");
  gitFixture(seed, "push", "origin", "main");
  assert.equal(await verifyTaskDelivery(delivery), taskHead, "Remote main advancing must not invalidate a bound delivery");
  await assert.rejects(prepareTaskBase(next), /ahead of or divergent/);
  assert.equal(gitFixture(source, "rev-parse", "HEAD"), localHead);
  gitFixture(workspacePath, "remote", "set-url", "origin", remote);
  const publication = {
    repository: "owner/repo", token: "fixture-token", workspacePath,
    branch: options.branch, expectedHead: taskHead,
  };
  const wrongRemote = join(taskRoot, "wrong-remote.git");
  gitFixture(taskRoot, "init", "--bare", "--initial-branch=main", wrongRemote);
  gitFixture(workspacePath, "remote", "set-url", "--push", "origin", wrongRemote);
  assert.equal(await inspectTaskRemoteHead(publication), undefined);
  await pushTaskBranch(publication);
  assert.equal(await inspectTaskRemoteHead(publication), taskHead,
    "Push must bypass any independently configured origin pushurl");
  const wrongRemoteHead = spawnSync("/usr/bin/git", [
    "--git-dir", wrongRemote, "rev-parse", "--verify", `refs/heads/${options.branch}`,
  ], { encoding: "utf8" });
  assert.notEqual(wrongRemoteHead.status, 0, "The origin pushurl must receive no publication write");
  gitFixture(seed, "push", remote, `:refs/heads/${options.branch}`);
  assert.equal(await inspectTaskRemoteHead(publication), undefined);
  gitFixture(seed, "push", remote, `${baseCommit}:refs/heads/${options.branch}`);
  await assert.rejects(pushTaskBranch(publication), (error) =>
    error instanceof TaskPushError && error.code === "REMOTE_BRANCH_MISMATCH");
  assert.equal(await inspectTaskRemoteHead(publication), baseCommit,
    "A competing ref creation must not be fast-forwarded");
  gitFixture(seed, "push", remote, `:refs/heads/${options.branch}`);
  await pushTaskBranch(publication);
  assert.equal(await inspectTaskRemoteHead(publication), taskHead);
  gitFixture(seed, "switch", "-c", "competing-publication", baseCommit);
  await writeFile(join(seed, "COMPETING.md"), "competing publication\n");
  gitFixture(seed, "add", ".");
  gitFixture(seed, "commit", "-m", "competing publication");
  const competingHead = gitFixture(seed, "rev-parse", "HEAD");
  gitFixture(seed, "push", "--force", "origin", `${competingHead}:refs/heads/${options.branch}`);
  await assert.rejects(pushTaskBranch({
    ...publication, previousRemoteHead: competingHead,
  }), (error) => error instanceof TaskPushError && error.code === "PUSH_REJECTED");
  assert.equal(await inspectTaskRemoteHead(publication), competingHead);
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(taskRoot, { recursive: true, force: true });
}
console.log("Task base: unborn main, dirty, ahead, divergence, collision and worktree binding passed (local Git fixtures).");
