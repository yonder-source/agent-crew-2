# OpenClaw reuse for the restart

Research date: 2026-11-09. This is evidence for the WBS postmortems, not a
decision to preserve the earlier architecture or every requirement in it.

The linked OpenClaw documentation describes the current documentation site;
it is not version-locked to 2026.10.10. The project selected
2026.10.10 for qualification,
but this research did not verify the exact packaged SDK or run a live test.
Treat each suggested use as a candidate until checked against the selected
image, its matching SDK, and a running Gateway. The
[2026.10.10 release notes](https://docs.openclaw.ai/releases/2026.10.10)
are version-specific, but do not establish availability of every API below.

## Findings

| Present responsibility | Native capability and restart implication | Gap to evaluate |
| --- | --- | --- |
| Gateway adapter, service lifecycle and health | The [plugin SDK](https://docs.openclaw.ai/plugins/sdk-overview/infrastructure) registers tools, hooks, HTTP routes, Gateway methods and background services. A small in-process plugin could own some currently separate Controller functions. [Plugin services](https://docs.openclaw.ai/plugins/sdk-runtime/gateway-and-nodes) have start/stop lifecycles. | A plugin shares the Gateway process and its authority. Check failure isolation, concurrency and shutdown behavior; a separate Controller is not automatically required or automatically unnecessary. |
| Conversations, agent sessions and controls | OpenClaw already owns sessions and agent turns. Its documented [Gateway API](https://docs.openclaw.ai/plugins/sdk-runtime/gateway-and-nodes) exposes session listing, chat/session abort and run waiting; [operator methods](https://docs.openclaw.ai/gateway/protocol/operator-methods) expose session-scoped tool previews and policy-mediated invocation. Reuse these before building another session manager. | Session identity and transcript persistence do not by themselves demonstrate a durable issue/job state machine, repository authorization, or verified termination of subprocesses. Preview is not proof of effective execution. |
| UI and status | The [Control UI Workboard](https://docs.openclaw.ai/plugins/workboard) displays work cards, assignments and sessions; [session dashboards](https://docs.openclaw.ai/web/dashboards) supply thread-owned widgets. Evaluate native views before creating a custom job dashboard. | Workboard calls itself local operating work, not a replacement for GitHub Issues; dashboards are deleted with their thread. Neither source establishes our workflow permissions, audit or recovery contracts. |
| Small per-session status | Current [session extension documentation](https://docs.openclaw.ai/plugins/hooks/prompt-and-session) describes plugin-owned JSON state, Gateway updates and session-row projections. This may replace some UI projection or session metadata plumbing. | Its documented small session state is not evidence of transactions across jobs and effects, durable queue semantics, or a substitute for workflow storage. Confirm version support and restart behavior. |
| Polling and scheduling | OpenClaw offers [automation schedules](https://docs.openclaw.ai/automation/cron-jobs/schedules) and [plugin service lifecycle APIs](https://docs.openclaw.ai/plugins/sdk-runtime/gateway-and-nodes). Consider these for simple periodic checks. | Check restart, overlap, missed-run, retry, authorization and idempotency behavior for each actual workflow; a scheduler does not make external effects exactly once. |
| Runtime isolation and Supervisor task creation | OpenClaw documents [per-session Docker sandboxing](https://docs.openclaw.ai/gateway/sandboxing/modes-scope-and-backend), including [workspace, network and resource controls](https://docs.openclaw.ai/install/docker/sandbox-and-troubleshooting). A [node host](https://docs.openclaw.ai/cli/node) can expose restricted remote commands. Test a native sandbox first and reconsider whether Swarm task orchestration and a separate Supervisor are needed. | When Gateway runs in Docker, the native Docker backend creates sibling containers through the host Docker socket ([documentation](https://docs.openclaw.ai/gateway/sandboxing/docker-backend)). That shifts powerful authority to the Gateway; sandboxing does not isolate native plugins or Gateway RPC ([capability matrix](https://docs.openclaw.ai/gateway/sandboxing/supported-capability-matrix)). Compare this trust boundary to the current separated Supervisor before adopting it. |
| Execution approvals and stopping | OpenClaw offers [exec approvals and allowlists](https://docs.openclaw.ai/tools/exec-approvals) and run/session abort APIs. Reuse their controls where they meet the selected workflow's needs. | Documented approval has exceptions and applies alongside tool policy. An abort request is not evidence that all child processes stopped, that an independent active-time deadline survived Gateway failure, or that workspace state is preserved. These are acceptance tests, not assumed capabilities. |
| GitHub admission, authorization, publication and recovery | Native plugin tools, methods and hooks can host smaller pieces of application policy. OpenClaw already mediates tools and identities at its own boundary ([operator methods](https://docs.openclaw.ai/gateway/protocol/operator-methods)). | The reviewed documentation does not establish this project's repository-scoped human permissions, exact issue approvals, candidate-specific publication, effect receipts, or cross-system reconciliation. Decide which product rules remain necessary; implement only the remaining gaps. |

## Proposed small validation slices

1. Run the chosen pinned OpenClaw image in Docker; load a minimal plugin built
   against its matching SDK. Invoke a registered tool or Gateway method in a
   real session and confirm it appears in the UI. Capture image digest and SDK
   version. This is the WBS1 integration candidate, not a workflow build.
2. In a separate slice, exercise session creation, status, abort and restart;
   record what survives, the caller identity and any uncertain outcomes.
3. In a separate slice, start two sandboxed coding sessions, check workspace,
   credential and network isolation, then stop one with child processes running.
   Test Gateway restart and failure. Explicitly evaluate Docker socket authority.
4. Pick one tiny GitHub workflow and test native scheduling, state and UI for
   its real acceptance criteria. Add custom policy or persistence only for
   demonstrated gaps. Decide process placement after the authority and failure
   boundaries are known.

Each slice is independently reviewable; none alone qualifies the entire
existing workflow or its security and recovery requirements.
