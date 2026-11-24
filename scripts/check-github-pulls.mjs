import assert from "node:assert/strict";
import { GitHubPullRequestError, OctokitGitHubPullRequestProvider } from "../dist/github-pulls.js";

const repository = "owner/repo";
const headCommit = "b".repeat(40);
const expected = {
  repository, issueNumber: 7, issueTitle: "Implement fixture",
  headRef: "openclaw/agent-crew-issue-7", headCommit, baseRef: "main",
};
const body = "Coding summary\n\nValidation summary\n\nFixes #7";
const fixture = (overrides = {}) => ({
  id: 123, number: 8, html_url: "https://github.com/owner/repo/pull/8",
  title: expected.issueTitle, body, state: "open", draft: true, merged: false, merged_at: null,
  base: { ref: "main", repo: { full_name: repository } },
  head: { ref: expected.headRef, sha: headCommit, repo: { full_name: repository } },
  ...overrides,
});
const response = (value, init = {}) => new Response(JSON.stringify(value), {
  ...init,
  headers: { "content-type": "application/json", ...init.headers },
});

let listRows = [fixture()];
let createResponse = fixture();
let listFailure;
let createFailure;
let createCalls = 0;
const requests = [];
const provider = new OctokitGitHubPullRequestProvider({
  getInstallationToken: async () => "fixture-token",
  fetcher: async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requests.push({ url, init });
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(url.pathname, "/repos/owner/repo/pulls");
    if (init.method === "GET") assert.equal(url.searchParams.has("base"), false,
      "Lookup must include same-head PRs from every base before mismatch inspection");
    assert.ok(new Headers(init.headers).get("authorization"));
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    if (init.method === "POST") {
      createCalls += 1;
      if (createFailure instanceof Response) return createFailure;
      if (createFailure) throw createFailure;
      assert.equal(JSON.parse(init.body).draft, true);
      return response(createResponse, { status: 201 });
    }
    if (listFailure) throw listFailure;
    return response(listRows);
  },
});

const existing = await provider.findExisting(expected);
assert.equal(existing.number, 8);
assert.equal(createCalls, 0);
listRows = [fixture({
  html_url: "https://github.com/Owner/Repo/pull/8",
  base: { ref: "main", repo: { full_name: "Owner/Repo" } },
  head: { ref: expected.headRef, sha: headCommit, repo: { full_name: "Owner/Repo" } },
})];
assert.equal((await provider.findExisting(expected)).number, 8,
  "Canonical repository name case must not reject a valid PR");
listRows = [fixture()];
for (const [label, changed] of [
  ["closed", fixture({ state: "closed" })],
  ["non-draft", fixture({ draft: false })],
  ["merged", fixture({ merged: true })],
  ["wrong base", fixture({ base: { ref: "develop", repo: { full_name: repository } } })],
  ["wrong head", fixture({ head: { ref: "openclaw/agent-crew-issue-8", sha: headCommit, repo: { full_name: repository } } })],
  ["wrong commit", fixture({ head: { ref: expected.headRef, sha: "c".repeat(40), repo: { full_name: repository } } })],
  ["wrong issue", fixture({ body: "Fixes #8" })],
]) {
  listRows = [changed];
  await assert.rejects(provider.findExisting(expected), (error) =>
    error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_MISMATCH", label);
}
listRows = [fixture(), fixture({ id: 124, number: 9, html_url: "https://github.com/owner/repo/pull/9" })];
await assert.rejects(provider.findExisting(expected), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_AMBIGUOUS");

listRows = [];
assert.equal(await provider.findExisting(expected), undefined);
const created = await provider.create({ ...expected, body });
assert.equal(created.number, 8);
assert.equal(createCalls, 1);
createResponse = fixture({ head: { ref: expected.headRef, sha: "c".repeat(40), repo: { full_name: repository } } });
await assert.rejects(provider.create({ ...expected, body }), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_CREATE_UNCERTAIN");
createResponse = fixture();

createFailure = response({ message: "Validation failed" }, { status: 422 });
await assert.rejects(provider.create({ ...expected, body }), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_CREATE_REJECTED");
createFailure = response({
  message: "Validation Failed",
  errors: [{ resource: "PullRequest", code: "custom", message: "A pull request already exists for owner:openclaw/agent-crew-issue-7." }],
}, { status: 422 });
await assert.rejects(provider.create({ ...expected, body }), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_CREATE_UNCERTAIN");
createFailure = new Error("SECRET transport detail");
await assert.rejects(provider.create({ ...expected, body }), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_CREATE_UNCERTAIN" &&
    !error.message.includes("SECRET"));
createFailure = undefined;
listFailure = new Error("SECRET lookup detail");
await assert.rejects(provider.findExisting(expected), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_LOOKUP_UNCERTAIN" &&
    !error.message.includes("SECRET"));

listFailure = undefined;
let timedOut = false;
const timeoutProvider = new OctokitGitHubPullRequestProvider({
  getInstallationToken: async () => "fixture-token",
  timeoutMs: 100,
  fetcher: async () => {
    timedOut = true;
    return new Promise(() => {});
  },
});
await assert.rejects(timeoutProvider.findExisting(expected), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_PULL_REQUEST_LOOKUP_UNCERTAIN");
assert.equal(timedOut, true);

const blocked = new OctokitGitHubPullRequestProvider({
  getInstallationToken: async () => "fixture-token",
  fetcher: async () => response([], {
    headers: { link: "<https://api.github.com/repos/owner/other/pulls?page=2>; rel=\"next\"" },
  }),
});
await assert.rejects(blocked.findExisting(expected), (error) =>
  error instanceof GitHubPullRequestError && error.code === "GITHUB_REQUEST_BLOCKED");

console.log("GitHub pull request fixtures passed: exact draft reuse, mismatches, ambiguity, bounded timeouts and create classification.");
