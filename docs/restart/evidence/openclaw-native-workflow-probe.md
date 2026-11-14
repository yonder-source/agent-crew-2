# OpenClaw native workflow probe

Date: 2026-11-09. Tested OpenClaw 2026.10.10 in a disposable, network-isolated Docker container with separate state; no Controller, Supervisor, model, GitHub or Slack access.

## Observations

- A small plugin registered Gateway methods and handled a request and status read in memory. This establishes extension plumbing only; its state does not persist.
- Native cron registered a recurring command representing synthetic issue discovery. A manually triggered run returned `{ "issue": 17, "ready": true }`; cron retained the result and successful status.
- A separate native cron command called `sessions.create` for synthetic issue 18. The run succeeded and its native session was visible through `sessions.describe`. This is a manual trigger of a predefined command, not automatic processing of the first discovery result.
- After a Gateway container restart with the same disposable state directory, both cron definitions, their last-run records and the issue 18 session remained observable with the same session ID.
- A direct `sessions.create` request with an idempotency key failed: `idempotent session creation requires an authenticated principal or device identity`. The successful session calls omitted the idempotency key and used the test Gateway's shared token. Do not infer production idempotence or identity behavior from this probe.
- The command payload runs in the Gateway environment, not an isolated task sandbox. Its stdout and command arguments appeared in the retained automation diagnostics. This path must not be assumed safe for secret values or untrusted issue content.

## Interpretation

Native cron can supply scheduling, result history and restart persistence; native sessions can supply a persistent conversation identity. A thin plugin could coordinate these facilities, but this probe did not establish atomic issue admission, safe duplicate handling, verified human approval, actual agent execution, Supervisor integration, GitHub publication or Slack delivery. We have not yet shown whether the native facilities can reproduce the current Controller workflow or how much additional code and state it needs.

## Next bounded experiment

Use a synthetic issue provider and a plugin service to connect one discovery result to a native session, then repeat the same discovery and restart during admission. Verify that the same issue cannot launch duplicate work, using a supported authenticated principal and the version-matched session API. Compare the additional durable state and logic needed with the current admission path before expanding to coding or publication.

## Duplicate session-key probe

On 2026-11-09, two sequential `sessions.create` calls without idempotency keys used the same synthetic issue-specific session key. Both succeeded and returned the same session ID and lifecycle revision; the second updated the session timestamp. Neither call started an agent run. This establishes reuse for this sequential case only; it does not establish behavior for concurrent calls, duplicate agent runs, or repeated workflow admissions.

## Agent dispatch deduplication probe

In the same network-disabled Gateway, sent two `agent` requests for the same synthetic session with idempotency key `probe-run-19`. The first returned accepted with run ID `probe-run-19`; the second returned `in_flight` with the same run ID. A third request to the same session with a distinct key returned accepted with a distinct run ID. Both `agent.wait` calls timed out; the session reported running. No successful model execution was observed, and the probe cannot distinguish whether the distinct run was queued, coalesced, or actually executed. The results show per-key in-flight deduplication and that session identity alone does not reject another dispatch. They do not establish deduplication after restart, after completion, or after the native retention window.

The CLI command `openclaw tasks flow` was unavailable in this installed image; this does not prove there is no Task Flow SDK or alternative API.

## Agent dispatch after Gateway restart

After stopping and later restarting the network-isolated Gateway, the same `agent` request for `probe-run-19` was accepted again with the same run ID and a new acceptance timestamp; `agent.wait` timed out. The previous run had also timed out and had not been observed to complete. This demonstrates reacceptance after restart in this scenario; it does not prove either execution reached a model or that two coding executions occurred. Do not rely on this key alone as a durable cross-restart admission fence.

## Plugin-owned session metadata

In OpenClaw 2026.10.10, a disposable plugin registered `crew-job` with `api.session.state.registerSessionExtension`. The Gateway `sessions.pluginPatch` method stored a synthetic job ID, issue and status; `sessions.describe` projected them in `pluginExtensions`. After a Gateway restart, the same session ID and metadata were returned. Two simultaneous `sessions.pluginPatch` calls targeting the same namespace with different job IDs both returned success; the session retained one final value. This demonstrates persistence and overwrite behavior, not an atomic admission claim. The documented patch API requires `operator.admin`; use of other plugin-owned access paths was not tested. No session reset, delete, plugin disable, multi-instance deployment, or real workflow was tested.
