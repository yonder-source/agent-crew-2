# Assigned-issue tool qualification — 2026-11-23

## Native reproduction

Created disposable [issue #3](https://github.com/yonder-source/disposable-test-repo/issues/3)
to require one actual `agent_crew_issue_read` call and a single Markdown artifact.
Issue updates, commits by the agent, pushes and PRs were outside the task.
The Controller admitted the task through its normal dispatch path:

- Job: `c0881b6f-03c7-4804-9f16-4eb0815420dc`.
- Session: `agent:coding:agent-crew-9081bc6214ba5ecaa3e5683983892f90`.
- Initial run: `9944245b-8d6d-42e0-a9b0-a04f998bfb4a`.
- Managed branch: `openclaw/agent-crew-issue-3`.
- Base: `48e1200874eca26e69d88024db6f90abaf5bb3c7`.

The first run stopped with unknown validation and no file changes. Its native
transcript contains a Code Mode `exec` calling
`tools.agent_crew_issue_read({})`, followed by
`TypeError: tools.agent_crew_issue_read is not a function`.

Read-only SQLite inspection of the retained `systemPromptReport` shows that both
`agent_crew_issue_read` and `agent_crew_issue_update` were in the actual run's
tool entries. This is stronger evidence than the operator `tools.effective`
preview, which did not list them. Do not use preview absence as proof that the
coding run omitted these tools.

Live `config.get` confirmed repository `yonder-source/disposable-test-repo` in
`config`, `runtimeConfig`, `sourceConfig` and `resolved`, using
`/etc/agent-crew/openclaw.json`. The missing-repository factory guard is valid,
but was not the cause in this Gateway/run.

## Diagnosis and change

The actual run uses `agentHarnessId=codex`, not the built-in Code Mode guest. Codex dynamic tools are searchable/deferred by default and grouped under the `openclaw` namespace (`extensions/codex/src/app-server/dynamic-tool-catalog.ts`). Tool lookup must use native `tool_search` and the returned callable name.

A trial prompt based on the built-in Code Mode `catalog.search` failed in run `53de56e4-6086-4538-8d47-903840d46316` with `ReferenceError: catalog is not defined`. That guidance was withdrawn. The current prompt instead explains Codex deferred-tool discovery without assuming a JavaScript namespace. Assignment, invocation-current and write-inspection checks remain unchanged.

Temporary metadata probes showed why preview diagnostics were misleading, but
attempts to complete/reload the metadata did not change preview results. Those
trials and all probes were removed. No tool-resolver compatibility patch was
adopted. The official image contains only the previously verified startup-race
patch and the coding-prompt clarification.

The updated prompt passed the existing coding-boundary fixtures and lint/build.
Runtime image:
`sha256:0a0349447a2ad8d7d715be40fd1e42dec9aab207b98bcfb95112edfdff4b6285`.

## Live acceptance

After inspecting each stopped run and its clean worktree, explicit operator
resolution retried the same session, branch, workspace and base. Each retry
created a new job/run attempt as designed. The final run used native discovery
and invoked `openclaw__agent_crew_issue_read`; its update-tool discovery also
returned `openclaw__agent_crew_issue_update`.

The native transcript records an actual `agent_crew_issue_read` tool call with
`{}` and its paired tool result with `isError=false`, repository
`yonder-source/disposable-test-repo`, number `3`, the expected issue title and
state `open`. This verifies a model-triggered, Controller-bound GitHub read,
rather than an operator tool call or a model's unsupported success claim.
The update tool was discovered but not invoked; this task does not qualify a
live issue write.

Final delivery:

- Job: `900771c3-cc70-45dc-9165-1767244cf967`.
- Run: `3948a64f-25ab-4fd0-8ea1-3b97b166541d`.
- Delivery: `ready`, with structured validation `ok` and an actual Node assertion
  checking the recorded repository and issue number, exit code `0`.
- Controller commit: `7245dab246c18a25214d4cfb737e0af45a1fdd51`.
- Changed path: only `docs/assigned-issue-tool-qualification.md`.
- Managed worktree: clean after delivery.

The successful run closes the model-visible assigned-issue read gap. The
operator preview remains unsuitable as the sole acceptance criterion for these
Codex harness tools. No new resolver patch, permission expansion, issue write,
push or PR was needed.
