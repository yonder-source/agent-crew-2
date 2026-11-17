# WBS2-restart — Dispatcher and session state

## Goal

Use a lightweight dispatcher to start one Lobster workflow per issue and keep
its status in OpenClaw session metadata. The MVP workflow is defined in the
[root SPEC](../../SPEC.md).

## Entry conditions

- [WBS1-restart](wbs1.md) is complete: the Dockerized Gateway loads the plugin,
  and its native session metadata interaction has been verified.
- Use synthetic issues and workflows for this WBS. Later slices connect GitHub,
  the real coding runtime, publication and Slack.

## 2.1 Issue session and status

**Work:** Define the minimal issue identity and job status for the dispatcher.
Use a stable issue-specific OpenClaw session and plugin-owned metadata for the
repository, issue and job ID. Add workflow and agent-run references when they
become available.

**Done when:** A synthetic issue can be bound to a session and its status can be
read back. Reopening the Gateway preserves the session metadata. A different
issue resolves to its own session.

## 2.2 Single dispatcher queue

**Work:** Add a lightweight queue inside the plugin. Process each issue's
metadata check and workflow-start decision in sequence. Keep the queue scoped to
one Gateway installation. Persist a start marker before invoking Lobster and
check it on subsequent requests, including after a Gateway restart.

**Done when:** Two requests for the same synthetic issue result in one workflow
start and a response identifying the existing work. Requests for different
issues are processed in order. See [duplicate dispatch](../../SPEC.md#error-duplicate).

## 2.3 Lobster workflow start

**Work:** Connect the dispatcher to a minimal synthetic Lobster workflow and
record the returned workflow status or reference in the issue session. Use the
selected version's supported API.

**Done when:** A request creates a session, starts the synthetic workflow and
shows its result through the session. Repeating the same request recognizes the
existing work without starting a second workflow. See [duplicate dispatch](../../SPEC.md#error-duplicate).

## 2.4 Operator status and uncertain outcomes

**Work:** Expose a small read-only status for the issue and workflow. If a start
returns an uncertain outcome, retain a status that tells the operator to inspect
it before retrying.

**Done when:** The operator can distinguish active, completed and
needs-inspection work. A repeat request for work needing inspection does not
start another workflow until the operator has inspected and explicitly decided
how to proceed. An interrupted start whose outcome is unknown remains blocked
after restart, including when no Lobster reference was returned.
See [uncertain outcomes](../../SPEC.md#error-uncertain).

## 2.5 Integration check and handoff

**Work:** Run the dispatcher against a disposable Gateway and Lobster plugin.
Exercise a synthetic issue, a duplicate request, a different issue and the
needs-inspection status. Interrupt the start after its marker is persisted and
before its result is recorded; restart the Gateway and repeat the request.
Document how to repeat the check.

**Done when:** The Gateway integration demonstrates the expected statuses and
one workflow start for the duplicate issue, and the interrupted start remains
blocked for inspection. The developer instructions identify the test as
synthetic and give the next slice a clear integration point. If session
metadata cannot provide this boundary reliably, stop and determine the smallest
durable state needed before proceeding to WBS3.

## Handoff

Later work connects issue discovery and assigned-issue Controller APIs, then the
real coding runtime, draft PR publication and Slack reporting. Add persistent
state or recovery behavior only when those slices demonstrate a need.

## Runtime qualification note

The pinned SDK's plugin-owned session helper requires a custom harness, but the
public operator `sessions.create` API creates the required native session.
The dispatcher uses the supported authenticated Gateway client for session
metadata and Lobster invocation. No custom harness or standalone Lobster CLI
is needed. `tools.invoke` returns an outer `ok/output` envelope; Lobster's
workflow status is inside `output.details`. An `internal_error` from an invalid
pipeline does not establish that the tool is unavailable.

Run `./scripts/check-all.sh` from the repository root. Its disposable Gateway
uses the image-installed `@openclaw/lobster@2026.11.3`, synthetic issues and a
fixed workflow. The workflow records each real execution and supports a
file-controlled pause for interruption testing. The check covers native
session metadata, duplicate suppression, distinct-issue serialization,
SIGKILL after the durable start marker and before result storage, retained
inspection blocking, explicit retry, abandonment and restart persistence.
The complete clean-state check passed: five actual workflow executions across
four issues, including one explicitly approved retry; duplicates and restart
inspection did not add executions. Both interruption cases used SIGKILL on a
running Gateway, and abandonment remained blocked after another restart.
These checks do not exercise GitHub, coding agents, Slack or cloud deployment.

See the [root dispatcher contract](../../SPEC.md#wbs2-dispatcher) for the
credential, state and operator-control decisions.
