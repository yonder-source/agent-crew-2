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
The existing 20-minute active-time policy remains implemented; configurable token
limits and their operator display remain unimplemented.
