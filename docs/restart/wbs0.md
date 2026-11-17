# WBS0-restart — Decisions and feasibility

Status: findings recorded · 2026-11-09

WBS0 captured the restart direction and tested the main integration assumptions.
The [root SPEC](../../SPEC.md) owns the resulting MVP requirements;
[WBS1](wbs1.md) begins the Dockerized foundation.

## 0.1 MVP direction — discussed

- A human manually applies `ready for agent` in GitHub.
- A single dispatcher queue checks session metadata and starts one active
  workflow per issue. Its check-and-start sequence is serialized.
- Lobster orchestrates the workflow. OpenClaw provides sessions, agent runtime,
  Slack integration and its management UI.
- Controller APIs provide GitHub access and draft PR publication. Agent issue
  reads and writes are limited to assigned issues. Controller placement and
  the precise integration remain to be validated.
- The operator inspects uncertain outcomes before retrying. Automatic recovery
  and Slack-initiated readiness labeling are deferred. See
  [uncertain outcomes](../../SPEC.md#error-uncertain).

## 0.2 OpenClaw and Lobster — observed

The probes used OpenClaw 2026.10.10 and, for Lobster tests, the matching
`@openclaw/lobster` 2026.10.10 plugin.

- A plugin stored an issue, job ID and status in OpenClaw session metadata; the
  metadata and session ID survived a Gateway restart. Two concurrent metadata
  writes both succeeded, so the dispatcher must serialize its own starts.
- Lobster paused a synthetic workflow for approval and resumed it after a
  Gateway restart. Reusing that completed approval failed without repeating
  the simulated steps.
- Two starts for the same synthetic issue produced separate Lobster approval
  requests, including when `tools.invoke` used the same idempotency key.
- A real OpenClaw agent turn using a local fake model ran in an issue-specific
  session via Lobster's `openclaw.agent` step. The next workflow step received
  its run ID and response.
- A separate synthetic workflow passed mock Controller issue data to the agent
  and returned a mock draft PR URL. This verified the data path; it did not
  exercise real coding, assignment enforcement, GitHub or Slack.

Evidence: [session probes](evidence/openclaw-native-workflow-probe.md)
and [Lobster probes](evidence/lobster-prototype/README.md).

## 0.3 Runtime and operations — direction selected

- Begin with OpenClaw's native Docker sandbox and validate a writable workspace
  with the real coding runtime. Revisit a separate Supervisor if needed.
- Use Compose secrets on encrypted host storage locally and the cloud provider's
  secret manager in production. SecretRef supports platform-injected environment
  values; the selected cloud delivery path still needs a deployment check.
- Use a cloud VM with Docker for the first production deployment. Validate the
  sandbox and workspace locally first.
- Start with 20-minute timeouts for each Lobster call and coding-agent step;
  adjust based on real runs. Human waiting occurs between calls. See
  [timeouts](../../SPEC.md#error-timeout).
- Use OpenClaw session metadata for the initial workflow references. Add
  application persistence only when the workflow demonstrates a need.

## 0.4 ADR review — carried forward as context

[ADR 0001](adr/0001-openclaw-and-controller-boundary.md) supports reusing
OpenClaw and retaining scoped Controller capabilities; Lobster and process
placement are reconsidered. [ADR 0002](adr/0002-sqlite-for-workflow-state.md)
remains useful if additional application storage is needed.
[ADR 0003](adr/0003-one-controller-writer-per-installation.md) describes the
current Controller's SQLite and recovery model; the restart begins with a
single dispatcher queue. Preserve the records and revisit their status as the
new architecture is agreed.

## Handoff and remaining validation

WBS1 establishes the Dockerized plugin and a native session interaction. Later
workflow slices must validate the real coding runtime, Docker sandbox, scoped
Controller APIs, GitHub publication, Slack reporting and production secret
injection. The mock probes do not establish end-to-end acceptance.
