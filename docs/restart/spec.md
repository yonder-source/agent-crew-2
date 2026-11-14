# Agent Crew restart specification

Status: draft for review · 2026-11-09

This document owns the restart's product requirements and decisions. The WBS
files describe the work and acceptance for individual packages. As later WBS
reviews settle additional requirements, update this specification rather than
copying the WBS into it. The original repository specification describes the
earlier implementation and is historical reference.

## Outcome

Coordinate coding work from a GitHub issue to a draft pull request, with human
supervision through Slack and GitHub. Run the production installation on a
cloud VM without a personal workstation remaining connected.

## MVP workflow

1. A human clarifies an issue and manually applies `ready for agent` in GitHub.
2. A dispatcher discovers the issue and starts one active workflow for it.
3. Lobster orchestrates the workflow and invokes a coding agent in an OpenClaw
   session associated with the issue.
4. The agent implements and validates the work. The Controller provides GitHub
   APIs scoped to the issue assigned to that agent.
5. The Controller publishes a draft PR and returns the result and URL to the
   workflow, which reports it through Slack. A human reviews and merges it.

The issue discovery, coding and publication paths must be exercised together
before claiming end-to-end acceptance. WBS1 establishes infrastructure and a
small OpenClaw integration; it does not implement this workflow.

## Initial design

- Run OpenClaw Gateway in Docker, using its sessions, Slack integration,
  Control UI and supported plugin APIs. Use Lobster for workflow sequencing.
- Use a lightweight single dispatcher queue: check the issue's session
  metadata and process the check-and-start sequence serially.
- Keep a Controller capability for GitHub access and draft PR publication.
  Agents may read and write only their assigned issues. Its process placement
  and the exact API are implementation decisions to validate; a separate
  Supervisor is not a prerequisite for the foundation.
- Store the repository, issue, job ID, workflow status, Lobster reference and
  agent run ID in OpenClaw session metadata when available. Add state only as
  the workflow demonstrates a need. The earlier probe established session
  metadata persistence, not a completed production workflow.
- Start with OpenClaw's Docker sandbox for coding and validate its writable
  workspace. Revisit privileged supervision if the chosen runtime needs it.
- Start with a 20-minute timeout for each Lobster call and coding-agent step;
  adjust after observing actual runs. A pause for human input ends the current
  Lobster call; the next resume is a separate call.

## Error handling and retries

| Situation | MVP behavior | WBS |
| --- | --- | --- |
| <a id="error-configuration"></a>Plugin startup fails, or required settings are invalid or missing | Show a clear error; keep secret values out of startup errors. | [1.2](wbs1.md#12-minimal-plugin), [6.1](wbs6.md#61-configure-the-workflow) |
| <a id="error-duplicate"></a>An issue is discovered or requested again | Return the existing work instead of starting another workflow. | [2.2](wbs2.md#22-single-dispatcher-queue), [2.3](wbs2.md#23-lobster-workflow-start), [3.2](wbs3.md#32-connect-discovery-to-the-dispatcher) |
| <a id="error-uncertain"></a>A workflow start, coding result, issue update, push or PR creation has an uncertain outcome | Stop and let the operator inspect before retrying, including after a restart. A blocked start stays blocked until the operator decides how to proceed. | [2.4](wbs2.md#24-operator-status-and-uncertain-outcomes), [3.4](wbs3.md#34-update-the-assigned-issue), [4.3](wbs4.md#43-return-the-coding-result), [5.2](wbs5.md#52-publish-the-branch), [5.3](wbs5.md#53-create-the-draft-pr) |
| <a id="error-discovery"></a>GitHub issue discovery fails | Report the failure separately from an empty result. | [3.1](wbs3.md#31-read-ready-issues) |
| <a id="error-assignment"></a>A session is unbound or requests another issue or repository | Reject the request. | [3.3](wbs3.md#33-read-the-assigned-issue), [3.4](wbs3.md#34-update-the-assigned-issue), [5.1](wbs5.md#51-accept-the-coding-result), [5.2](wbs5.md#52-publish-the-branch) |
| <a id="error-workflow"></a>Coding or publication fails | Show the failure in the result or workflow status. | [4.3](wbs4.md#43-return-the-coding-result), [5.4](wbs5.md#54-return-the-publication-result), [6.3](wbs6.md#63-report-the-draft-pr) |
| <a id="error-slack"></a>Slack delivery fails | Show the delivery failure without misrepresenting the workflow or publication outcome. | [6.2](wbs6.md#62-connect-slack-reporting) |

<a id="error-timeout"></a>Each Lobster call and coding-agent step starts with a
20-minute timeout ([WBS4.2](wbs4.md#42-start-the-coding-agent)). A
timeout may leave an uncertain outcome. Verify inspection behavior before
unattended production use. Automatic retry policy for confirmed failures is
not yet defined; automatic recovery and reconciliation are later decisions.

## Deployment and credentials

Use Docker Compose secrets on encrypted host storage for local development and
personal use. In production, use the cloud provider's secret manager; secrets
must be encrypted at rest. OpenClaw can resolve platform-injected environment
values through SecretRef. Before production use, verify the selected secret
manager's delivery path into each consumer and document the references and
configuration used. Keep secret values out of repository files, logs and
agent context.

Target a cloud VM with Docker for the first production deployment. Validate
locally before cloud deployment. The selected runtime version and image digest
must be recorded and checked against the APIs used by the implementation.

## Later scope

Slack approval that causes the Designer agent to label an issue, automatic
recovery of lost Lobster checkpoints or interrupted coding, automatic
reconciliation of uncertain writes, and full backup/retention automation are
later decisions. An operator handles uncertain outcomes for the MVP.

## Acceptance

The MVP is ready for review when a human can label an issue, observe one coding
workflow, receive a draft PR link in Slack and review the resulting changes.
Demonstrate the selected sandbox, assigned-issue access and secret delivery in
the target installation. Exercise duplicate discovery, interruption and
uncertain outcomes, including the operator inspection boundary, alongside the
successful path. Report any unverified integration separately.

## Planning

Keep each package reviewable in one agent session, targeting 200–300 changed
lines including tests and documentation. Split larger packages when needed and
review each before starting the next.

- [WBS0 — restart decisions and targeted feasibility](wbs0.md)
- [WBS1 — Dockerized OpenClaw foundation](wbs1.md)
- [Current exploration items](outstanding.md)
