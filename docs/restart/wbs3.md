# WBS3-restart — GitHub issue discovery and assigned access

## Goal

Discover open issues marked `ready for agent`, submit them through the WBS2
dispatcher, and provide session-bound access to the assigned issue. The [root
SPEC](../../SPEC.md) defines the current requirements.

## Entry conditions

- WBS2 is merged and its dispatcher state, serialization and operator inspection
  behavior remain the admission boundary.
- OpenClaw `2026.11.3` tool factory v2 supplies the current host session key and
  invocation-current guard. The assignment tools use this context; they do not
  accept an agent-supplied key.
- Live GitHub acceptance requires a disposable repository and an existing
  GitHub App installation token mounted at
  `/run/secrets/agent-crew-github-installation-token`. WBS3 does not create an
  App or mint credentials.

## 3.1 Read ready issues

**Work:** Use Octokit for GitHub REST calls. Read the scoped installation token
through a replaceable provider interface. Keep requests confined to the
configured repository, bound request duration and response size, validate
responses, and do not retry writes automatically. List open issues carrying the
exact `ready for agent` label, following pagination up to a finite page limit;
exclude pull requests.

**Done when:** A matching issue list includes repository, number, title, body,
state and labels. An empty list is a successful empty result; credential,
provider and malformed-response failures remain failures.

## 3.2 Connect discovery to the dispatcher

**Work:** Add a plugin service that polls the configured repository at a
configurable interval and submits each result through the same internal,
serialized dispatcher used by the operator `agent-crew.dispatch` Gateway method.
Do not expose arbitrary issue dispatch as an agent tool; discovery is the
normal admission path and WBS2 continues to suppress duplicates.

**Done when:** Repeated polls do not start duplicate work. Closed, unlabeled and
pull-request results are not dispatched. Empty polls and provider failures are
reported distinctly. Poll failures do not terminate future polling.

## 3.3 Read the assigned issue

**Work:** Register `agent_crew_issue_read` as a session-bound plugin tool using
the v2 tool factory context and its host-provided session key. Resolve the assignment from the current session's
`agent-crew-job` metadata and require an active job in the configured
repository.

**Done when:** The agent receives only the issue assigned to its current
session. Missing, malformed, stale, cross-repository or inactive assignments
are rejected. The tool accepts no repository, issue number or session identity.

## 3.4 Update the assigned issue

**Work:** Register `agent_crew_issue_update` with a body-only input. Before the
GitHub PATCH, persist a `writing` marker containing an operation ID, body hash
and timestamp in the assigned session metadata. On confirmed success, clear the
marker. If the Gateway restarts or a dispatched write has an uncertain result,
expose `needs-inspection` and block another write until an operator explicitly
confirms, approves retry or abandons it through `agent-crew.resolve` with an
inspection note.

**Done when:** An assigned agent can update its issue body; no other issue field
can be changed. Uncertain writes are never automatically resent, and their
inspection state survives Gateway restart.

## 3.5 Integration check and handoff

**Work:** Run deterministic provider and assignment fixtures plus the
disposable Gateway/WBS2 synthetic workflow. If the live token and test repo are
available, exercise discovery, read and body update against GitHub; otherwise
record those paths as unverified live integration.

**Done when:** Fixtures cover pagination, matching/empty results, closed and
unlabeled issues, pull requests, provider errors, assignment rejection,
body-only writes and uncertain write handling. Report fixture and live GitHub
results separately, including that a mock or fixture is not live API
qualification. Document the GitHub App installation's Issues read/write
permission requirement and local secret mount path.

## Handoff

WBS4 connects the real coding agent to the assigned session and issue details.
Issue templates, dependency processing, Slack approval and automatic
assessment of issue changes remain out of this package.
