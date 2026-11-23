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

## Remaining implementation boundary

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
arbitrary provider fields are discarded. A zero explicitly present in the runtime
envelope stays distinguishable from missing data, which remains unknown.

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

### Retry/compaction accounting limitation

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
