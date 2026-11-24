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

**Work:** Use the WBS4.5 repository connection UI and provide the remaining
Slack channel, agent, polling interval and credential references needed by the
existing slices.
Use the selected OpenClaw configuration facilities where suitable.

**Done when:** An operator can configure one repository and Slack channel and
start the workflow. Invalid or missing required settings produce a clear error.
See [configuration errors](../../SPEC.md).

## 6.2 Connect Slack reporting

**Work:** Extend WBS4.5 Slack interaction with delivery retries. After an
initial failed input-request message, retry at most three times; an uncertain
delivery may be retried even if it produces a duplicate. Preserve waiting state
and report failure when attempts are exhausted.

**Done when:** A test workflow produces a Slack message identifying the issue
and its status. Exercise delivery failure, retry limits and uncertain delivery;
failure remains visible and does not misrepresent workflow or publication outcome.
See [Slack delivery failures](../../SPEC.md#error-slack).

## 6.3 Report the draft PR

**Work:** Connect the WBS5 publication result to Slack reporting. Include the
assigned issue and draft PR URL.

**Done when:** A successful publication produces a Slack message with the
correct issue and PR link. An unsuccessful publication reports its status
without claiming a PR was created.
See [workflow failures](../../SPEC.md#error-workflow).

## 6.4 Exercise the MVP workflow

**Work:** In the disposable installation, connect the repository through the
WBS4.5 UI, then manually label a test issue and follow
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
