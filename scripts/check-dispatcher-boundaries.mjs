import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(process.env.DISPATCHER_SOURCE ?? "dist/index.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default definePluginEntry", "globalThis.entry = definePluginEntry");
let session = null;
let calls = [];
let intercept = () => undefined;
const tools = new Map();
let resolve;
const context = createContext({
  createHash, randomUUID, process: { env: { AGENT_CREW_GATEWAY_TOKEN: "test" } },
  Type: new Proxy({}, { get: () => () => ({}) }),
  parseConfig: () => ({ environment: "test" }), definePluginEntry: (entry) => entry,
  callGatewayFromCli: async (method, _options, params) => {
    calls.push(method);
    const replacement = await intercept(method, params);
    if (replacement !== undefined) return replacement.value;
    if (method === "sessions.describe") return { session };
    if (method === "sessions.create") { session = { pluginExtensions: [] }; return {}; }
    if (method === "sessions.pluginPatch") {
      session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: params.value }];
      return {};
    }
    if (method === "tools.invoke") return { ok: true, output: { details: {
      ok: true, status: "needs_approval", requiresApproval: { resumeToken: "SECRET-CONTINUATION" },
    } } };
    throw new Error(`Unexpected method: ${method}`);
  },
});
runInContext(source, context);
context.entry.register({
  session: { state: { registerSessionExtension() {} } },
  registerTool: (tool) => tools.set(tool.name, tool),
  registerGatewayMethod: (_name, handler) => { resolve = handler; },
});
const params = { repository: "owner/repo", issueNumber: 1 };
const dispatch = () => tools.get("agent_crew_dispatch").execute("test", params);
const status = () => tools.get("agent_crew_status").execute("test", params);
const safe = (value) => assert.ok(!JSON.stringify(value).includes("SECRET-CONTINUATION"));
safe(await dispatch());
assert.equal(calls.filter((method) => method === "sessions.describe").length, 1);
assert.equal(session.pluginExtensions[0].value.workflowRef, "SECRET-CONTINUATION");
safe(await status());
safe(await dispatch());
session.pluginExtensions[0].value.status = "needs-inspection";
let resolution;
await resolve({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, value) => { assert.equal(ok, true); resolution = value; } });
safe(resolution);
const validJob = session.pluginExtensions[0].value;
for (const state of ["starting", "active", "completed", "needs-inspection", "abandoned"]) {
  session.pluginExtensions[0].value = { ...validJob, status: state };
  calls = [];
  assert.equal((await dispatch()).details.status, state === "starting" ? "needs-inspection" : state);
  assert.deepEqual(calls, ["sessions.describe"], `${state} must block another start`);
}
session.pluginExtensions[0].value = { ...validJob, status: "retry-approved" };
calls = [];
await dispatch();
assert.equal(calls.filter((method) => method === "tools.invoke").length, 1);
for (const patch of [
  { repository: "other/repo" }, { number: 2 }, { sessionKey: "other" },
  { jobId: null }, { bootId: 0 }, { updatedAt: false }, { status: "unknown" },
  { workflowRef: {} }, { workflowStatus: [] }, { workflowStatus: "unknown" }, { error: 1 }, { decision: null },
]) {
  session.pluginExtensions[0].value = { ...validJob, ...patch };
  calls = [];
  await assert.rejects(dispatch(), /Invalid issue admission metadata/);
  assert.deepEqual(calls, ["sessions.describe"]);
  await assert.rejects(status(), /Invalid issue admission metadata/);
}
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
assert.equal(calls.filter((method) => method === "sessions.describe").length, 1);
assert.ok(!calls.includes("sessions.create"));

const canary = "SECRET-GATEWAY-FAILURE";
const countInvocations = () => calls.filter((method) => method === "tools.invoke").length;
const reset = () => { session = null; calls = []; intercept = () => undefined; };
const hidden = (value) => assert.ok(!String(value).includes(canary), "Gateway error leaked");

reset();
session = { pluginExtensions: [{ pluginId: "agent-crew", namespace: "agent-crew-job",
  value: { ...validJob, status: "needs-inspection", error: canary } }] };
hidden(JSON.stringify(await status()));
hidden(JSON.stringify(await dispatch()));
await resolve({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, value) => { assert.equal(ok, true); hidden(JSON.stringify(value)); } });

reset();
intercept = (method) => method === "tools.invoke" ? { value: { ok: true, output: { details: {
  ok: true, status: "needs_input", requiresInput: { resumeToken: "SECRET-CONTINUATION" },
} } } } : undefined;
const needsInput = await dispatch();
safe(needsInput);
assert.equal(needsInput.details.status, "active");
assert.equal(session.pluginExtensions[0].value.workflowRef, "SECRET-CONTINUATION");

