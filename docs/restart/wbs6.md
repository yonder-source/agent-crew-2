# WBS6-restart — Slack and workflow integration

## Goal

Extend basic Slack task interaction with publication reporting, delivery retries
and MVP acceptance. The [root SPEC](../../SPEC.md) defines
the MVP workflow.

## Entry conditions

- [WBS5-restart](wbs5.md) is complete: the Controller can publish a draft PR
  and return its URL to Lobster.
- [WBS4.5](wbs4.5.md) is complete: the operator can connect one repository
  through the OpenClaw-accessible UI and retain its validated configuration.
- A disposable GitHub test repository and Slack channel are available for the
  integration check. Supply credentials through the agreed secret mechanism.

## 6.1 Configure the workflow

**Work:** Extend the WBS4.5 repository connection UI with the coding Slack
channel, authorized user IDs and GitHub discovery polling interval. The coding
Slack agent must match the configured coding agent. Use the existing mounted
Slack bot/app credentials and native Socket Mode connection; report file
readiness separately from channel/user validation and transport connection.
Persist these settings through the existing configuration store and retain the
current active/uncertain task guards and runtime activation boundary.

**Done when:** An operator can configure one repository, a valid coding Slack
channel and authorized users, and a polling interval, then save, validate and
apply. Missing or invalid settings, unavailable credentials, or disconnected
Slack transport prevent Apply or scheduling with a clear status. Changed
settings survive Gateway restart; scheduling resumes only after health and
connection checks pass, including fresh Slack channel membership, archive
status and authorized-user activity checks. A failed or unavailable Slack
check blocks both polling resume and coding dispatch. Verify the existing job
admission and uncertain-work guards still apply when changing settings.
See [configuration errors](../../SPEC.md).

## 6.2 Connect Slack reporting

**Work:** Extend WBS4.5 Slack interaction with delivery retries. After an
initial failed input-request message, retry at most three times; an uncertain
delivery may be retried even if it produces a duplicate. Preserve waiting state
and report failure when attempts are exhausted. Retain delivery operation
identity, channel, thread, attempt count and delivery state with the job across
restart. Keep delivery outcomes separate from coding and publication outcomes;
delivery-only recovery must not rerun coding, push or PR creation.

Post Controller-owned progress updates in the task's retained Slack thread at
these observed transitions: coding starts, implementation completes and
validation starts, validation completes, the task enters waiting for human
input, and the task completes or requires operator inspection. Report only
transitions that occur. Do not ask the coding agent to send arbitrary progress
messages or add a periodic timer. Apply the same bounded delivery retry policy
to progress updates; a retry must not repeat coding or publication work.

**Done when:** A test workflow produces a Slack message identifying the issue
and its status. Exercise delivery failure, retry limits and uncertain delivery;
failure remains visible and does not misrepresent workflow or publication outcome.
Fixtures cover restart retention, duplicate events, retry exhaustion and
delivery-only recovery without coding or publication side effects. Exercise the
normal transitions in the integrated workflow; fixtures cover waiting and
operator-inspection transitions without requiring them in every workflow.
See [Slack delivery failures](../../SPEC.md#error-slack).

## 6.3 Report the draft PR

**Work:** Connect the WBS5 publication result to Slack reporting. Include the
assigned issue and draft PR URL.

**Done when:** A successful publication produces a Slack message with the
correct issue and PR link. An unsuccessful publication reports its status
without claiming a PR was created. Include a PR URL only for the confirmed
`published` result; exclude credentials and internal operation details from
Slack messages.
See [workflow failures](../../SPEC.md#error-workflow).

## 6.4 Exercise the MVP workflow

**Work:** In the disposable installation, connect the repository through the
WBS4.5 UI, then manually label a test issue and follow
it through discovery, coding, Controller publication and Slack reporting.

**Done when:** One coding workflow produces a draft PR and the configured Slack
channel receives its link. The agent's issue access and sandbox are checked
along the path; a human can inspect the PR. Record the actual result and the
separate results of duplicate and failure checks from the preceding packages.
Record live GitHub and Slack evidence separately from fixtures and synthetic
checks, including the authorization and delivery failure boundaries.

## 6.5 Developer and operator handoff

**Work:** Document the configuration, local startup and how to inspect workflow
status, Slack delivery and an uncertain outcome. Record the selected image,
plugin and coding runtime versions.

**Done when:** An operator can configure and run the integrated workflow and
find the issue, coding result and PR. Remaining deployment checks are identified
for the next slice.

## Handoff

The next slice prepares the cloud VM deployment and production secret delivery.
Slack readiness approval and automated recovery remain for later review.
