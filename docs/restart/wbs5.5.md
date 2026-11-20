# WBS5.5-restart — Repository connection UI

## Goal

Provide a small repository connection screen accessible from OpenClaw so an
operator can configure one GitHub repository for the Controller without editing
JSON. The [root SPEC](../../SPEC.md) owns the requirements.

## Entry conditions

- [WBS5](wbs5.md) has qualified issue access, coding and draft PR publication
  with a disposable repository, using the configuration and credential paths
  established by WBS3–5.
- An operator can access the authenticated OpenClaw UI and Gateway.

## 5.5.1 Establish the UI integration

**Work:** Inspect the pinned OpenClaw runtime's supported UI extension and
configuration APIs. Use its native facilities where they support the required
screen. If a custom page is necessary, keep it accessible from OpenClaw and
use authenticated Controller endpoints. Record the chosen integration before
implementing the screen.

**Done when:** The operator can reach the repository screen from OpenClaw.
Configuration changes require operator authorization; coding agents cannot
invoke those changes through their assigned-issue tools.

## 5.5.2 Configure one repository

**Work:** Provide one form for the GitHub repository and corresponding local
checkout, using the existing coding-agent setting. Show the current values,
credential availability and connection validation result. Use the existing
configuration store rather than adding another source of truth. Credentials
remain in Gateway-mounted secrets; the form never returns their values.

**Done when:** The operator can load, validate and save one repository
connection without editing JSON. Saved configuration survives Gateway restart,
and the screen explains whether changes require a restart. Invalid settings
are rejected without replacing the last valid configuration. Multi-repository
management, credential provisioning and a general agent-management UI are
outside this package.

## 5.5.3 Validate access and apply changes

**Work:** Validate that the credential can access the selected repository,
that the checkout corresponds to it and that the WBS3–5 permission requirements
are met. Distinguish confirmed access from capabilities that still require a
live write check. Define safe application of settings: changing repository or
coding identity must not redirect an active or uncertain job to another target.
Connection validation must not mutate repository content.

**Done when:** The screen distinguishes invalid repository, missing credential,
inaccessible repository, checkout mismatch and insufficient or unverified
permissions. Active or uncertain work prevents an unsafe configuration change.
The Controller uses the saved connection consistently for discovery, assigned
issue access, coding and publication.

## 5.5.4 Acceptance and handoff

**Work:** Use the UI to configure the disposable repository, restart the Gateway
and confirm persistence. Exercise invalid input, unauthorized changes,
credential redaction and job-related change restrictions. Follow one test issue
through discovery, coding and draft PR publication using the saved connection.
Record live API evidence separately from fixtures.

**Done when:** An operator can connect the repository and inspect a draft PR
produced using that configuration. Document the screen entry point, credential
provisioning prerequisite, checkout setup and any restart requirement.

## Handoff

[WBS6](wbs6.md) adds Slack configuration and reporting, then validates the MVP
starting with the repository connection UI. Keep this screen focused on the
single-repository setup rather than recreating the previous system's dashboard.