for (const response of [null, {}, [], { session: false }, { session: { pluginExtensions: [
  { pluginId: "agent-crew", namespace: "agent-crew-job" },
] } }, { session: { pluginExtensions: [
  { pluginId: "agent-crew", namespace: "agent-crew-job", value: validJob },
  { pluginId: "agent-crew", namespace: "agent-crew-job", value: validJob },
] } }]) {
  reset();
  intercept = (method) => method === "sessions.describe" ? { value: response } : undefined;
  await assert.rejects(dispatch(), /Invalid/);
  assert.equal(countInvocations(), 0);
}

// Gateway errors can contain credentials; check both tool and operator surfaces.
reset();
intercept = () => { throw new Error(canary); };
await assert.rejects(dispatch(), (error) => { hidden(error); return true; });
await assert.rejects(status(), (error) => { hidden(error); return true; });
let rejected;
await resolve({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, _value, error) => { assert.equal(ok, false); rejected = error; } });
hidden(JSON.stringify(rejected));

// Malformed responses cannot be interpreted as a successful workflow.
for (const response of [null, {}, { ok: false, error: canary },
  { ok: false, output: { details: { ok: true, status: "ok" } } },
  { ok: true }, { ok: true, output: { details: { ok: false, error: canary } } },
  { ok: true, output: { details: { ok: false, status: "ok" } } },
  { ok: true, output: { details: { ok: true, status: "unknown" } } },
  { ok: true, output: { details: { ok: true, status: "needs_approval" } } },
  { ok: true, output: { details: { ok: true, status: "needs_input", requiresInput: { resumeToken: 1 } } } }]) {
  reset();
  intercept = (method) => method === "tools.invoke" ? { value: response } : undefined;
  const result = await dispatch();
  hidden(JSON.stringify(result));
  assert.equal(result.details.status, "needs-inspection");
  assert.equal(session.pluginExtensions[0].value.status, "needs-inspection");
  assert.equal(countInvocations(), 1);
  await dispatch();
  assert.equal(countInvocations(), 1);
}

// Failure before admission cannot invoke; failure after invocation blocks retry.
reset();
intercept = (method) => { if (method === "sessions.pluginPatch") throw new Error(canary); };
await assert.rejects(dispatch(), (error) => { hidden(error); return true; });
assert.equal(countInvocations(), 0);

reset();
intercept = (method, input) => {
  if (method === "sessions.pluginPatch") {
    session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: input.value }];
    throw new Error(canary);
  }
};
await assert.rejects(dispatch(), (error) => { hidden(error); return true; });
assert.equal(session.pluginExtensions[0].value.status, "starting");
assert.equal((await dispatch()).details.status, "needs-inspection");
assert.equal(countInvocations(), 0);

reset();
let patches = 0;
intercept = (method) => {
  if (method === "sessions.pluginPatch" && ++patches === 2) throw new Error(canary);
};
const uncertain = await dispatch();
hidden(JSON.stringify(uncertain));
assert.equal(uncertain.details.status, "needs-inspection");
assert.equal(session.pluginExtensions[0].value.status, "needs-inspection");
await dispatch();
assert.equal(countInvocations(), 1);

reset();
patches = 0;
intercept = (method, input) => {
  if (method === "sessions.pluginPatch" && ++patches === 2) {
    session.pluginExtensions = [{ pluginId: "agent-crew", namespace: "agent-crew-job", value: input.value }];
    throw new Error(canary);
  }
};
const lostResponse = await dispatch();
hidden(JSON.stringify(lostResponse));
assert.equal(lostResponse.details.status, "needs-inspection");
assert.equal(session.pluginExtensions[0].value.status, "needs-inspection");
await dispatch();
assert.equal(countInvocations(), 1);

reset();
patches = 0;
intercept = (method) => {
  if (method === "sessions.pluginPatch" && ++patches > 1) throw new Error(canary);
};
await assert.rejects(dispatch(), (error) => { hidden(error); return true; });
assert.equal(session.pluginExtensions[0].value.status, "starting");
assert.equal((await status()).details.status, "needs-inspection");
await dispatch();
assert.equal(countInvocations(), 1);
intercept = () => undefined;
await resolve({ params: { ...params, decision: "abandon", note: "inspected" },
  respond: (ok, value) => { assert.equal(ok, true); assert.equal(value.job.status, "abandoned"); } });
assert.equal((await status()).details.status, "abandoned");

reset();
intercept = (method) => { if (method === "tools.invoke") throw new Error(canary); };
const failed = await dispatch();
hidden(JSON.stringify(failed));
assert.equal(failed.details.status, "needs-inspection");
await dispatch();
assert.equal(countInvocations(), 1);
console.log("Dispatcher boundary checks passed (mock Gateway; no runtime qualification)");
