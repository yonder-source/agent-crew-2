# WBS4.5 coding token accounting qualification

Date: 2026-11-23. Runtime: OpenClaw 2026.11.3.
Initial scope: read-only source inspection and a live usage query against the
completed issue-4 session. Subsequent deployment, model execution and abort
qualification are recorded in the final section below.

## Observed accounting

Authenticated operator `sessions.usage` was called with the retained key
`agent:coding:agent-crew-fb19503e3f8d0a1a9a3296860382eb75` and explicit dates
2026-11-22 through 2026-11-23. It returned exactly the expected physical session
`ef0b6ec3-d96d-4dd4-b848-c01710432725`, scope=instance, and fresh cache status
with no pending or stale files. The session includes the initial waiting turn
and the human-triggered continuation previously qualified in the Slack evidence.

Reported usage: input=13757, output=179, cacheRead=17152, cacheWrite=0,
totalTokens=31088. The components sum to the reported total. Daily buckets
reported 13335 and 17753 tokens in the two activity intervals, also summing to
31088. These are runtime/provider-reported token counts, not a billing guarantee.
A date-bounded query only proves coverage within that range; a task spanning
more days must not silently lose earlier usage.

## Source findings in the pinned image

- `session-store-Bjr03Vet.mjs`, around lines 88–100 and 154–160: session-row
  totalTokens is derived from last-call/context information and replaced after
  compaction. It is not a cumulative task counter.
- `session-transcript-derived-readers-BsCqBl32.mjs`, around lines 51–107:
  inputTokens/outputTokens/cacheRead/cacheWrite are summed, while totalTokens
  is the latest context snapshot and may be estimated for artifact transcripts.
  `totalTokensFresh` alone does not establish cumulative provider usage.
- `usage-BKht8b9M.mjs`, sessions.usage handler around line 1462: supports an
  exact session key, agent ownership resolution, date ranges and instance/family
  grouping. The live response above used instance scope. Its usage.totalTokens
  is distinct from the session-row context total.
- `sessions-abort-CBU9vmKF.mjs`, around line 90: sessions.abort resolves key,
  runId and agent identity and supports clearQueued. Reading this handler proves
  API presence, not that abort terminates an in-flight provider request or all
  coding tools. No live abort acceptance is claimed.

## Initial implementation boundary (subsequent progress below)

Do not enforce a task budget using session-row totalTokens or an agent-authored
report. Before wiring enforcement, qualify whether native per-run results expose
complete usage for retries and compaction, whether sessions.usage includes all
such activity without double counting, and how missing provider usage is exposed.
A fresh aggregate and missingCostEntries=0 do not by themselves prove every model
request has a token report. Missing token data must retain unknown/inspection.

Bind accounting to the trusted job and physical session, persist completed-turn
checkpoints, and prevent duplicate aggregation after resume/restart. Qualify the
stop path separately with a disposable run before claiming an active budget cap.
The existing 20-minute active-time policy remains implemented. Subsequent
implementation sections below record progress on token configuration and status.

## Latest-turn usage implementation

The coding-result adapter now reads result.meta.agentMeta.usage from the native
CLI envelope, never the agent-authored JSON payload. It normalizes nonnegative
safe integer counts into reported/unknown, rejecting malformed totals/components,
component sums exceeding total, unavailable usage and unsupported report states.
Only total/input/output/cacheRead/cacheWrite survive the boundary; costs and
arbitrary provider fields are discarded. Measured zero is accepted only with native usageReport.state=available;
adapter-default zeros without measurement evidence remain unknown.

Controller finalization retains codingUsage with its codingRunId and exposes the
latest turn through admin status. Starting a new turn clears the previous turn's
fields; codingUsage itself is intentionally not a cumulative task total. Existing jobs
without usage remain readable and are not backfilled with invented zero counts.

Parser fixtures cover unavailable/missing/malformed/overflow counts, explicit
zero, untrusted text and field redaction. Controller fixtures cover persistence
and status after restart. The native Lobster fake-CLI fixture now passes usage
through the actual workflow/result step. These are fixture qualifications, not a
new provider run. Source build/lint and coding/dispatcher/workflow fixtures pass.
This was initially fixture-only; the deployment and live qualification below
supersede that initial status.

## Cumulative turn-boundary guard

The next implementation adds taskTokenUsage and an optional positive integer
coding.tokenBudget, including setup Validate/Apply and native manifest/parser
validation. Empty setup input removes the configured limit. The limit is
snapshotted per task and displayed with cumulative usage through status.

Each finished workflow contributes its native turn total once to the captured
pre-turn cumulative checkpoint. Before starting, persist unknown usage; failure
or restart cannot turn that uncertainty into zero. Missing legacy checkpoints,
unknown turn usage and integer overflow remain unknown. With a limit configured,
unknown usage, a changed limit, or total >= limit blocks another turn. A newly
finished turn reaching the limit is retained for inspection without committing
a delivery or entering human-input waiting. Completed jobs retain duplicate
admission protection; no aggregation occurs on status reads or repeat dispatch.

