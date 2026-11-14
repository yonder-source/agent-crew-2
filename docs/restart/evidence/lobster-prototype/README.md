# Lobster workflow feasibility prototype

Disposable synthetic probe; not production code. Tested 2026-11-09 with OpenClaw Gateway 2026.10.10 and official @openclaw/lobster 2026.10.10 (embedded @clawdbot/lobster 2026.9.16).

The workflow calls a synthetic issue discovery, pauses at an approval, then produces synthetic coding and draft PR results. All four commands only write their stage names to a disposable local log and print fixed JSON. No GitHub, Slack, coding agent, Supervisor, network isolation, or real authority is exercised. Absolute paths in the workflow target /probe-state/workspace in the disposable Gateway.

Observed via the Gateway tools.invoke API: a run reached needs_approval; after restarting the Gateway with its state directory preserved, approving its returned approvalId completed the workflow. The log contained discover, preview, implement, publish exactly once in that single test. A second resume of the completed approval returned a tool error and appended no events. This does not establish duplicate issue admission protection, safety after a crash during a side effect, or cross-user approval enforcement.

The probe demonstrates native step sequencing and persisted approval continuation. Test asynchronous real coding task handoff, authenticated human approval, repeated issue discovery and unknown GitHub outcomes before judging whether it replaces the Controller.

## Related validation batch

Using the same pinned Gateway and plugin, 2026-11-09:

1. Starting the synthetic issue workflow twice returned two `needs_approval` results with distinct approval IDs. Bare Lobster runs did not deduplicate the issue.
2. Denying one approval returned `cancelled`, with no implementation or publication logged for that workflow.
3. Approving the second completed it and appended one implementation and one publication stage.
4. Reusing that completed approval returned a tool error without appending another stage.
5. An inline `ask` checkpoint returned `needs_input`. An invalid schema response returned a tool error; a subsequent valid response on the same checkpoint succeeded and returned the submitted synthetic data.

The test harness scripts are `crew-lobster-batch.py` and `crew-lobster-input.py`; they expect a preconfigured disposable `crew-lobster-probe` container and the fixed absolute paths in the workflow. They are evidence scripts, not a turnkey deployment. The input result was supplied by the test caller, not a real agent. No proof of agent-to-workflow delivery, principal-bound approval, duplicate admission protection, or interrupted effect reconciliation follows from these tests.

## Admission gate probe

Two sequential native Gateway `tools.invoke` calls with the same `idempotencyKey` both started a Lobster workflow and returned different approval IDs. The key does not deduplicate Lobster starts in this test.

A disposable Python/SQLite prototype put a unique issue identity into a `starting` row in an immediate transaction before invoking Lobster, then stored the approval ID and `waiting` status. Two concurrent calls for one synthetic issue yielded one created workflow and one existing `starting` record; reopening SQLite and retrying returned the existing `waiting` record. A simulated pre-existing `starting` record blocked another dispatch. This is a synthetic interrupted-state setup, not an actual crash injected during the external invocation. The prototype does not recover an approval if dispatch succeeded but the receipt was lost; it intentionally leaves the issue blocked for reconciliation. It does not implement authorization, issue revisions, finality or retry policy. A database row and atomic claim are demonstrated; a separate Controller service is not required by this probe.

## Native Lobster state and lost response

The pinned image's Lobster documentation says the plugin does not list pending input checkpoints and instructs callers to retain resume tokens. The pinned `lobster --help` exposes resume by token but no pending-checkpoint list. Inspection is not proof that no alternative integration exists, and no claim is made about later versions or undocumented filesystem recovery.

The installed `state.get` and `state.set` commands read and write durable JSON values. In a synthetic sequential test, setting the same key to 1 then 2 succeeded twice and a read returned 2. Their exposed command API has no create-if-absent argument; individual read/write locks do not make a separate read-then-write an atomic admission claim. This does not exclude another native OpenClaw coordination primitive.

## Task Flow compatibility check

The installed OpenClaw 2026.10.10 image includes `docs/plugins/sdk-migration/removed-surfaces.md`, which explicitly says the Tasks registry and TaskFlow orchestration APIs were removed, including `api.runtime.tasks`, without a compatibility facade. It recommends native subagent APIs, cron history and the ordinary Lobster runner. The installed @openclaw/lobster 2026.10.10 tool schema has no managed flow parameters and its resume implementation requires a token or approval ID. Some online pages describe managed Task Flow, but they do not match this pinned installation. This is version-specific source/documentation inspection, not a proof that every possible plugin-owned recovery design is impossible.

## Agent handoff probe

With the pinned Gateway and Lobster plugin and a local fake OpenAI-compatible model, `openclaw.agent` ran an actual OpenClaw agent turn in synthetic issue 23's session. The agent returned fixed synthetic text from the fake model. The following Lobster step consumed the native result and returned the run ID, success status and response text. This is a normal synchronous handoff: Lobster waited for the agent result. No actual source editing, coding harness, task sandbox, Supervisor, GitHub or Slack was exercised. Agent and workflow timeouts must be selected for a real coding task; interrupting a running task was not tested. The probe files require the disposable Gateway setup and are not a production integration.

## MVP exploration: publication and runtime

The pinned 2026.10.10 documentation describes `github_publish`: a managed session may request a draft PR, with Gateway-owned GitHub credentials and post-turn workspace acceptance. Publication can finish after the agent turn and its result is appended to the session transcript. The disposable Gateway's tool catalog and session preview contained the tool, but a direct call to `github_identity_status` returned `not_found` without a configured GitHub identity; previews are not proof of effective tool availability. No publication, GitHub connection or source modification was tested.

Lobster's documented default timeout is 20 seconds. A disposable `exec` command that would write a marker after three seconds was invoked with a 500 ms timeout; the invocation errored and the marker was absent when subsequently checked. This does not establish cancellation behavior for an actual coding agent or remote effect.

The pinned Docker sandbox documentation requires Gateway access to a Docker daemon and host-backed bind mounts for managed workspace sources. Compatibility with a selected managed cloud platform has not been tested.

## Synthetic issue-to-PR handoff

The disposable Gateway used a local fake model and an unauthenticated local mock Controller that returned a fixed issue and a fixed example.invalid PR URL. A Lobster workflow read issue data from the mock, passed it via `stdin` to `openclaw.agent` in an issue-specific session, then sent the agent result to a mock publication endpoint. The fake model confirmed the synthetic issue marker reached its input; Lobster returned the mock PR URL. This shows the data flow and confirms no real repository, GitHub, Slack, coding runtime, sandbox, credential or Controller authorization was tested. The mock does not implement an actual assignment check and must never be deployed.
