# Restart exploration: outstanding items

Checked items have a proposed solution; their remaining validation is noted.
Struck-through items are proposed for later review.

- [x] **Issue admission:** Use a single dispatcher queue to check session
  metadata and start one workflow per issue. The synthetic dispatch and crash
  boundary passed the [WBS2 integration check](wbs2.md#runtime-qualification-note).
- [x] **Human approval:** Start coding when a human manually applies the
  `ready for agent` label in GitHub.
- [x] **Coding handoff:** Validate the native `openclaw.agent` Lobster step
  with the actual coding runtime. A local mock-model probe started a turn in
  the issue session and passed its result to the next workflow step.
- [x] **Uncertain outcomes:** Stop and let the operator inspect the existing
  work before retrying an uncertain start, dispatch, or GitHub write. Validate
  this behavior before unattended production use.
- [x] **Runtime boundary:** Start with OpenClaw's native Docker sandbox and
  validate it with the coding workflow. Revisit a Supervisor if needed.
- [x] **Secrets:** Use Compose secrets on encrypted host storage locally and
  the cloud provider's secret manager in production. OpenClaw SecretRef can
  read a platform-injected environment variable; validate the selected cloud
  deployment and credential delivery path before production use.
- [x] **Minimal state:** Use OpenClaw session metadata for the repository,
  issue, job ID, workflow status, Lobster reference, and agent run ID when
  available. WBS2 verified its persisted pre-start marker and interruption
  boundary using native session metadata; no additional admission store is
  needed for the single-Gateway synthetic dispatcher.


## New items for review

- [x] **Issue discovery:** Use Controller APIs for GitHub access. Agents can
  read and write only their assigned issues.
- [x] **Draft PR publication:** Use the current Controller-mediated approach
  for the assigned issue, with credentials supplied through the chosen secret
  mechanism.
- [x] **Publication result:** The Controller API returns the PR result and URL
  to Lobster for reporting.
- [x] **Coding duration:** Start with a 20-minute timeout for each Lobster
  call and coding-agent step; adjust after observing actual runs and resumes.
- [x] **Deployment and workspace:** Validate the Docker sandbox and writable
  workspace locally, then deploy the MVP to a cloud VM with Docker.

## Proposed for later

- [ ] ~~Approve in Slack and let the Designer agent apply the GitHub label.~~
- [ ] ~~Automatically recover a Lobster checkpoint after a lost start response.~~
- [ ] ~~Automatically resume coding after a Gateway or host failure.~~
- [ ] ~~Automatically reconcile uncertain external writes.~~
- [ ] ~~Qualify all agent-run idempotency and restart cases for automatic retry.~~
- [ ] ~~Implement full backup, retention and recovery before the first workflow.~~

Evidence: [native workflow probe](evidence/openclaw-native-workflow-probe.md)
and [Lobster prototype](evidence/lobster-prototype/README.md).
