import { authorizesSlackTaskReply, isReplyAfterSlackConnection, parseSlackTaskReply } from "../dist/slack-task-reply.js";
import { isSlackTaskThread, postTaskSlackMessage } from "../dist/slack-task-thread.js";
import { performance } from "node:perf_hooks";
import { TaskBaseError } from "../dist/repository-clone.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { assignedIssueFromSession, trustedSessionKey } from "../dist/assignment.js";
import { createContext, runInContext } from "node:vm";
import { IssueDiscovery } from "../dist/discovery.js";
import { GitHubAppClient } from "../dist/github-app.js";
import { isCodingDelivery, normalizeCodingUsage, isCodingUsage, addCodingUsage, parseTokenBudget } from "../dist/coding-result.js";

const source = readFileSync(process.env.DISPATCHER_SOURCE ?? "dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
let session = null;
let calls = [];
let updateFailure = new Error("GitHub issue update outcome is uncertain");
let updateGate = Promise.resolve();
let holdWorkflow = false;
let workflowStartedResolve;
const workflowStarted = new Promise((resolve) => { workflowStartedResolve = resolve; });
let releaseWorkflowResolve;
const workflowRelease = new Promise((resolve) => { releaseWorkflowResolve = resolve; });
const tools = new Map();
const methods = new Map();
let issueToolFactory;
const context = createContext({ authorizesSlackTaskReply, isReplyAfterSlackConnection, parseSlackTaskReply, isSlackTaskThread, postTaskSlackMessage, performance,
  TaskBaseError, createHash, randomUUID, isCodingDelivery, normalizeCodingUsage, isCodingUsage, addCodingUsage, parseTokenBudget, process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
  assignedIssueFromSession, trustedSessionKey,
  GitHubAppClient,
  Type: new Proxy({}, { get: () => () => ({}) }),
  GitHubIssueError: class GitHubIssueError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
  OctokitGitHubIssueProvider: class {
    async updateIssueBody() { await updateGate; if (updateFailure) throw updateFailure; return { body: "Changed" }; }
    async readIssue(repository, number) { return { repository, number, title: "Issue", body: "Body", state: "open", labels: [] }; }
  },
  GitHubPullRequestError: class GitHubPullRequestError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
  OctokitGitHubPullRequestProvider: class {
    async findExisting() { return undefined; }
    async create() { throw new Error("Synthetic dispatcher must not create a pull request"); }
  },
  IssueDiscovery: class {},
  parseConfig: () => ({ environment: "test", github: { repository: "owner/repo", pollIntervalMs: 60_000 } }), definePluginEntry: (entry) => entry,
  callGatewayFromCli: async (method, _options, params) => {
    calls.push(method);
    if (method === "sessions.describe") return { session };
    if (method === "sessions.create") { session = { pluginExtensions: [] }; return {}; }
    if (method === "sessions.pluginPatch") {
      session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: params.value }];
      return {};
    }
    if (method === "tools.invoke") {
      if (holdWorkflow) {
        workflowStartedResolve();
        await workflowRelease;
        holdWorkflow = false;
      }
      return { ok: true, output: { details: {
        ok: true, status: "needs_approval", requiresApproval: { resumeToken: "SECRET-CONTINUATION" },
      } } };
    }
    throw new Error(`Unexpected method: ${method}`);
  },
});
runInContext(source, context);
context.entry.register({
  session: { state: { registerSessionExtension() {} } },
  registerTool: (tool) => {
    if (tool.create) issueToolFactory = tool;
    else tools.set(tool.name, tool);
  },
  registerGatewayMethod: (name, handler, options) => methods.set(name, { handler, options }),
  on() {},
  registerService() {},
  logger: { info() {}, error() {} },
});
const params = { repository: "owner/repo", issueNumber: 1 };
const dispatch = async () => {
  let result;
  let failure;
  await methods.get("agent-crew.dispatch").handler({
    params,
    respond: (ok, value, error) => { if (ok) result = value; else failure = error; },
  });
  if (failure) throw new Error(failure.message);
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
};
const status = () => tools.get("agent_crew_status").execute("test", params);
const safe = (value) => assert.ok(!JSON.stringify(value).includes("SECRET-CONTINUATION"));
const resolveIssueUpdate = async (decision) => {
  let result;
  await methods.get("agent-crew.resolve").handler({
    params: { ...params, target: "issue-update", decision, note: "Inspected synthetic issue body" },
    respond: (ok, value, error) => {
      assert.equal(ok, true, error?.message);
      result = value;
    },
  });
  return result;
};
assert.ok(!tools.has("agent_crew_dispatch"), "Agents must not be able to dispatch arbitrary issues");
assert.equal(methods.get("agent-crew.dispatch").options.scope, "operator.admin");

holdWorkflow = true;
const runningDispatch = dispatch();
await workflowStarted;
await methods.get("agent-crew.setup.apply").handler({
  respond: (ok, _value, error) => {
    assert.equal(ok, false);
    assert.equal(error.code, "SETUP_APPLY_BLOCKED");
  },
});
assert.equal(calls.filter((method) => method === "sessions.describe").length, 1);
const assignedJob = session.pluginExtensions[0].value;
const issueTools = issueToolFactory.create({
  sessionKey: assignedJob.sessionKey,
  assertInvocationCurrent() {},
});
const updateTool = issueTools.find((tool) => tool.name === "agent_crew_issue_update");
await assert.rejects(updateTool.execute("test", { body: "Changed" }), /outcome is uncertain/);
assert.equal(session.pluginExtensions[0].value.issueUpdate.status, "needs-inspection",
  "An uncertain body write must persist its inspection marker");
