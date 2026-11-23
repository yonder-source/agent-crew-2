# WBS4.5 active-time deadline qualification

Date: 2026-11-23

## Evidence boundaries

Controller fixtures cover the shared 1,200,000 ms active budget, excluding human
waiting, retaining usage across restart, passing remaining whole seconds to both
Lobster and the native CLI, and blocking delivery/resumption after exhaustion.
The real Slack issue 4 run independently confirms that human waiting and Gateway
replacement do not grow/reset active time; see
[live Slack evidence](wbs4.5-slack-live-qualification.md).

The runtime test below uses a separate native coding session, not a
Controller-dispatched 20-minute issue. It tests the pinned runtime deadline and
sandbox process cleanup independently of model coding success.

## Failed dispatched probe

Disposable GitHub issue 6 created job
`c0bcb685-ac30-4a94-af96-27124a2f9a5f`, native run
`58675112-d945-42ec-aba8-69bdd4877dcf`. Its model returned without executing the
timer; active time was 15,278 ms and validation was unknown. No ready coding
delivery was produced. This is a failed qualification attempt, not timeout
acceptance. After native stopped-state confirmation, the test was abandoned and
its ready label removed. Its inspection state also exercised the browser Apply
guard as recorded in [browser evidence](wbs4.5-ui-browser-qualification.md).

## Real 20-minute failure

Against image
`sha256:c7082e58f9bab060e75faeae424d36c375b273f72489ff9b1643432da65afd12`,
created session `agent:coding:time-limit-qualification-20261123`, native run
`020e65ca-7acc-462a-9ffc-466a1af0d4c0`, physical session
`9ac738a9-2b03-4515-8d0c-2d939387e6e0`. The agent RPC requested timeout 1200
seconds. The real model launched a 1300-second Node timer and a descendant
through sandbox_exec, then polled the native process facility. No repository
files were changed.

Process inspection observed PID 41 `ac-time-limit` and PID 48 `ac-time-child` in
`openclaw-sbx-workspace-f06c9753ce555607b4e0c69c1c2e9a93`, including at
14:25:26 UTC. The native run started at 1795442812944 and ended at
1795444077844: 1,264,900 ms (about 21 minutes 5 seconds). It ended with timeout,
but both processes still existed at 14:28:24 UTC, after the run had stopped.
An attempted exact-run abort found the run already inactive and did not perform
cancellation. The operator then verified the exact test PID/name pairs and
terminated them; a later scan found neither process. The cleanup generated a
later native run, so this initial failure also does not establish the no-followup
execution requirement.

## Diagnosis and correction

The pinned Codex `createCodexAttemptTurnState` timeout callback called
`runAbortController.abort(error)` directly. It notified the timeout observer,
which permits a lane-release grace period, but bypassed the host request
abort callback. This explains the terminal timeout without command cleanup.
The same runtime's Agents API timeout already uses explicit request cancellation;
that path needs no matching correction.

`scripts/patch-openclaw-timeout.mjs` changes the Codex hard-timeout branch to
explicit cancellation of the commands owned by its trusted native run ID,
followed by `connection.abortExplicitly(error)`. It retains timeout state,
observes asynchronous cleanup failure with an inspection warning, and invokes
the host abort signal. A SHA-256 guard and unique anchor reject
unexpected upstream code. It does not change a successfully recovered completed
answer into cancellation or relax uncertain-termination inspection.

`scripts/check-native-timeout.mjs` runs the actual pinned Codex turn-state
function with the native deadline and cancellation controllers. Before the fix,
a 20 ms deadline notified timeout but zero request abort callbacks, reproducing
the missing seam. Afterward, execution and unrecoverable settlement deadlines
notify abort exactly once, stop a real request-owned child, and retain their
timeout kind. Recovered settlement answers remain un-aborted with their child
untouched until fixture cleanup. The regression is part of the normal checks
image. A callback-only correction passed the initial signal assertion but failed
this stronger real-child assertion and a 30-second live test (run
`21a2c009-008c-4af2-b256-13fb57f4ac14`); it is not accepted as process cleanup.

## Live process-tree acceptance after the complete correction

Deployed image
`sha256:f97538934bfad7cdced0c0f20967cf53b548ce22b383ae5a56b804857dbfcd66`.
Session `agent:coding:time-limit-qualification-fixed2-20261123`, run
`bf19dc6a-1401-4b48-a29b-e66929dcf1f2`, physical session
`a1c878d5-7d70-45bc-aef7-29ef890ed2b2`, used a 60-second native deadline.
The real model launched the same long timer/descendant and polled it.

At 14:45:38 UTC, process inspection observed PID 47 `ac-deadline-fix` and
PID 54 `ac-deadline-kid` in
`openclaw-sbx-workspace-ed03a02ffbe4161ac928ed7d270bd55c`. After the deadline,
a scan at 14:46:18 UTC found neither process. No manual abort or PID kill was
sent for this corrected run. Native status confirmed no active run and the
same final run ID. The run started at 1795445093168 and ended at
1795445162980 (69,812 ms including startup/cancellation/finalization overhead).
Its outer terminal status was `error`, not `ok`; the callback's timeout state
and the host cancellation path are separately covered by the native regression.
This is an inspection outcome, not a coding delivery.

The positive live test uses a short deadline through the same native code path;
the complete 20-minute wall-clock test was not repeated after the correction.
The Controller cumulative-time tests remain deterministic fixtures, not a real
20-minute Controller-to-Lobster acceptance run. The configuration Apply/browser
checks, retained issue 2/4 deliveries and Slack connection also survived the final
replacement. No temporary token budget remains configured.


Repeated native status checks through approximately 14:47 UTC retained the same
final run ID with no active run: no follow-up execution was observed during that
post-timeout window. A separate ordinary tool-using turn returned `USAGE-OK`,
status `ok`, and reported 14,958 tokens (run
`2e315d73-eaa9-4b6e-8d2c-6df30909da9d`), confirming the timeout backport does not
abort successful tool execution. The final full checks-image suite passed.
