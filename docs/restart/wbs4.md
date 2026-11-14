# WBS4-restart — Coding execution

## Goal

Run an assigned issue through a real coding agent in OpenClaw's Docker sandbox
and return its result to Lobster. The [restart specification](spec.md) defines
the MVP workflow.

## Entry conditions

- [WBS3-restart](wbs3.md) is complete: a ready issue can reach the dispatcher,
  and the assigned agent can access its issue through the Controller API.
- A disposable test repository and the selected coding runtime are available.
  Configure credentials through the agreed secret mechanism.

## 4.1 Prepare the coding workspace

**Work:** Configure OpenClaw's native Docker sandbox and a writable workspace for
the assigned repository. Keep the coding workspace separate from the Gateway's
credentials and Docker socket.

**Done when:** A disposable coding session can read and modify its repository
workspace. Verify that the sandbox does not receive the Gateway's secret mounts
or Docker socket. Document the local setup.

## 4.2 Start the coding agent

**Work:** Connect the Lobster workflow to the selected coding runtime using the
issue-specific OpenClaw session and the WBS3 issue data. Start with a 20-minute
timeout for the Lobster call and coding-agent step.
See [timeouts](spec.md#error-timeout).

**Done when:** A ready test issue starts one coding turn in its assigned session,
and the session records the run ID and status. The agent receives the assigned
issue details.

## 4.3 Return the coding result

**Work:** Pass the coding agent's result to the next Lobster step. Include the
information needed to review the work and continue to publication, such as the
workspace or branch reference and validation result.

**Done when:** Lobster receives the result from the assigned run and exposes a
clear success or failure status. An uncertain result is visible for operator
inspection before retry.
See [workflow failures](spec.md#error-workflow) and
[uncertain outcomes](spec.md#error-uncertain).

## 4.4 Validate a real coding task

**Work:** Run a small, bounded coding task in a disposable test repository using
the real coding runtime. Have the agent make the requested change and run the
relevant repository check.

**Done when:** The change and check result are available for human inspection,
and Lobster receives the coding result. Record the runtime, sandbox and elapsed
time so the initial timeout can be adjusted from experience.

## 4.5 Developer handoff

**Work:** Document the local coding setup, how to inspect a run and where to find
its result. Record any incomplete validation and the information the publication
slice needs.

**Done when:** A developer can repeat the coding check and inspect its output.
The handoff identifies the assigned issue and the source of the resulting change.

## Handoff

The next slice connects the coding result to Controller-mediated draft PR
publication. Slack reporting follows the MVP workflow. Custom metering,
checkpoint/restore and automatic interruption recovery remain for later review.