Fixtures cover 40+59 below a 100-token limit, 40+60 reaching it after a simulated
restart, a single-turn overshoot, unknown/missing legacy usage, changed limits,
repeat dispatch, valid setup Apply and invalid limit rejection. Native config
validation covers the updated schema and parser. At this implementation stage,
no new model run, live abort or deployment had been performed. These checks operate at turn boundaries and
allow in-flight overshoot; provider retry/compaction completeness and active
request cancellation still require qualification before WBS4.5 acceptance.

## Deployment and live limits — 2026-11-23

Deployed source aba2fae with the latest-turn adapter from 5c5a3b8, using image
sha256:77f854aae79760c13eca7cf653cc9d4afa599e675ca2ac426c180289a385a1dc.
All three local Compose overlays were applied. The original configuration was
saved under ignored .local/deployment-backups/token-budget-20261123; the test
changed only coding.tokenBudget to 1, then restored its original unconfigured
value and recreated the Gateway after the test.

Created https://github.com/yonder-source/disposable-test-repo/issues/5 for a
no-edit, no-tool real model turn. Job f6490ca0-47df-4e03-9975-baaa1e82c38b,
session agent:coding:agent-crew-f7d8ad07ab632c3e3c4527e260ba89e8,
run 25880f13-c515-44f6-89fc-eb7cf9a3aacb completed successfully at the model
and workflow layers. The Controller retained reported input=13125, output=21,
cacheRead=0, cacheWrite=0, total=13146 with taskTokenUsage.total=13146 and
snapshotted tokenBudget=1. It classified the job needs-inspection and supplied
no codingDelivery. The worktree stayed clean at its base commit
48e1200874eca26e69d88024db6f90abaf5bb3c7. Repeated dispatch retained the same
job/run. This proves the real post-turn guard, including overshoot; it does not
prove preemption at the token threshold.

After confirming the exact native run stopped and recording the unchanged
worktree, the disposable test job was explicitly abandoned through
agent-crew.resolve with an inspection note, without retry. Its ready label was
removed; no push or PR was performed.

### Stop behavior

A separate real coding session, agent:coding:token-stop-qualification-20261123,
physical ID 99994d0b-1613-4258-9f09-fba56bb15baf, started run
7214ad30-b346-4abc-ba06-12f9d9b60cde. The prompt requested a sandbox-only
90-second timer without edits or network calls. An active native run was observed
before requesting sessions.abort for the exact key/run and clearQueued=true.

The abort request returned an error: the parent run stopped but descendant
cancellation was incomplete and command cleanup could not be confirmed.
Subsequent native status confirmed hasActiveRun=false, activeRunIds=[] and the
same lastRunId. This is an uncertain descendant-cleanup result, not successful
full cancellation. It supports retaining inspection rather than automatically
retrying. No immediate or billing cap is established.

### Initial retry/compaction accounting limitation (corrected below)

Source inspection of embedded-agent-CZxniCND.mjs found the native accumulator
receives attempt usage (around line 2307), compaction recordUsage (2949), settled
finalization attempts (7564), and refreshed continuations (9343). Synthetic
calls to the actual pinned usage-accumulator-Cd3yWsMu.mjs confirmed 40+60=100
and propagation of explicit usageReport.state=unavailable. However, merging
undefined after an available 40-token report silently retains available/40.
Thus the aggregate cannot prove that every attempt supplied usage. This is a
native synthetic qualification, not a live provider retry/compaction run.

The current reported status means runtime-reported counts, not complete billing
coverage. Missing-attempt detection, real compaction/retry coverage and dependable
in-flight stopping remain open WBS4.5 work. The application must continue to
expose this limitation rather than declaring token-budget acceptance complete.

On the final replacement, native Doctor waited for the previous process
lifecycle lease to expire (core:plugin-lifecycle/global, expiry
2026-11-23T12:54:22.712Z). This delayed readiness beyond the normal cold start;
no agent data, lease records or session state were manually deleted.

The lease expired normally and the final Gateway became healthy. Existing issue-2
and issue-4 completed deliveries survived both replacements. The issue-5
abandonment and its original one-token snapshot remained persisted. Native Slack
reported running=true, connected=true, probeOk=true and no account error.

## Missing-attempt correction

A retained native regression now merges a reported 40-token attempt followed by
undefined usage and requires unavailable. It failed against the original pinned
module (available instead of unavailable). The same seam also covers empty and
cost-only reports, unmeasured zero defaults, explicit unavailable, sticky uncertainty after a later valid
attempt, measured zero, and reported retry/compaction contributions summing
40+60+20=120.

The image applies a SHA-256 guarded patch to the pinned shared accumulator.
Missing/nonbillable reports and reports containing no token components invalidate
its usageReport. Later reports cannot restore availability. The runtime's worker
assistant aggregation, attempt merges, compaction recordUsage and continuation
merges share this accumulator. This deliberately favors unknown over a partial
available total. It does not invent usage for requests the provider never reports.
The retained regression and coding/workflow/boundary checks pass in the patched
checks image. Production deployment and live behavior are recorded separately.