let confirmationTimer;
const confirmation = resolveIssueUpdate("confirm");
const confirmationResult = await Promise.race([
  confirmation.then((value) => ({ finished: true, value })),
  new Promise((resolve) => { confirmationTimer = setTimeout(() => resolve({ finished: false }), 1_000); }),
]);
clearTimeout(confirmationTimer);
if (!confirmationResult.finished) releaseWorkflowResolve();
assert.equal(confirmationResult.finished, true,
  "Issue update operator resolution must not wait for the running workflow's dispatcher queue");
assert.equal(confirmationResult.value.job.issueUpdate.status, "confirmed");
releaseWorkflowResolve();
safe(await runningDispatch);
assert.equal(session.pluginExtensions[0].value.workflowRef, "SECRET-CONTINUATION");
assert.equal(session.pluginExtensions[0].value.issueUpdate.status, "confirmed",
  "Workflow completion must preserve issue update decisions written during the workflow");
safe(await status());
safe(await dispatch());

for (const [decision, expectedStatus] of [
  ["confirm", "confirmed"],
  ["retry", "retry-approved"],
  ["abandon", "abandoned"],
]) {
  session.pluginExtensions[0].value.issueUpdate.status = "needs-inspection";
  const issueResolution = await resolveIssueUpdate(decision);
  assert.equal(issueResolution.job.issueUpdate.status, expectedStatus);
  assert.match(issueResolution.job.issueUpdate.decision, new RegExp(`^${decision}:`));
}

session.pluginExtensions[0].value.status = "needs-inspection";
let resolution;
  await methods.get("agent-crew.resolve").handler({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, value) => { assert.equal(ok, true); resolution = value; } });
safe(resolution);
for (const malformed of [undefined, false, [], { pluginExtensions: {} },
  { pluginExtensions: [null] }, { pluginExtensions: [{ pluginId: 1, namespace: "x" }] }]) {
  session = malformed;
  calls = [];
  await assert.rejects(dispatch(), /Invalid/);
  assert.deepEqual(calls, ["sessions.describe"]);
  await assert.rejects(status(), /Invalid/);
}
session = {};
calls = [];
safe(await dispatch());
assert.equal(calls.filter((method) => method === "sessions.describe").length, 2,
  "Dispatcher completion reloads the latest job metadata before patching workflow status");
assert.ok(!calls.includes("sessions.create"));
// Poll the actual discovery class through the registered dispatcher.
const workflowCount = () => calls.filter(method => method === "tools.invoke").length;
const startsBeforePoll = workflowCount();
session = null;
const discovery = new IssueDiscovery({
  repository: params.repository,
  listReadyIssues: async () => [{ repository: params.repository, number: params.issueNumber }],
  dispatch: async () => dispatch(),
  onComplete() {},
  onFailure(error) { throw error; },
});
await discovery.poll();
await discovery.poll();
assert.equal(workflowCount(), startsBeforePoll + 1, "Repeated discovery must start exactly one workflow");

// A live PATCH is not an interrupted operation and cannot be resolved.
const liveJob = session.pluginExtensions[0].value;
liveJob.status = "active";
delete liveJob.issueUpdate;
const liveUpdateTool = issueToolFactory.create({sessionKey: liveJob.sessionKey, assertInvocationCurrent() {}})
  .find(tool => tool.name === "agent_crew_issue_update");
let finishUpdate;
updateGate = new Promise(resolve => { finishUpdate = resolve; });
updateFailure = undefined;
const liveUpdate = liveUpdateTool.execute("test", {body: "Changed"});
for (let attempt = 0; attempt < 100 && !session.pluginExtensions[0].value.issueUpdate; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1));
}
assert.equal((await status()).details.job.issueUpdate.status, "writing");
for (const decision of ["confirm", "retry", "abandon"]) {
  await methods.get("agent-crew.resolve").handler({
    params: {...params, target:"issue-update", decision, note:"Request still running"},
    respond: ok => assert.equal(ok, false, "Operator must not resolve a live PATCH"),
  });
}
finishUpdate();
await liveUpdate;
assert.equal(session.pluginExtensions[0].value.issueUpdate, undefined);

// A retained writing marker without an in-process operation is interrupted.
session.pluginExtensions[0].value.issueUpdate = {
  status:"writing", operationId:"prior-process", bodyHash:"fixture-hash", updatedAt:new Date().toISOString(),
};
assert.equal((await status()).details.job.issueUpdate.status, "needs-inspection");
await assert.rejects(liveUpdateTool.execute("test", {body:"Changed"}), /inspection/);

// Workflow-only retry must retain the separate issue write inspection boundary.
for (const updateStatus of ["needs-inspection", "abandoned"]) {
  session.pluginExtensions[0].value.status = "needs-inspection";
  session.pluginExtensions[0].value.issueUpdate.status = updateStatus;
  await methods.get("agent-crew.resolve").handler({
    params: {...params, decision:"retry", note:"Workflow only"},
    respond: ok => assert.equal(ok, true),
  });
  await dispatch();
  assert.equal(session.pluginExtensions[0].value.issueUpdate.status, updateStatus);
  await assert.rejects(liveUpdateTool.execute("test", {body:"Changed"}), /inspection/);
}
console.log("Dispatcher boundary checks passed (mock Gateway; issue update inspection and operator decisions covered; no runtime qualification)");
