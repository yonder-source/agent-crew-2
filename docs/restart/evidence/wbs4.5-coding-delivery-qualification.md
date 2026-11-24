# WBS4.5 coding delivery contract — 2026-11-23

The Controller prompt authorizes edits and validation only in the assigned
sandbox workspace. The Controller commits reconciled files on the managed
branch. Repository guidance and issue input cannot expand that
authorization. The existing native `openclaw/agent-crew-issue-<number>` naming,
exact fetched main base and retained assignment remain the branch contract.

The coding result parser accepts a final JSON report with `summary` and
`validation`. Validation contains `status` (`ok`, `failed`, `unknown`), optional
summary and checks with command, outcome, optional exit code and summary. An `ok`
report requires at least one check, all successful, with no nonzero exit code.
Missing, malformed or inconsistent validation becomes unknown. Unrecognized
validation fields and agent-supplied commit identity are not accepted as trusted
delivery metadata.

After a successful workflow and coding turn with successful validation, the
Controller verifies the assigned Git common directory, branch and base ancestry,
commits reconciled changes, then checks the clean worktree and stable head. It
disables hooks, automatic maintenance and signing, rejects executable Git filters
before file inspection/staging, and uses command-scoped author identity. It
retains `codingDelivery` beside the existing assignment:
`ready` with Controller-read `headCommit` and validation, or `needs-inspection`
with validation and a safe reason. WBS5 must read and revalidate this retained
binding before push. A later remote-main advance alone does not invalidate it.

## Verification

The pinned checks image was built from the changed source and its default checks
command passed with the source mounted read-only at `/lint-source` and networking
disabled. Coverage includes:

- Actual local Git: committed delivery, no task commit, untracked and modified
  files, wrong branch, unrelated history and remote main advancing.
- Controller fixtures: failed/unknown validation, failed Git inspection,
  Controller-read rather than agent-supplied head, retained delivery after a
  harness restart and duplicate-dispatch blocking.
- Prompt fixtures: task-scoped authorization, conflicting issue text, repository
  guidance precedence, local commit/report instructions and credential exclusion.
  These verify prompt construction, not model compliance with conflicting input.
- Native pinned Lobster: exact CLI arguments and structured report handoff with
  a fake coding CLI; no model call.
- Separate native Gateway, without network or host mounts: the expanded
  `scripts/session-roundtrip.mjs` saved and read back the complete synthetic
  assignment, base, head and validation, then matched the same data after an
  actual container restart. The first post-restart read was attempted before
  startup completed and returned connection refused; the read after Gateway
  health recovered passed. This is metadata persistence, not real task execution.

Host Git fixtures initially hit sandbox `EPERM` when opening their credential
socket. The same fixtures passed inside the isolated checks container.

The fixture checks above do not establish real model acceptance. The live
qualification below exercises the model; publication and Slack remain untested.

## Live sandbox qualification and blocking finding

2026-11-23. On the existing authenticated local Gateway, created native session
`agent:coding:delivery-qualification-20261123` with its own managed worktree and
`openclaw/agent-crew-issue-900001`. No assigned issue metadata was fabricated.
The new prompt and parser were exercised through native Lobster using temporary
workflow/module copies; the installed Controller plugin was not replaced.

The configured real `openai/gpt-6-luna` run
`b00b184d-961f-4565-b0af-5a6bfefc1346` created the requested single Markdown file,
ran an exact-content Node assertion, committed locally as
`0aa20f23acc4cdd323a082cc6ab6af1b77b0cae5`, and returned structured validation `ok`.
The actual sandbox had only its writable projection and read-only skills mounts,
network `none`, a read-only root and all capabilities dropped.

However, the Controller's `verifyTaskDelivery` correctly rejected the original
managed worktree: its HEAD was still the bound base
`58167c1984704af01b4853b55d8b11a29bf8b11f` and the new file was untracked. A repeated
inspection after run completion reproduced this failure. Both checkouts used the
expected branch name, but the guest used its own `.git`, while the managed
worktree shared the source repository's Git directory.

Pinned OpenClaw's `docs/gateway/sandboxing/workspace-access.md` explicitly says
guest Git commands operate on private metadata and reconcile file changes back
to the managed worktree. Thus sandbox commit success does not supply a committed
host delivery. The original contract therefore needed a decision between committing accepted
changes in the Controller and a separately qualified Git-history import. Do not
claim that original committed Controller handoff passed or bypass the delivery gate.

## Issue #1 live coding check

At the operator's request, read the current open, ready issue
`https://github.com/yonder-source/disposable-test-repo/issues/1`. It now asks for
the missing-ID `tasks.js` removal fix and regression tests without new packages
or external research. Updated clean source main through the existing scoped
App-token/Git preparation path to `48e1200874eca26e69d88024db6f90abaf5bb3c7`.
Used a separate qualification session
`agent:coding:delivery-qualification-20261123-issue1` and branch
`openclaw/agent-crew-issue-900002`, preserving the old Controller-assigned issue
session and branch. This is native coding qualification using the issue content,
not a successful Controller dispatch of issue #1.

