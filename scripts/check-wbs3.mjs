import assert from "node:assert/strict";
import { assignedIssueFromSession, trustedSessionKey } from "../dist/assignment.js";
import { IssueDiscovery } from "../dist/discovery.js";
import { GitHubIssueError, OctokitGitHubIssueProvider } from "../dist/github-issues.js";

const fixture = (number, overrides = {}) => ({
  number,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  state: "open",
  labels: [{ name: "ready for agent" }],
  ...overrides,
});
const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  ...init,
  headers: { "content-type": "application/json", ...init.headers },
});
const requested = [];
const secondPage = "https://api.github.com/repos/owner/repo/issues?state=open&labels=ready+for+agent&per_page=100&page=2";
const fetcher = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  requested.push({ url, init });
  try {
    assert.equal(url.origin, "https://api.github.com");
    assert.match(url.pathname, /^\/repos\/owner\/repo\/issues(?:\/\d+)?$/);
    assert.ok(new Headers(init.headers).get("authorization"), "Octokit must attach the installation token");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
  } catch (error) {
    console.error("Octokit fixture request assertion failed:", error);
    throw error;
  }
  if (url.pathname.endsWith("/issues/7") && init.method === "GET") {
    return jsonResponse(fixture(7), { status: 200 });
  }
  if (url.pathname.endsWith("/issues/7") && init.method === "PATCH") {
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body), ["body"], "Only the issue body may be updated");
    return jsonResponse(fixture(7, { body: body.body }), { status: 200 });
  }
  if (url.searchParams.get("page") === "2") {
    return jsonResponse([fixture(2)], { status: 200 });
  }
  return jsonResponse([
    fixture(1),
    fixture(3, { labels: [{ name: "triage" }] }),
    fixture(4, { state: "closed" }),
    fixture(5, { pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" } }),
  ], {
    status: 200,
    headers: { link: `<${secondPage}>; rel="next"` },
  });
};
const provider = new OctokitGitHubIssueProvider({
  getInstallationToken: async () => "fixture-installation-token",
  fetcher,
});
assert.deepEqual((await provider.listReadyIssues("Owner/Repo")).map(({ number }) => number), [1, 2]);
assert.ok(requested.some(({ url }) => url.searchParams.get("page") === "2"), "Issue discovery must paginate");
assert.equal((await provider.readIssue("owner/repo", 7)).body, "Body 7");
assert.equal((await provider.updateIssueBody("owner/repo", 7, "Updated body")).body, "Updated body");

const uncertainProvider = new OctokitGitHubIssueProvider({
  getInstallationToken: async () => "fixture-installation-token",
  fetcher: async () => { throw new Error("SECRET transport detail"); },
});
await assert.rejects(uncertainProvider.updateIssueBody("owner/repo", 7, "Changed"), (error) =>
  error instanceof GitHubIssueError && error.code === "GITHUB_WRITE_UNCERTAIN" && !error.message.includes("SECRET"));
await assert.rejects(uncertainProvider.listReadyIssues("owner/repo"), (error) =>
  error instanceof GitHubIssueError && error.code === "GITHUB_DISCOVERY_FAILED" && !error.message.includes("SECRET"));

const rejectedWriteProvider = new OctokitGitHubIssueProvider({
  getInstallationToken: async () => "fixture-installation-token",
  fetcher: async () => jsonResponse({ message: "Validation Failed" }, { status: 422 }),
});
await assert.rejects(rejectedWriteProvider.updateIssueBody("owner/repo", 7, "Changed"), (error) =>
  error instanceof GitHubIssueError && error.code === "GITHUB_REQUEST_REJECTED",
  "A definitive GitHub 4xx response must not be treated as an uncertain write");

let complete;
let failure;
const emptyDiscovery = new IssueDiscovery({
  repository: "owner/repo",
  listReadyIssues: async () => [],
  dispatch: async () => assert.fail("Empty discovery must not dispatch"),
  onComplete: (count) => { complete = count; },
  onFailure: (error) => { failure = error; },
});
await emptyDiscovery.poll();
assert.equal(complete, 0);
assert.equal(failure, undefined, "An empty issue list is not a provider failure");
const failingDiscovery = new IssueDiscovery({
  repository: "owner/repo",
  listReadyIssues: async () => { throw new Error("provider unavailable"); },
  dispatch: async () => assert.fail("Failed discovery must not dispatch"),
  onComplete: () => assert.fail("Failed discovery must not be reported as empty"),
  onFailure: (error) => { failure = error; },
});
await failingDiscovery.poll();
assert.match(failure.message, /provider unavailable/);

const trustedContext = { sessionKey: "agent:main:issue-7", assertInvocationCurrent() {} };
assert.equal(trustedSessionKey(trustedContext), "agent:main:issue-7");
assert.equal(trustedSessionKey({ params: { sessionKey: "agent:main:issue-7" } }), null, "Agent supplied session IDs are not trusted");
const assignedSession = { pluginExtensions: [{
  pluginId: "agent-crew", namespace: "agent-crew-job", value: {
    repository: "owner/repo", number: 7, jobId: "job-7", sessionKey: "agent:main:issue-7",
    status: "active", bootId: "boot-1",
  },
}] };
assert.deepEqual(assignedIssueFromSession(assignedSession, "agent:main:issue-7", "owner/repo", "boot-1"), {
  repository: "owner/repo", number: 7, jobId: "job-7", sessionKey: "agent:main:issue-7",
});
for (const [session, key, repository, boot] of [
  [null, "agent:main:issue-7", "owner/repo", "boot-1"],
  [assignedSession, "agent:main:issue-8", "owner/repo", "boot-1"],
  [assignedSession, "agent:main:issue-7", "other/repo", "boot-1"],
  [{ pluginExtensions: [{ ...assignedSession.pluginExtensions[0], value: { ...assignedSession.pluginExtensions[0].value, status: "starting", bootId: "old" } }] }, "agent:main:issue-7", "owner/repo", "boot-1"],
]) {
  assert.throws(() => assignedIssueFromSession(session, key, repository, boot), /assignment/);
}

console.log("WBS3 fixtures passed: Octokit pagination, issue filtering and body-only writes; assignment checks; discovery empty/error distinction.");
