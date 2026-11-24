import assert from "node:assert/strict";
// Exercise the pinned runtime's real process finalization and request cancellation.
import { p as runExec } from "/app/dist/bash-tools.exec-runtime-DOUptw4_.mjs";
import { f as withTurn, o as captureOwners } from "/app/dist/exec-request-context-CWnK9ayt.mjs";
import { n as captureCancellation, a as isConfirmedRequestedStop } from "/app/dist/bash-process-control-D15pjJye.mjs";
async function checkStop(failTermination) {
  const identity = { runId: `native-stop-fixture-${failTermination}`, sessionId: "fixture-session", sessionKey: "agent:coding:native-stop-fixture", agentId: "coding" };
  await withTurn({ identity }, async () => {
    let cleanupConfirmed = false;
    const running = await runExec({
      command: "disposable timer", agentId: "coding", sessionKey: identity.sessionKey,
      scopeKey: identity.sessionKey, requestOwners: captureOwners(identity),
      env: process.env, workdir: "/tmp", timeoutSec: 30, maxOutput: 1000, pendingMaxOutput: 1000, warnings: [],
      sandbox: {
        prepareProcessCleanup: () => ({ terminate: async () => { if (failTermination) throw new Error("fixture: termination uncertain"); cleanupConfirmed = true; } }),
        buildExecSpec: async () => ({ argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"], env: process.env, cwd: "/tmp", stdinMode: "pipe" }),
        finalizeExec: async () => { throw new Error("fixture: cancelled workspace checkpoint"); },
      },
    });
    try {
      const cancellation = captureCancellation({ runId: identity.runId });
      assert.equal(cancellation.cancel(), true);
      if (failTermination) await assert.rejects(cancellation.settle(), /cleanup could not be confirmed/);
      else await cancellation.settle();
      await running.promise;
      assert.equal(cleanupConfirmed, !failTermination);
      assert.equal(running.session.processCleanupConfirmed === true, !failTermination);
      assert.equal(isConfirmedRequestedStop(running.session), !failTermination);
      assert.equal(running.session.finalizationFailed, true, "Artifact failure stays visible");
      assert.throws(() => process.kill(running.pid, 0), /ESRCH/, "The real child process exited");
    } finally {
      running.kill();
      await running.promise;
    }
  });
}
await checkStop(false);
await checkStop(true);
console.log("Native request cancellation confirms process stop independently of artifact checkpoint failure.");