Real run `8c759640-37d1-4503-a6f9-a92fff5728d8` changed `remove` to splice only
when the index is not -1 and added missing-ID/nonempty-list and empty-list tests.
The existing valid-ID removal test remained. All three tests passed. The new
parser retained the model's structured `npm test`, exit-code-zero report.
Independent `npm test` execution in the same network-isolated sandbox also
passed all three tests, using `npm_config_cache=/tmp/agent-crew-npm-cache` to
avoid creating more project-local cache files. Task code was not run on the
credential-bearing Gateway.

The guest branch contains commit
`82d846424204e0dd5c334b24f34d7d06a5f0379b` (`fix: preserve tasks when removing
unknown ids`). The model also reported an untracked `.npm/` directory generated
by its initial npm command. The original managed worktree retains modified
`tasks.js`, modified `tasks.test.js` and untracked `.npm/`, with no corresponding
host commit. Thus the coding/tests/report path passed, while clean committed
Controller handoff did not. Retained both workspaces for inspection; no push,
PR, issue update, history rewrite or deployment of the new plugin was performed
for this issue #1 qualification.

## Controller commit resolution and issue #2

The operator requested a new disposable issue for the proposed Controller-commit
test. Created
`https://github.com/yonder-source/disposable-test-repo/issues/2` without a ready
label, implemented the new contract, then applied `ready for agent` only after
the new runtime passed checks and was deployed. Preserved the old issue #1 state
and both qualification workspaces.

The projection regression first failed with `Coding delivery requires a local
task commit`: the fixture commits in an independent guest checkout and copies
only its file changes to the managed worktree. With `commitTaskDelivery`, the
same fixture produces a clean host commit; repeated settlement returns the same
SHA. Fixtures also reject mismatched issue/branch, configured executable filters
and untracked `.npm/`, and confirm commit hooks and configured signing are not
executed. The cache fixture first failed with `Missing expected rejection`
before the guard was added.

The full pinned checks-image command passed after Controller commit was added.
Following the filter-check ordering change, pinned lint/typecheck and repository
and coding-boundary checks passed again. The final cache guard passed build,
lint and the actual local Git regression with socket access. The final runtime
was compiled using the pinned Docker build stage.

Before deployment, native sessions.list reported ten sessions and zero active
runs. Preserved the old runtime image as
`agent-crew-openclaw:before-delivery-20261123` and copied the existing config to
ignored `.local/deployment-backups/delivery-20261123/`. Deployment used the
existing base and setup Compose files and retained configuration and all state.

Issue #2 ran through the actual Controller admission, native managed worktree,
Lobster, configured real model and new result parser. Recorded:

- Job: `b50763bd-5410-4484-ba17-2a312e9c150a`.
- Session: `agent:coding:agent-crew-51b1970b446c9614798db7fa34cade8e`.
- Coding run: `86340447-6108-43ee-96f3-9f747de8ed01`.
- Branch: `openclaw/agent-crew-issue-2`.
- Base: `48e1200874eca26e69d88024db6f90abaf5bb3c7`.
- Controller commit: `db3fc8db90fd77d079b24ac618e6437e159ba377`
  (`chore: implement issue #2`).

The model ran `npm_config_cache=/tmp/agent-crew-npm-cache npm test`, reported
exit code zero and structured validation `ok`. The Controller committed only
`tasks.js` and `tasks.test.js`; the managed worktree is clean and its actual HEAD
matches retained `codingDelivery.headCommit`. Job status is `completed` and
delivery status is `ready`. Duplicate dispatch preserved the same job, coding
run and head rather than re-running coding or creating another commit.

Independent test execution inside the same sandbox passed all three tests.
Sandbox inspection confirmed only its own projection and read-only skills
mounts, network none, read-only root and dropped ALL capabilities. Its files
remain uncommitted in the private guest Git metadata as intended; no `.npm/`
was present in either delivery. Task code was not executed on the Gateway.

After confirming all eleven sessions had no active runs, recreated the Gateway
with the final cache-guard runtime image
`sha256:b3494043d4366d4956a98649184e8e78f1455ca742c3ea9bf9f06855ea605aa6`.
Health recovered, and native operator status matched the pre-restart job ID,
session, coding run, workspace, branch, base SHA, delivery validation and commit
SHA exactly; status remained `completed`/`ready`. This qualifies the local
Controller-to-coding-to-committed-delivery path, duplicate suppression and
restart retention. No branch was pushed and no PR or Slack acceptance was run.

To repeat a new coding acceptance run, create a fresh issue with the issue #2
body and apply `ready for agent` after the desired runtime is healthy. Invoke
`agent-crew.dispatch` with that repository and new issue number, or let discovery
admit it. Read `agent_crew_status` through operator `tools.invoke`; compare its
retained base/head with the assigned managed checkout, inspect the changed paths,
and run validation only inside its sandbox. Repeating dispatch for a completed
issue checks idempotence rather than starting another coding run. Check the same
job/run/head and validation again after a Gateway restart.
