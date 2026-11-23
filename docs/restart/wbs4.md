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
- Copy `infra/local-dev/openclaw/openclaw.coding.example.json` to
  `.local/openclaw-coding.json`, set the same `owner/repo` in its GitHub
  repository and `coding.repositoryPath`, then clone the repository under
  `.local/repositories/owner/repo`. The in-container checkout path is
  `/workspaces/repositories/owner/repo`.
- Set `AGENT_CREW_DOCKER_SOCKET_GID` to the host socket's group ID when it is
  different from the local Compose default (`1001`).

## 4.1 Prepare the coding workspace

**Work:** Configure OpenClaw's Docker backend and create one native managed
worktree per issue session from the configured repository checkout. Sandbox all
non-main sessions; keep the main controller session unsandboxed so it can run
the trusted Lobster workflow. The Gateway state directory and temporary
inference workspaces use a host bind so sibling sandboxes can mount their
sources. Its `worktrees`, `worktree-projections`, and `sandbox` subdirectories
and repository source use host binds so sibling containers can mount their
workspace and skills. Preserve existing state when migrating from the named
volume. Build the pinned `sandbox` Dockerfile target
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
Qualify sandbox Git operations and task isolation in the WBS4.5 disposable
end-to-end run; the earlier container inspection is not that qualification.

## 4.2 Start the coding agent

**Work:** Connect the Lobster command step to the pinned `openclaw agent` CLI using the issue
session's managed worktree and WBS3 issue data. Pass issue content as workflow
arguments, not shell command text. The target is a 20-minute coding active-time
limit that excludes waiting for human instructions; WBS4.5 qualifies runtime
support and implements the timing policy.
See [timeouts](../../SPEC.md#error-timeout).

**Done when:** A ready test issue starts one coding turn in its assigned
session, and the session records the run ID, status, workspace path and branch.
The agent receives the assigned issue details. Closed or no-longer-ready issues
do not start a coding turn.

## 4.3 Return the coding result

**Work:** Pass the coding agent's result to the next Lobster step. Include the
assigned workspace path and branch alongside the run ID, status and validation
summary so WBS5 can identify the exact change to review and publish. WBS4.5
extends this result with structured validation and Controller-verified local
commits; its delivery contract owns the retained base and head SHA binding.

**Done when:** Lobster receives a validated run ID, status, workspace path,
branch and validation summary from the assigned run. A timeout, malformed result or
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

[WBS4.5](wbs4.5.md) provides repository connection and Git authentication;
WBS5 accepts this session-bound worktree result for Controller-mediated draft PR
publication. WBS4.5 adds basic Slack interaction and task usage limits; custom metering,
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
