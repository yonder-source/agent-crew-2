# WBS5-restart — Draft PR publication

## Goal

Publish the result of an assigned coding task as a draft GitHub pull request
through the Controller, then return the PR result to Lobster for reporting.
The [root SPEC](../../SPEC.md) defines the MVP workflow.

## Entry conditions

- [WBS4.5](wbs4.5.md) provides the repository connection and GitHub App
  authentication and qualifies coding sandbox Git operations.
- A disposable GitHub test repository is connected with permissions for
  publication.

## 5.1 Accept the coding result

**Work:** Add the Controller API needed to submit the result from the assigned
coding session. Use the issue and repository assignment to identify the work
and the source to publish.

**Done when:** The Controller accepts a result from the assigned session and
rejects an unbound session or a request for a different issue. The result
identifies the change and its validation outcome.
See [assignment rejection](../../SPEC.md#error-assignment).

## 5.2 Publish the branch

**Work:** Have the Controller prepare and push the assigned work to a task
branch in the configured repository. Keep publication credentials with the
Controller.

**Done when:** A valid test result produces a branch containing the intended
change. A request cannot choose an unrelated repository or issue. An uncertain
push outcome is visible for operator inspection before retry.
See [assignment rejection](../../SPEC.md#error-assignment) and
[uncertain outcomes](../../SPEC.md#error-uncertain).

## 5.3 Create the draft PR

**Work:** Add Controller-mediated draft PR creation for the assigned issue and
branch. Return the PR URL and status to the caller.

**Done when:** A successful publication produces a draft PR for the assigned
issue. An uncertain response is visible for operator inspection before retry.
See [uncertain outcomes](../../SPEC.md#error-uncertain).

## 5.4 Return the publication result

**Work:** Connect the Controller publication API to the Lobster workflow and
retain the PR URL and status with the issue session.

**Done when:** Lobster receives the PR result and the operator can inspect the
URL and status. Publication failures remain visible in the workflow status.
See [workflow failures](../../SPEC.md#error-workflow).

## 5.5 Validate publication and hand off

**Work:** Verify the publication handoff and failure boundaries with fixtures.
Run a disposable issue through the configured connection, sandbox coding and
draft PR publication. Document how to repeat the check and inspect its result.

**Done when:** Fixture checks cover result delivery, publication and inspection
boundaries. A human can inspect the draft PR, assigned issue and coding change;
record live GitHub qualification separately from fixture checks.

## Handoff

[WBS6](wbs6.md) reports the PR result through Slack and leaves review and
merge to a human. Automated repair, detailed check/review evidence processing
and automatic reconciliation of uncertain writes remain for later review.
