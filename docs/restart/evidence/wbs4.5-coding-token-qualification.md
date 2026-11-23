# WBS4.5 coding token accounting qualification

Date: 2026-11-23. Runtime: OpenClaw 2026.11.3.
Scope: read-only source inspection and a live usage query against the completed
issue-4 session. No additional model execution or abort was requested.

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
This implementation has not been deployed or live-qualified; the existing
Gateway continues to run the prior Slack-qualified version.

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
validation covers the updated schema and parser. No new model run, live abort
or Gateway deployment is claimed. These checks operate at turn boundaries and
allow in-flight overshoot; provider retry/compaction completeness and active
request cancellation still require qualification before WBS4.5 acceptance.
