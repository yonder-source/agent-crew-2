# WBS4-restart — Coding execution

## Goal

Run an assigned issue through a real coding agent in an OpenClaw managed
worktree and Docker sandbox, then return its result to Lobster. The [root
SPEC](../../SPEC.md) defines the MVP workflow.

## Entry conditions

- [WBS3-restart](wbs3.md) is complete: a ready issue can reach the dispatcher,
  and the assigned agent can access its issue through the Controller API.
- A disposable test repository and the selected coding runtime are available.
  Configure credentials through the agreed secret mechanism.
- Set `coding.agentId` (default `coding`) to a configured OpenClaw agent.
  Session keys and the Lobster agent target use this same setting.
- Configure the matching local Git checkout under the Gateway's
  `/workspaces/repositories` bind and set `plugins.entries.agent-crew.config.coding.repositoryPath`
  to that in-container path. GitHub discovery and coding require both the
  configured repository and this checkout.
- Set `AGENT_CREW_DOCKER_SOCKET_GID` to the host socket's group ID when it is
  different from the local Compose default (`1001`).

## 4.1 Prepare the coding workspace

**Work:** Configure OpenClaw's Docker backend and create one native managed
worktree per issue session from the configured repository checkout. Sandbox all
non-main sessions; keep the main controller session unsandboxed so it can run
the trusted Lobster workflow. The Gateway keeps state in the `openclaw-data`
named volume. Its `worktrees`, `worktree-projections`, and `sandbox`
subdirectories and repository source use host binds so sibling containers can
mount their workspace and skills. Build the pinned `sandbox` Dockerfile target
as `openclaw-sandbox:bookworm-slim` before starting coding turns. The Gateway
includes a Docker CLI, joins the host Docker socket group, and passes only the
assigned worktree to the coding sandbox.

For the local Compose deployment, run
`docker build --target sandbox -t openclaw-sandbox:bookworm-slim .` from the
repository root before `docker compose up`. `scripts/check-all.sh` builds this
image as part of its disposable validation.

**Done when:** Two disposable issue sessions receive distinct writable
worktrees from the configured repository. Verify that sandbox containers have
no Gateway secret mounts or Docker socket, use a read-only container root,
drop Linux capabilities and have no network egress. Document the local setup.

## 4.2 Start the coding agent

**Work:** Connect the Lobster workflow to `openclaw.agent` using the issue
session's managed worktree and WBS3 issue data. Pass issue content as workflow
arguments, not shell command text. Start with a 20-minute timeout for the Lobster
call and coding-agent step.
See [timeouts](../../SPEC.md#error-timeout).

**Done when:** A ready test issue starts one coding turn in its assigned
session, and the session records the run ID, status, workspace path and branch.
The agent receives the assigned issue details. Closed or no-longer-ready issues
do not start a coding turn.

## 4.3 Return the coding result

**Work:** Pass the coding agent's result to the next Lobster step. Include the
information needed to review the work and continue to publication, such as the
workspace or branch reference and validation result.

**Done when:** Lobster receives a validated run ID and status from the assigned
run plus workspace and branch references. A timeout, malformed result or
uncertain run outcome remains visible for operator inspection before retry.
See [workflow failures](../../SPEC.md#error-workflow) and
[uncertain outcomes](../../SPEC.md#error-uncertain).

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

The next slice accepts this session-bound worktree result for Controller-mediated
draft PR publication. Slack reporting follows the MVP workflow. Custom metering,
checkpoint/restore and automatic interruption recovery remain for later review.

## Current qualification limit

On 2026-11-20, a disposable repository and the pinned Gateway created a coding
worktree and a sibling sandbox container. `docker inspect` confirmed a
read-only container root, no network, dropped capabilities, and only the
worktree and skills binds; no Docker socket or Gateway secrets were mounted.
The coding turn then received HTTP 401 from the OpenAI Responses API because
this disposable Gateway had no model credentials. Model-generated code, a live
assigned GitHub issue, and end-to-end Lobster execution remain unverified.
Explicitly declare both `main` and `coding` agent entries with
`agents.ownership=explicit`; declaring only `coding` removes the implicit
`main` agent.
