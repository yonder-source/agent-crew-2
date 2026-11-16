import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { assignedIssueFromSession, trustedSessionKey } from "../dist/assignment.js";
import vm from "node:vm";

const source = readFileSync(process.env.DISPATCHER_SOURCE ?? "dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
let session = null;
let calls = [];
let updateFailure = new Error("GitHub issue update outcome is uncertain");
let holdWorkflow = false;
let workflowStartedResolve;
const workflowStarted = new Promise((resolve) => { workflowStartedResolve = resolve; });
let releaseWorkflowResolve;
const workflowRelease = new Promise((resolve) => { releaseWorkflowResolve = resolve; });
const tools = new Map();
const methods = new Map();
let issueToolFactory;
const context = vm.createContext({
  createHash, randomUUID, process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
  assignedIssueFromSession, trustedSessionKey,
  Type: new Proxy({}, { get: () => () => ({}) }),
  GitHubIssueError: class GitHubIssueError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
  OctokitGitHubIssueProvider: class {
    async updateIssueBody() { throw updateFailure; }
    async readIssue(repository, number) { return { repository, number, title: "Issue", body: "Body", state: "open", labels: [] }; }
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
vm.runInContext(source, context);
context.entry.register({
  session: { state: { registerSessionExtension() {} } },
  registerTool: (tool) => {
    if (tool.create) issueToolFactory = tool;
    else tools.set(tool.name, tool);
  },
  registerGatewayMethod: (name, handler, options) => methods.set(name, { handler, options }),
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
console.log("Dispatcher boundary checks passed (mock Gateway; issue update inspection and operator decisions covered; no runtime qualification)");
