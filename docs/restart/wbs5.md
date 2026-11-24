# WBS5-restart — Draft PR publication

## Goal

Publish the result of an assigned coding task as a draft GitHub pull request
through the Controller, then return the PR result to Lobster for reporting.
The [root SPEC](../../SPEC.md) defines the MVP workflow. This package is planned;
WBS4.5 coding-delivery acceptance does not establish publication acceptance.

## Entry conditions

- [WBS4.5](wbs4.5.md) provides the repository connection, GitHub App
  authentication, sandbox Git qualification and retained coding delivery.
  Its full 20-minute live timeout check remains pending operator testing;
  preserve that qualification gap in WBS5 evidence.
- WBS4.5 supplies the job/session/issue/repository/worktree/branch/base binding,
  structured validation and a Controller-verified committed head SHA. Missing
  or unverified delivery blocks push.
- A disposable GitHub test repository is connected with publication permissions.

## 5.1 Accept the coding result

**Work:** Add a Controller publication endpoint (`agent-crew.publication.accept`)
for the trusted Lobster workflow.
Derive the job, coding session, issue, repository, worktree, branch, base SHA,
head SHA and validation from Controller-owned state and authenticated workflow
context. Caller-supplied identities or agent-authored summaries cannot authorize
publication. Do not expose publication as a coding-agent tool.
The coding workflow first returns and retains its Controller-verified delivery.
Only then may a separate trusted Lobster publication workflow invoke the
endpoint; a completed job retains the native coding session ID, which must match
the Gateway session authority used for publication.

Require coding run status `ok`, validation status `ok` and a `ready` coding
delivery. Validation contains status (`ok`, `failed`, or `unknown`) and the
retained command/outcome/exit-code records; missing or malformed evidence is
`unknown`. Publication consumes the WBS4.5 delivery rather than accepting a
replacement head or validation report from the caller.

