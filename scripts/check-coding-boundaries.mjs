import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { assignedIssueFromSession, trustedSessionKey } from "../dist/assignment.js";

const source = readFileSync("dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
const issue = { repository: "owner/repo", issueNumber: 7 };
const repositoryPath = "/workspaces/repositories/owner/repo";
const workspacePath = "/home/node/.openclaw/worktrees/fixture/issue-7";
const branch = "openclaw/issue-7";

function harness(initialSession = null) {
  let session = initialSession;
  let codingStatus = "ok";
  let codingText = "Changed README; validation passed";
  const calls = [];
  const methods = new Map();
  const registeredTools = new Map();
  const context = createContext({
    createHash, randomUUID,
    process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
    assignedIssueFromSession, trustedSessionKey,
    Type: new Proxy({}, { get: () => () => ({}) }),
    GitHubIssueError: class GitHubIssueError extends Error {},
    OctokitGitHubIssueProvider: class {
      async readIssue(repository, number) {
        return { repository, number, title: "Fixture", body: "Change README", state: "open", labels: ["ready for agent"] };
      }
    },
    IssueDiscovery: class {},
    parseConfig: () => ({
      environment: "test", github: { repository: "owner/repo", pollIntervalMs: 60_000 },
      coding: { agentId: "coding", repositoryPath },
    }),
    definePluginEntry: (entry) => entry,
    callGatewayFromCli: async (method, _options, params) => {
      calls.push({ method, params });
      if (method === "sessions.describe") return { session };
      if (method === "sessions.create") {
        session = {
          sessionRoot: workspacePath,
          worktree: { repoRoot: repositoryPath, branch },
          pluginExtensions: [],
        };
        return { worktree: { path: workspacePath, branch } };
      }
      if (method === "sessions.pluginPatch") {
        session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: params.value }];
        return {};
      }
      if (method === "tools.invoke") return { ok: true, output: { details: {
        ok: true, status: "ok", output: [{ runId: "run-7", status: codingStatus, text: codingText }],
      } } };
      throw new Error(`Unexpected method: ${method}`);
    },
  });
  runInContext(source, context);
  context.entry.register({
    session: { state: { registerSessionExtension() {} } },
    registerTool: (tool) => registeredTools.set(tool.name, tool),
    registerGatewayMethod: (name, handler, options) => methods.set(name, { handler, options }),
    registerService() {},
    logger: { info() {}, error() {} },
  });
  async function method(name, params) {
    let answer;
    await methods.get(name).handler({
      params,
      respond(ok, value, error) { answer = { ok, value, error }; },
    });
    return answer;
  }
  return {
    calls,
    method,
    async status() {
      return registeredTools.get("agent_crew_status").execute("fixture", {
        repository: issue.repository, issueNumber: issue.issueNumber,
      });
    },
    session: () => session,
    setCoding(status, text = codingText) { codingStatus = status; codingText = text; },
  };
}

const success = harness();
const first = await success.method("agent-crew.dispatch", issue);
assert.equal(first.ok, true);
assert.equal(first.value.job.status, "completed");
assert.equal(first.value.job.codingRunStatus, "ok");
assert.equal(first.value.job.workspacePath, workspacePath);
assert.equal(first.value.job.workspaceBranch, branch);
assert.match(first.value.job.sessionKey, /^agent:coding:/);
const invocation = success.calls.find((call) => call.method === "tools.invoke");
assert.equal(invocation.params.sessionKey, "agent:main:main");
const args = JSON.parse(invocation.params.args.argsJson);
assert.equal(args.agentId, "coding");
assert.equal(args.sessionKey, first.value.job.sessionKey);
assert.equal((await success.method("agent-crew.dispatch", issue)).value.job.jobId, first.value.job.jobId);
assert.equal(success.calls.filter((call) => call.method === "tools.invoke").length, 1);

const failed = harness();
failed.setCoding("error", "Coding failed");
const failure = await failed.method("agent-crew.dispatch", issue);
assert.equal(failure.ok, true);
assert.equal(failure.value.job.status, "needs-inspection");
assert.equal(failure.value.job.codingRunStatus, "error");
assert.equal(failure.value.job.codingSummary, "Coding failed");
assert.equal((await failed.method("agent-crew.dispatch", issue)).value.job.jobId, failure.value.job.jobId);
assert.equal(failed.calls.filter((call) => call.method === "tools.invoke").length, 1);

const orphan = harness({
  sessionRoot: workspacePath,
  worktree: { repoRoot: repositoryPath, branch },
  pluginExtensions: [],
});
assert.equal((await orphan.status()).details.job.status, "needs-inspection");
const blocked = await orphan.method("agent-crew.dispatch", issue);
assert.equal(blocked.ok, true);
assert.equal(blocked.value.job.status, "needs-inspection");
assert.equal(blocked.value.job.workspacePath, workspacePath);
assert.equal(orphan.calls.filter((call) => call.method === "tools.invoke").length, 0);
const resolution = await orphan.method("agent-crew.resolve", {
  ...issue, decision: "retry", note: "Inspected orphaned worktree",
});
assert.equal(resolution.ok, true);
assert.equal(resolution.value.job.status, "retry-approved");
assert.equal(orphan.session().pluginExtensions[0].value.workspacePath, workspacePath);
const resumed = await orphan.method("agent-crew.dispatch", issue);
assert.equal(resumed.ok, true);
assert.equal(resumed.value.job.status, "completed");
assert.equal(orphan.calls.filter((call) => call.method === "sessions.create").length, 0);
assert.equal(orphan.calls.filter((call) => call.method === "tools.invoke").length, 1);

console.log("Coding dispatch boundary fixtures passed: target, result status, orphan inspection and explicit retry.");
