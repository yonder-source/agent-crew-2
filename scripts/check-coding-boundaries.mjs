import { TaskBaseError } from "../dist/repository-clone.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { assignedIssueFromSession, trustedSessionKey } from "../dist/assignment.js";
import { GitHubAppError } from "../dist/github-app.js";
import { IssueDiscovery } from "../dist/discovery.js";
import { connectionConfig } from "../dist/setup-config.js";

const source = readFileSync("dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
const issue = { repository: "owner/repo", issueNumber: 7 };
const repositoryPath = "/workspaces/repositories/owner/repo";
const workspacePath = "/home/node/.openclaw/worktrees/fixture/issue-7";
const branch = "openclaw/agent-crew-issue-7";

function harness(initialSession = null) {
  let session = initialSession;
  let codingStatus = "ok";
  let codingText = "Changed README; validation passed";
  let failConfigPatch = false;
  let inventory = { sessions: [] };
  const setupDraft = { githubAppId: "123", repository: "owner/repo", installationId: "17", repositoryPath,
    codingAgentId: "coding", designerAgentId: "", codingChannelId: "", designerChannelId: "", codingUserIds: "", designerUserIds: "", tokenBudget: "" };
  const calls = [];
  const methods = new Map();
  const registeredTools = new Map();
  const context = createContext({
    TaskBaseError, createHash, randomUUID,
    readFile: async () => "fixture-token",
    prepareTaskBase: async () => "a".repeat(40),
    verifyTaskWorkspace: async () => {},
    process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
    assignedIssueFromSession, trustedSessionKey,
    connectionConfig,
    GitHubAppError,
    GitHubAppClient: class {
      async installationTokenForRepository() { return "fixture-token"; }
      async repositoryAccess() { return { permissions: { contents: "write", issues: "write", pull_requests: "write" } }; }
    },
    validateCheckout: async () => ({ id: "checkout", status: "passed", message: "Fixture remote matches" }),
    cloneRepository: async (options) => { calls.push({ method: "clone", params: options }); return { status: "cloned" }; },
    Type: new Proxy({}, { get: () => () => ({}) }),
    GitHubIssueError: class GitHubIssueError extends Error {},
    OctokitGitHubIssueProvider: class {
      async readIssue(repository, number) {
        return { repository, number, title: "Fixture", body: "Change README", state: "open", labels: ["ready for agent"] };
      }
    },
    IssueDiscovery,
    parseConfig: () => ({
      environment: "test", github: { repository: "owner/repo", pollIntervalMs: 60_000 },
      coding: { agentId: "coding", repositoryPath },
    }),
    definePluginEntry: (entry) => entry,
    callGatewayFromCli: async (method, _options, params) => {
      calls.push({ method, params });
      if (method === "sessions.list") return inventory;
      if (method === "agents.list") return { agents: [{ id: "coding" }] };
      if (method === "config.get") return { hash: "fixture-revision", config: {
        agents: { entries: { coding: { model: "fixture-model" } } },
        gateway: { auth: { token: "__OPENCLAW_REDACTED__" } },
        plugins: { allow: ["agent-crew", "fixture-plugin"], entries: { "agent-crew": { config: { environment: "test" } }, "fixture-plugin": { enabled: true } } },
      } };
      if (method === "config.set") {
        if (failConfigPatch) throw new Error("Simulated config commit transport failure");
        return { ok: true };
      }
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
        ok: true, status: "ok", output: [{
          runId: "run-7", status: codingStatus, text: codingText,
          workspacePath, workspaceBranch: branch,
        }],
      } } };
      throw new Error(`Unexpected method: ${method}`);
    },
  });
  runInContext(source, context);
  context.entry.register({
    runtime: { state: { openKeyedStoreV2: () => ({ lookup: async () => setupDraft }) } },
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
    setInventory(value) { inventory = value; },
    failConfigPatch() { failConfigPatch = true; },
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
assert.equal(args.workspacePath, workspacePath);
assert.equal(args.workspaceBranch, branch);
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
assert.equal(resumed.ok, false);
assert.equal(orphan.calls.filter((call) => call.method === "sessions.create").length, 0);
assert.equal(orphan.calls.filter((call) => call.method === "tools.invoke").length, 0);

const setup = harness();
const cloneParams = { appId: "123", installationId: 17, repository: "owner/repo", repositoryPath };
assert.equal((await setup.method("agent-crew.setup.repository.clone", cloneParams)).ok, true);
const applied = harness();
const validated = await applied.method("agent-crew.setup.validate", {});
assert.equal((await applied.method("agent-crew.setup.apply", { draftHash: validated.value.draftHash })).ok, true);
const configWrite = applied.calls.find(call => call.method === "config.set");
assert.equal(configWrite.params.baseHash, "fixture-revision");
const patchedConnection = JSON.parse(configWrite.params.raw).plugins.entries["agent-crew"].config;
assert.equal(patchedConnection.github.installationId, 17);
assert.equal(patchedConnection.coding.repositoryPath, repositoryPath);
const replacement = JSON.parse(configWrite.params.raw);
assert.equal(replacement.agents.entries.coding.model, "fixture-model");
assert.equal(replacement.gateway.auth.token, "__OPENCLAW_REDACTED__");
assert.deepEqual(replacement.plugins.allow, ["agent-crew", "fixture-plugin"]);
assert.equal(replacement.plugins.entries["fixture-plugin"].enabled, true);
const activeApply = harness();
activeApply.setInventory({ sessions: [{ key: "agent:coding:agent-crew-" + "a".repeat(32), hasActiveRun: true }] });
assert.equal((await activeApply.method("agent-crew.setup.apply", {})).ok, false);
assert.equal(activeApply.calls.some(call => call.method === "clone" || call.method === "config.set"), false);
const uncertainApply = harness();
uncertainApply.failConfigPatch();
const uncertainValidation = await uncertainApply.method("agent-crew.setup.validate", {});
assert.equal((await uncertainApply.method("agent-crew.setup.apply", { draftHash: uncertainValidation.value.draftHash })).ok, false);
const uncertainPolling = await uncertainApply.method("agent-crew.setup.polling.status", {});
assert.equal(uncertainPolling.value.running, false);
assert.match(uncertainPolling.value.reason, /inspection/);
assert.equal((await uncertainApply.method("agent-crew.setup.polling.resume", {})).ok, true);
const changedDraft = harness();
assert.equal((await changedDraft.method("agent-crew.setup.apply", { draftHash: "outdated" })).ok, false);
assert.equal(changedDraft.calls.some(call => call.method === "config.set" || call.method === "clone"), false);
const cloneCount = () => setup.calls.filter(call => call.method === "clone").length;
assert.equal(cloneCount(), 1);
for (const inventory of [
  { sessions: [], hasMore: true },
  { sessions: [{ key: "agent:coding:agent-crew-" + "a".repeat(32), hasActiveRun: true }] },
  { sessions: [{ key: "agent:coding:agent-crew-" + "a".repeat(32) }] },
]) {
  setup.setInventory(inventory);
  assert.equal((await setup.method("agent-crew.setup.repository.clone", cloneParams)).ok, false);
  assert.equal(cloneCount(), 1, "Unsafe inventory must block clone before credential issuance");
}
setup.setInventory({ sessions: [] });
assert.equal((await setup.method("agent-crew.setup.repository.clone", cloneParams)).ok, true);
console.log("Coding dispatch and setup admission boundary fixtures passed.");
