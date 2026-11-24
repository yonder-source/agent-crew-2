# WBS5 publication qualification

Date: 2026-11-24

## Scope and evidence boundaries

This evidence covers WBS5's retained-delivery, branch push and draft pull request
publication path. Fixture results are distinct from the live GitHub check:

- Fixtures run by `./scripts/check-all.sh` cover assignment and delivery
  rejection, dirty/changed worktrees, wrong bindings and ancestry, separate
  push/PR intent, uncertain writes, restart retention, operator decisions,
  existing/mismatched PRs, duplicate suppression and public-result redaction.
- The live check used `yonder-source/disposable-test-repo`, issue #4, its
  Controller-created managed worktree, the exact retained coding delivery and
  GitHub App credentials mounted into the Gateway.
- The WBS4.5 full 20-minute operator timeout qualification remains deferred.
  This evidence does not claim that check passed.

## Live issue, coding and retained delivery

Assigned issue:

- `yonder-source/disposable-test-repo#4`
- Title: `test: qualify live Slack waiting and same-session resume`
- URL: <https://github.com/yonder-source/disposable-test-repo/issues/4>

Controller binding:

- Job ID: `d3df81da-1dfd-4cda-a914-68b48870e07f`
- Session key:
  `agent:coding:agent-crew-fb19503e3f8d0a1a9a3296860382eb75`
- Native session ID: `ef0b6ec3-d96d-4dd4-b848-c01710432725`
- Coding run ID: `01833ebf-5c5e-4064-a7bf-a76abbf2d00a`
- Branch: `openclaw/agent-crew-issue-4`
- Recorded base: `48e1200874eca26e69d88024db6f90abaf5bb3c7`
- Verified head: `fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6`
- Coding run and validation: `ok`

The exact verified commit is
`fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6`
(`chore: implement issue #4`). Its only file change is
`docs/slack-thread-qualification.md`, with two added lines. The commit's only
parent is the recorded base. The retained validation ran the exact-content Node
check for the file and exited zero.

No replacement head, agent-authored commit identity or caller-supplied
validation was accepted.

## Live push and draft PR

The Controller recorded these separate operations:

- Push operation `50693281-e2e0-49bc-8fc5-2131e500f8cb`: `confirmed`
- PR operation `bbd8050a-eb31-48ad-9a2f-1aab7b7ea36c`: `confirmed`

GitHub publication:

- Branch: `openclaw/agent-crew-issue-4`
- Remote head: `fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6`
- Draft PR: #7
- Base: `main`
- State: open draft
- URL: <https://github.com/yonder-source/disposable-test-repo/pull/7>

The PR title matches issue #4. Its body contains the bounded coding and
validation summaries plus `Fixes #4`. Repeated Lobster publication calls returned
the same retained operation and PR after read-only identity revalidation; no
second branch push or PR was created.

The public result exposed only `published`, repository/issue identity, bound
branch/head, validation, and the confirmed open-draft PR number/URL. It exposed
no operation ID, hash, PR body, workspace/session ID, continuation reference,
credential helper or token.

## How to inspect

Inspect issue, PR, branch and exact commit:

```sh
gh issue view 4 --repo yonder-source/disposable-test-repo
gh pr view 7 --repo yonder-source/disposable-test-repo
gh api repos/yonder-source/disposable-test-repo/git/ref/heads/openclaw/agent-crew-issue-4
gh api repos/yonder-source/disposable-test-repo/commits/fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6
```

Inspect the retained Controller job:

```sh
docker exec agent-crew-2-gateway-1 \
  openclaw gateway call sessions.describe \
  --params '{"key":"agent:coding:agent-crew-fb19503e3f8d0a1a9a3296860382eb75"}' \
  --json
```

Repeat the read-only publication/reporting path. A completed result must not
replay push or PR creation:

```sh
docker exec agent-crew-2-gateway-1 \
  openclaw gateway call tools.invoke \
  --params '{"name":"lobster","args":{"action":"run","pipeline":"workflows/publication-issue.lobster","cwd":".","timeoutMs":120000,"argsJson":"{\"sessionKey\":\"agent:coding:agent-crew-fb19503e3f8d0a1a9a3296860382eb75\",\"agentId\":\"coding\"}"},"sessionKey":"agent:main:main"}' \
  --json
```

Expected public result:

- `status: "published"`
- PR #7 and its URL
- branch `openclaw/agent-crew-issue-4`
- head `fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6`
- no operation ID, hash, credential, workspace or session identity

## Fixture verification

`./scripts/check-all.sh` is the repeatable fixture suite. Its boundary coverage
includes the five 5.5 areas in [wbs5.md](../wbs5.md): accepted/rejected
delivery identity, Git worktree and ancestry checks, separate operation
intent/confirmation/uncertainty, PR lookup/create idempotency, and Lobster/status
redaction. It is the synthetic and local-Git evidence; it does not replace the
live GitHub qualification above.
