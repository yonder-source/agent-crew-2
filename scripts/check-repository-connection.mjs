import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAppClient } from "../dist/github-app.js";
import { cloneRepository } from "../dist/repository-clone.js";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const requests = [];
const client = new GitHubAppClient({
  readPrivateKey: async () => privateKey,
  fetcher: async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: options.body ? JSON.parse(options.body) : null });
    if (path === "/app/installations") return Response.json([{ id: 17, account: { login: "owner" } }]);
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
  git("-C", checkout, "remote", "set-url", "origin", "https://github.com/owner/other.git");
  await assert.rejects(cloneRepository(options), /remote does not match/);
  assert.equal(git("-C", checkout, "remote", "get-url", "origin").trim(), "https://github.com/owner/other.git");
  const nonGit = join(root, "owner", "nongit");
  await mkdir(nonGit);
  await writeFile(join(nonGit, "keep"), "unchanged");
  await assert.rejects(cloneRepository({ ...options, repositoryPath: nonGit }), /not a Git repository/);
  assert.equal(await readFile(join(nonGit, "keep"), "utf8"), "unchanged");
  await assert.rejects(cloneRepository({ ...options, repositoryPath: "/tmp/outside-repository-root" }), /inside the configured/);
  await symlink(tmpdir(), join(root, "escape"));
  await assert.rejects(cloneRepository({ ...options, repositoryPath: join(root, "escape", "repo") }), /outside the configured/);
  assert.deepEqual((await readdir(join(root, "owner"))).sort(), ["nongit", "repo"]);
} finally {
  if (previousRoot === undefined) delete process.env.AGENT_CREW_REPOSITORY_ROOT;
  else process.env.AGENT_CREW_REPOSITORY_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
}
console.log("Repository discovery, scoped token and checkout protection fixtures passed.");
