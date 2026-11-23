# WBS4.5 coding resumption and active time

Date: 2026-11-23

## Behavior

The operator-admin `agent-crew.resume` RPC takes repository, issueNumber,
expectedRunId and input (nonempty, at most 16,000 characters). It claims the
request before entering the dispatcher queue, so concurrent replies receive busy
rather than queue as steering. A delayed reply naming an older waiting run is
rejected even if the task has returned to waiting on another question.

Resume verifies retained waiting state, configured repository/agent/source path,
physical native session ID, last run ID, stopped state, and native workspace. The
existing Git common-directory/branch/base checks still apply. It preserves the
job, session, worktree and base, rereads the assigned issue and invokes the same
Lobster coding pipeline with human input explicitly bounded by Controller task
authority. It neither fetches a new task base nor creates a new session/worktree.
Other stopped waiting tasks do not block resumption; active or uncertain tasks
still do. A resumed task can wait again or complete normal validated delivery.

Active time is measured with the Controller monotonic clock around the coding
workflow call and retained as activeMs. This includes CLI/workflow overhead;
human waiting between calls is excluded. Each turn receives only the whole
remaining seconds of the shared 1,200,000 ms limit. Exhaustion blocks further
execution/delivery and requires inspection. The public status includes elapsed
time, limit and uncertainty. The uncertainty marker is persisted before a call;
interruption or an unacknowledged call cannot silently reset usage on retry.
Legacy waiting jobs lacking measured time or physical session binding are blocked.

Resume can operate after a Gateway restart while new admission remains paused,
subject to the same connection, native stopped-state and inventory checks. It
cannot bypass pending configuration activation or an inspection gate. Configuration
Apply still blocks on every waiting task. Failed/unknown usage needs operator
inspection; this batch does not add a usage-reconciliation control.

## Verification

Pinned Docker checks cover dispatcher/coding boundaries, coding-result parsing,
the native Lobster fake-CLI workflow and assigned-issue authorization, plus
lint/typecheck. Focused deterministic fixtures verify:

- Resume preserves job/session/base and never creates a replacement workspace.
- A 1,234 ms first turn plus a 2,000 ms resumed turn totals 3,234 ms, even with a
  day of human waiting; the resumed CLI deadline is 1,198 seconds.
- Concurrent input receives busy and invokes one workflow only.
- A reply for a previous question cannot answer a newer waiting run.
- Changed physical session or repository binding, missing usage and exhausted
  budget block model execution. An over-limit result cannot become a delivery.
- Reconstructed plugin state resumes a compatible waiter without reopening
  polling; interrupted execution stays needs-inspection with uncertain time.
- Multiple stopped waiters can resume without blocking one another indefinitely.

The underlying native same-session model continuation was qualified separately
in [waiting evidence](wbs4.5-coding-waiting-qualification.md). These new RPC/state
checks use fixtures; they are not live Controller or Slack acceptance.

## Remaining boundary

This batch is committed but not deployed. The live Gateway remains at source
789c3cf. Slack task-thread creation, input-request delivery and authenticated
thread-reply ingress still need to call this Controller seam. Token accounting,
usage reconciliation and Slack end-to-end acceptance remain outstanding.
