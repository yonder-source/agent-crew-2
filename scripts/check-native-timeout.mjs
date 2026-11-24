import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { p as runExec } from "/app/dist/bash-tools.exec-runtime-DOUptw4_.mjs";
import { f as withTurn, o as captureOwners } from "/app/dist/exec-request-context-CWnK9ayt.mjs";
import { n as captureCommands } from "/app/dist/bash-process-control-D15pjJye.mjs";
import { f as createDeadline, d as createCancellation } from "/app/dist/agent-harness-attempt-runtime-CqwPOOH9.mjs";

// Exercise the pinned Codex timeout callback with the native deadline/cancellation
// controllers and a real request-owned child. Live tests cover the Docker process tree.
const source = await readFile("/app/dist/run-attempt-8n2nAOHg.mjs", "utf8");
const start = source.indexOf("function createCodexAttemptTurnState(resources)");
assert.ok(start >= 0);
const end = source.indexOf("//#endregion", start);
assert.ok(end > start);
const createTurn = runInContext(`${source.slice(start, end)}; createCodexAttemptTurnState`, createContext({
  CodexAttemptState: class {},
  createDeferred: () => Promise.withResolvers(),
  createAgentHarnessToolExecutionRegistry: () => ({}),
  createAgentHarnessAttemptDeadlineController: createDeadline,
  captureExecRequestCancellation: captureCommands,
  TURN_TERMINAL_SETTLEMENT_TIMEOUT_MS: 20,
  log: { warn() {} },
  Date,
}));

for (const kind of ["execution", "settlement", "recovered-settlement"]) {
  const identity = {runId: `timeout-fixture-${kind}`, sessionKey: "agent:coding:timeout-fixture", agentId: "coding", sessionId: "timeout-fixture"};
  await withTurn({identity}, async () => {
    const running = await runExec({
      command: "disposable timeout fixture", ...identity, scopeKey: identity.sessionKey,
      requestOwners: captureOwners(identity), env: process.env, workdir: "/tmp",
      timeoutSec: 10, maxOutput: 1000, pendingMaxOutput: 1000, warnings: [],
      sandbox: {
        prepareProcessCleanup: () => ({terminate: async () => {}}),
        buildExecSpec: async () => ({argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"], env: process.env, cwd: "/tmp", stdinMode: "pipe"}),
        finalizeExec: async () => {},
      },
    });
    let aborts = 0;
    let timeouts = 0;
    const cancellation = createCancellation({
      state: { terminalOutcomeFrozen: false },
      onAttemptAbort: () => { aborts += 1; },
    });
    const connection = {
      params: { ...identity, timeoutMs: 20, onAttemptTimeout: () => { timeouts += 1; } },
      options: {}, runAbortController: cancellation.controller,
      abortExplicitly: cancellation.abortExplicitly,
      attemptStartedAt: Date.now(), attemptStartedAtMonotonicMs: performance.now(),
    };
    const turn = createTurn({
      prompt: { context: { runtime: { connection }, attemptTools: { toolBridge: { telemetry: {} } } } },
      state: { thread: { threadId: "fixture" } },
      projectorRef: { current: kind === "recovered-settlement" ? {
        settlement: {}, recoverCompletedAnswer: () => true,
      } : undefined },
    });
    try {
      if (kind !== "execution") turn.completeTurn();
      await new Promise(resolve => setTimeout(resolve, 60));
      if (kind === "recovered-settlement") {
        assert.equal(aborts, 0, "Recovering a completed answer must not abort it");
        assert.equal(cancellation.controller.signal.aborted, false);
        assert.equal(turn.state.timeout, undefined);
        assert.doesNotThrow(() => process.kill(running.pid, 0));
      } else {
        assert.equal(timeouts, 1);
        assert.equal(aborts, 1, "Timeout must enter the host request abort path");
        assert.equal(cancellation.controller.signal.aborted, true);
        assert.equal(turn.state.timeout.kind, kind, "Preserve the timeout classification");
        assert.throws(() => process.kill(running.pid, 0), /ESRCH/, "Timeout must stop the real request-owned child process");
      }
    } finally {
      turn.deadlines.dispose();
      cancellation.dispose();
      const commands = captureCommands({runId: identity.runId});
      commands.cancel();
      await commands.settle();
      running.kill();
      await running.promise;
    }
  });
}
console.log("Native Codex deadlines notify request cancellation while retaining timeout classification.");
