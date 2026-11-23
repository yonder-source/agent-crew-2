# WBS4.5 coding waiting boundary

Date: 2026-11-23

## Implemented boundary

A successful coding turn may finish with a final JSON report containing
`requestInput`, a nonempty question of at most 4,000 characters. The coding
prompt distinguishes this operation from ordinary progress and asks the model
to end its turn rather than hold a tool call open. The result parser validates
the question independently of validation; malformed requests fail closed.

The Controller verifies native `sessions.describe` for the same session key,
the matching `lastRunId`, `hasActiveRun=false` and no active run IDs. Only then
can it retain `status=waiting` and the question alongside the existing job,
run, worktree, branch and base. It does not commit or mark a delivery ready,
even if a request carries an `ok` validation report. Failed turns or unknown
stopped-state evidence require inspection. Waiting is a duplicate-admission lock,
blocks connection Apply/polling restart checks and denies assigned-issue tools.
The status projection exposes the question without granting a resume action.

## Checks

The pinned Docker checks image passed lint/typecheck and the affected dispatcher,
coding boundary/result, native Lobster fake-CLI and assigned-issue fixtures.
Focused fixtures cover retained waiting after reconstructed plugin startup,
duplicate dispatch, blocked Apply, no Controller commit, malformed questions,
failed/active/unknown/mismatched native runs and assigned-issue denial while
waiting. Existing non-waiting completion/delivery checks remain passing.

## Native model continuation qualification

A separate native session was created with a dedicated managed worktree:

- Session key: `agent:coding:slack-resume-qualification-20261123`
- Native session ID: `4cbe0994-01e3-4027-86f8-ca4636faeb79`
- Worktree ID: `753505c3-dfbd-4403-87ca-d2f224c6ee1b`
- Workspace: `/home/node/.openclaw/worktrees/c2f6b1f78d368c73/slack-resume-qualification-20261123`
- Branch: `openclaw/slack-resume-qualification-20261123`
- Provider/model/harness: `openai/gpt-6-luna`, native Codex
- First formal request-report run: `94647a95-9b6e-4aee-814c-d4eb86b4d5ff`
- Continuation run: `677ec871-7d08-4fdb-b147-e5db85d4d902`

Through the authenticated `agent` RPC with `expectFinal=true`, the first turn
returned `requestInput="May I continue?"` and unknown validation, then stopped.
A separate second RPC using the same session key retrieved marker `KITE-9427`
from an earlier turn without being given it again. Before/after session reads
confirmed the same physical session and worktree binding. The final native
lastRunId matched the second run; `hasActiveRun=false`, `activeRunIds=[]`, and
Git status was clean. The marker-bearing native Codex transcript
`rollout-2026-11-23T10-22-45-01a207ed-f88a-7410-aa0a-18d5f3aa4462.jsonl`
had zero tool-call records. Neither turn used tools or edited files. The probe did
not require a worktree context-summary file.

## Scope limits

The new Controller waiting path is fixture-qualified and is not deployed.
The native probe qualifies model/session continuation only; it does not exercise
a Controller-dispatched assigned issue, actual Gateway restart between turns,
Slack delivery, authorized thread replies or Controller resume. Those and
cumulative active-time/token accounting remain separate integration work.
The live Gateway still runs source `789c3cf` with Slack ingress disabled.
