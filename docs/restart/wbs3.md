# WBS3-restart — GitHub issue discovery and access

## Goal

Discover issues that a human has marked `ready for agent` and pass them to the
WBS2 dispatcher. Give agents Controller APIs to read and update only their
assigned issues. The [restart specification](spec.md) defines the MVP workflow.

## Entry conditions

- [WBS2-restart](wbs2.md) is complete: duplicate and interrupted starts remain
  controlled across restart with synthetic inputs.
- A test repository and a scoped GitHub credential are available for the live
  discovery check. Supply credentials through the selected secret mechanism.

## 3.1 Read ready issues

**Work:** Add the smallest GitHub read interface needed to list open issues with
the `ready for agent` label in a configured repository. Read credentials through
the selected secret mechanism; use deterministic fixtures for development.

**Done when:** The interface returns the repository and issue details needed by
the dispatcher. A failed GitHub request is reported as a failure, and a
repository with no matching issues returns an empty list.
See [discovery failures](spec.md#error-discovery).

## 3.2 Connect discovery to the dispatcher

**Work:** Periodically read ready issues and submit each to the WBS2 dispatcher.
Make the polling interval configurable and keep discovery separate from the
coding workflow.

**Done when:** A labeled synthetic issue reaches the dispatcher. A subsequent
poll finds the existing work instead of starting another workflow; unlabeled or
closed issues do not start work.
See [duplicate discovery](spec.md#error-duplicate).

## 3.3 Read the assigned issue

**Work:** Add a Controller API that lets an agent read the issue associated with
its active session. Derive the repository and issue from the trusted assignment.

**Done when:** An assigned agent receives its issue details. An unbound session
or a request for a different issue is rejected. Tests cover both paths.
See [assignment rejection](spec.md#error-assignment).

## 3.4 Update the assigned issue

**Work:** Add a Controller API for an agent to update its assigned issue.

**Done when:** An assigned agent can update its issue and receive the result;
requests outside its assignment are rejected. An uncertain write is visible
for operator inspection before retry.
See [assignment rejection](spec.md#error-assignment) and
[uncertain outcomes](spec.md#error-uncertain).

## 3.5 Integration check and handoff

**Work:** Exercise discovery and assigned-issue access with a disposable Gateway
and controlled GitHub test repository. Use a synthetic Lobster workflow; document
the check and the required credential permissions.

**Done when:** A manually labeled test issue reaches the dispatcher once. The
assigned issue can be read, while access to another issue is rejected. Record
whether the issue-update path was tested against GitHub or only with fixtures.

## Handoff

Later work connects the real coding agent, draft PR publication and Slack
reporting. Issue template enforcement, dependency processing, Slack readiness
approval and automatic assessment of issue changes remain for later review.
