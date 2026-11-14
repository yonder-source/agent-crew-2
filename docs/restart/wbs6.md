# WBS6-restart — Slack and workflow integration

## Goal

Connect the issue-to-draft-PR workflow to Slack and provide the minimum
configuration needed to run it. The [restart specification](spec.md) defines
the MVP workflow.

## Entry conditions

- [WBS5-restart](wbs5.md) is complete: the Controller can publish a draft PR
  and return its URL to Lobster.
- A disposable GitHub test repository and Slack channel are available for the
  integration check. Supply credentials through the agreed secret mechanism.

## 6.1 Configure the workflow

**Work:** Provide the minimum configuration for the repository, Slack channel,
agent, polling interval and credential references used by the existing slices.
Use the selected OpenClaw configuration facilities where suitable.

**Done when:** An operator can configure one repository and Slack channel and
start the workflow. Invalid or missing required settings produce a clear error.
See [configuration errors](spec.md#error-configuration).

## 6.2 Connect Slack reporting

**Work:** Use OpenClaw's Slack integration to report the assigned issue and
workflow status to the configured channel.

**Done when:** A test workflow produces a Slack message identifying the issue
and its status. A simulated delivery failure is visible to the operator and
does not misrepresent the workflow or publication outcome.
See [Slack delivery failures](spec.md#error-slack).

## 6.3 Report the draft PR

**Work:** Connect the WBS5 publication result to Slack reporting. Include the
assigned issue and draft PR URL.

**Done when:** A successful publication produces a Slack message with the
correct issue and PR link. An unsuccessful publication reports its status
without claiming a PR was created.
See [workflow failures](spec.md#error-workflow).

## 6.4 Exercise the MVP workflow

**Work:** In the disposable installation, manually label a test issue and follow
it through discovery, coding, Controller publication and Slack reporting.

**Done when:** One coding workflow produces a draft PR and the configured Slack
channel receives its link. The agent's issue access and sandbox are checked
along the path; a human can inspect the PR. Record the actual result and the
separate results of duplicate and failure checks from the preceding packages.

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