## Process-stop diagnosis and correction

A second real stop run (57ee3c4e-7502-451a-8dc5-42fd4ea9d4cc in
agent:coding:token-stop-qualification-20261123-b) reproduced the same parent-stop
error after the timer had entered background process session cool-falcon.
A subsequent read-only model/tool inspection found retained error
agent run aborted / OPENCLAW_DIRECT_ABORT, rather than surviving process IDs.
An isolated Docker run using the actual native termination script independently
confirmed marker-owned process termination in about 2125 ms.

The retained check-native-stop fixture exercises the real native runExecProcess,
request-owner cancellation, process supervisor and settlement. It creates a real
child timer while injecting a workspace-checkpoint failure after successful
sandbox termination. The original runtime rejected cancellation.settle with the
same cleanup-not-confirmed error, despite the child exiting. Thus the confirmed
cause is conflation of artifact finalization failure with process-cleanup failure.

The SHA-256 guarded stop patch records successful sandbox process cleanup before
workspace artifact finalization. Request cancellation relies on that separate
confirmation; finalizationFailed and retained artifact error remain visible.
Retirement remains strict about artifact errors. A second native case injects an
actual termination failure and still requires an uncertain cancellation result.
Both cases check that the real child exits. The patch does not bypass workspace
authorization, suppress artifact failures, or treat unconfirmed termination as
success. These native regressions and the ordinary coding/dispatcher/workflow
checks pass in the patched image.

## Live process-tree acceptance after correction

First deployed correction image:
sha256:f0f7886e093e1f24a8a1056ac7fb8d060c8891349ba662731b1d934255a006dc.
The corrected abort path returned ok/aborted for run
2d23896a-2a65-4653-85e0-a9c4b2371f39, with the same cancelled-artifact error
still retained. Its committed history subsequently confirmed the timer had
started as process session nova-nudibranch.

A stronger test used session agent:coding:token-stop-qualification-20261123-e,
run d9f879a3-330f-4485-9364-e89260063d26. The real model launched a timer
parent and a descendant in its Docker sandbox. Before cancellation, /proc/comm
inspection observed 41 ac-stop-e and 48 ac-child-e in container
openclaw-sbx-workspace-55dbd17a0ee6ba6c6055ff2832df6262. The authenticated
abort targeted that exact key/run with clearQueued=true, returned ok/aborted,
and native session status reported no active run. A second /proc/comm inspection
confirmed both parent and child were gone. This verifies actual descendant
termination, rather than merely an inactive parent session or a queued run.

The normal timer qualification in session suffix -d ran to completion with
terminal reply STOP-PROBE-DONE and native run status ok. It also demonstrated
that history can buffer tool output until the command finishes; live process
inspection, not history timing alone, was therefore used for the stronger test.

Follow-up regressions found a second accounting ambiguity: explicit zero counts
without available measurement evidence could be adapter defaults. Both the
native accumulator and CLI result boundary now reject those ambiguous zeros.
Measured zero with usageReport.state=available remains accepted. These cases
were observed red before the correction and green afterward.

## Final deployment and ordinary-turn accounting

Final image (including ambiguous-zero handling and the matching background-stop
confirmation predicate):
sha256:c7082e58f9bab060e75faeae424d36c375b273f72489ff9b1643432da65afd12.
The native process-cancellation fixture also checks the background-stop predicate,
so both request cancellation and process stop interpret the separate confirmation
consistently. Agent retirement still rejects artifact-finalization failure.

A real ordinary tool-using coding turn, run
0d5b48b4-fb18-49e1-8f4d-1f80331930da, executed the read-only USAGE-OK command
and returned status=ok with reported total=13839, input=263, output=8,
cacheRead=13568, cacheWrite=0. The strict CLI-boundary normalizer accepted this
nonzero report. This confirms the missing-data correction does not blanket-mark
normal tool-using turns unknown. It ran against the same final usage patch and
adapter before the last background-stop-predicate-only image update.

The full checks image suite passed before the final narrow zero/predicate
follow-ups; latest-source lint, native usage/stop regressions and coding/result/
dispatcher boundary checks passed afterward. The two new native regressions are
part of the normal checks-image entrypoint. SHA-256 guards reject an unexpected
upstream runtime rather than applying these backports to changed code.

These corrections qualify the known missing-report/zero-default paths and the
actual process-stop mechanism. Token enforcement remains at coding-turn
boundaries; there is no claim of provider-internal billing visibility or a hard
in-flight token cap. Workspace-finalization errors still require inspection and
are not accepted as a coding delivery.

After final replacement the Gateway was healthy; production-image native
usage/stop regressions passed, issue-2 and issue-4 delivery records were preserved,
and the Slack account reconnected with a successful probe. No test token limit
was enabled by this deployment.