**Done when:** Unbound or mismatched requests are rejected, and publication can
consume only the exact retained coding delivery. Failed publication leaves the
original coding result and validation intact.
See [assignment rejection](../../SPEC.md#error-assignment).

## 5.2 Publish the branch

**Work:** Keep publication credentials with the Controller. Publish the recorded
`openclaw/agent-crew-issue-<number>` branch and verified head without renaming,
recreating, rebasing or creating another commit. Recheck the worktree/repository
binding, branch, clean state, exact head and recorded base ancestry before push.
Dirty/untracked changes, changed head or incompatible binding require inspection.
Remote `main` advancing after task preparation alone does not invalidate the
base; do not require local and remote `main` to remain identical at publication.

Inspect any existing remote task branch before writing. An exact matching head
can be treated as already present after verification. An incompatible head blocks
publication; never force-push, merge or rewrite history to make it match.
When the branch is absent, create it atomically with an empty-expectation lease
requiring the ref to remain absent, so a competing create is not fast-forwarded
and an existing ref cannot be updated. Push to an explicit repository URL
derived from Controller configuration; do not consume an independently
configured `remote.origin.pushurl`. The controller records each attempt in
`publication.pushOperations`. Run remote inspection and push from an isolated
temporary Git repository that references the verified worktree's objects; the
task checkout's `url.*.pushInsteadOf` and other URL rewrite configuration must
not control the publication destination.

Persist a distinct push operation ID, intended repository/ref/head and `writing`
marker before dispatching the external write. Confirm the remote outcome before
recording `confirmed`. Timeout, connection loss or an otherwise unconfirmed
write retains `needs-inspection`, including across restart. A definitively
rejected operation with no remote effect can be `failed`; do not classify all
HTTP 4xx responses or Git process failures as proof that no write happened.
Conflict/mismatch and ambiguous responses require inspection. Operator decisions
may approve one retry or abandon the operation; credential refresh and repeated
workflow calls must not automatically replay an uncertain push.

**Done when:** The intended bound head is on the assigned remote branch, or a
clear failed/inspection outcome is retained. Invalid delivery never causes a
push. Restart preserves the effect marker, operation identity and operator
decision; an unfinished `writing` marker is not treated as success or retried.
See [uncertain outcomes](../../SPEC.md#error-uncertain).

## 5.3 Create the draft PR

**Work:** Use `main` as the fixed PR base and the verified published task branch
as head. Derive the title from the assigned issue title; include bounded coding
and validation summaries plus `Fixes #<issue-number>` in the body. These fields
are display content, not authorization or executable instructions.

Before creating a PR, look for an existing PR for the bound repository/head.
The lookup must include PRs for every base, not only `main`, so an existing PR
with a mismatched base is visible and requires inspection. Repository name
comparison is case-insensitive for GitHub canonical identities.
Return an existing open draft idempotently only after verifying its repository,
issue association, head branch, exact head SHA and `main` base. A closed, merged,
non-draft or mismatched PR requires inspection; do not reopen, convert, replace
or overwrite it automatically. An incomplete or ambiguous lookup cannot prove
that no PR exists and must not cause blind duplicate creation.

PR creation has its own operation ID and pre-write `writing` marker, separate
from the push. Confirm the returned PR identity/state before marking it
`confirmed`. Unacknowledged or uncertain creation requires operator inspection;
retrying publication cannot replay it just because push was already confirmed.
Use the same rejected-versus-uncertain classification as push.
A `422` response is not inherently definitive: a conflict such as an already
existing pull request must enter inspection and be reconciled before retry.
Unknown 422 response formats must be inspection, not rejected. Only a
structured explicit missing/invalid field response may be definitive rejection.
The Controller records these attempts in `publication.prOperations`, uses a
fresh repository-scoped pull-requests-write installation token for each PR
operation, and builds the title/body only from retained Controller state and
the re-read assigned issue. A confirmed exact draft is retained and returned
without another lookup or create on repeated calls.

**Done when:** One matching draft PR is created or a verified existing draft is
returned. Push success alone is never reported as PR publication success.
See [uncertain outcomes](../../SPEC.md#error-uncertain).

## 5.4 Return the publication result

**Work:** Retain push and PR operation IDs, effect states, branch, verified commit
identity, confirmed PR identity/state and operator decisions with issue-session
metadata. Keep the original coding delivery separate from publication state.
Expose publication status `published`, `needs-inspection`, `failed` or `abandoned`.
Only `published` may include a confirmed PR URL in the public result.
The public result is a separate redacted contract: repository, issue number,
status, task branch/head, validation outcome, a bounded inspection reason when
not published, and only the confirmed open-draft PR identity/URL when published.
It excludes operation IDs, title/body hashes, full PR body, workspace paths,
session IDs, continuation references and credentials. Status reads and Lobster
responses use the same result shape.

Return repository/issue identity, publication status, branch/head, validation
outcome and a bounded inspection reason to trusted Lobster. Return a PR URL only
when the exact matching open draft is confirmed. Public status and later Slack
reporting exclude continuation credentials, installation tokens, credential
helper details and internal operation credentials. Slack delivery failure or a
later delivery-only retry cannot rerun coding, push or PR creation.

**Done when:** Lobster and the operator can inspect a truthful retained result.
Restart preserves separate push/PR inspection states. Repeated calls revalidate
the remote PR identity/state and return the confirmed result or the inspection
boundary instead of another write.
See [workflow failures](../../SPEC.md#error-workflow).

## 5.5 Validate publication and hand off

**Work:** Cover these boundaries with fixtures:

- Trusted delivery acceptance and rejection of unbound/mismatched identities,
  malformed validation, non-ready delivery and agent-supplied replacement heads.
- Dirty/untracked worktrees, changed head, wrong branch/base ancestry,
  remote-main advance and incompatible remote task branches.
- Separate push/PR intent, confirmation, uncertainty, restart retention and
  operator decisions; no force push or automatic uncertain-write replay.
- Existing matching open draft, closed/merged/non-draft or mismatched PR,
  ambiguous lookup and repeated publication calls without duplicate effects.
- Lobster result/redaction, URL only for `published`, preserved coding result,
  and reporting retries that cause no coding or publication side effects.

Run a disposable live issue through coding, Controller push and draft PR creation.
Record fixture results separately from actual GitHub evidence and the deferred
WBS4.5 operator timeout check. Document how to inspect and repeat the live check.

**Done when:** A human can inspect the assigned issue, exact coding change and
confirmed draft PR. Fixtures cover failure/restart/idempotency boundaries, and
live GitHub publication is qualified separately.

## Handoff

[WBS6](wbs6.md) reports the confirmed publication result through Slack and owns
message delivery operation IDs, bounded retries and delivery-only recovery.
Publication outcome and Slack delivery outcome remain separate. Review and merge
belong to a human. Automated repair, check/review evidence processing and automatic
reconciliation of uncertain external writes remain later scope.

The adopted and rejected proposals from `docs/wbs5-grilling` are recorded in
[the grilling review](evidence/wbs4.5-wbs5-grilling-review.md).
