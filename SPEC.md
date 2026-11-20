# Agent Crew Specification

This is the working project specification, initialized from the restart
bootstrap baseline. Update it as WBS work settles requirements and decisions.

## Outcome

Coordinate coding work from a GitHub issue to a draft pull request, with human
supervision through Slack and GitHub. Run the production installation on a
cloud VM without a personal workstation remaining connected.

## MVP workflow

1. A human clarifies an issue and manually applies `ready for agent` in GitHub.
2. A dispatcher discovers the issue and starts one active workflow for it.
3. Lobster orchestrates the workflow and invokes a coding agent in an OpenClaw
   session associated with the issue.
4. The agent implements and validates the work. The Controller provides GitHub
   APIs scoped to the issue assigned to that agent.
5. The Controller publishes a draft PR and returns the result and URL to the
   workflow, which reports it through Slack. A human reviews and merges it.

The issue discovery, coding and publication paths must be exercised together
before claiming end-to-end acceptance. WBS1 establishes infrastructure and a
small OpenClaw integration; it does not implement this workflow.

## Initial design

- Run OpenClaw Gateway in Docker, using its sessions, Slack integration,
  Control UI and supported plugin APIs. Use Lobster for workflow sequencing.
- Use a lightweight single dispatcher queue: check the issue's session
  metadata and process the check-and-start sequence serially.
- Keep a Controller capability for GitHub access and draft PR publication.
  Agents may read and write only their assigned issues. Its process placement
  and the exact API are implementation decisions to validate; a separate
  Supervisor is not a prerequisite for the foundation.
- Store the repository, issue, job ID, workflow status, Lobster reference and
  agent run ID in OpenClaw session metadata when available. Add state only as
  the workflow demonstrates a need. The earlier probe established session
  metadata persistence, not a completed production workflow.
- Start with OpenClaw's Docker sandbox for coding and validate its writable
  workspace. Revisit privileged supervision if the chosen runtime needs it.
- Start with a 20-minute timeout for each Lobster call and coding-agent step;
  adjust after observing actual runs. A pause for human input ends the current
  Lobster call; the next resume is a separate call.

## Repository connection UI

[WBS5.5](docs/restart/wbs5.5.md), between draft PR publication and Slack
integration, delivers a required single-repository connection screen accessible
from OpenClaw. An authenticated operator can configure the GitHub repository
and matching checkout without editing JSON, inspect credential availability,
validate access and save the connection using the existing configuration store.
Keep secret values out of UI responses. Configuration must survive restart;
report any restart needed to apply changes. Prevent connection changes from
redirecting active or uncertain work. Reuse supported OpenClaw UI/configuration
facilities; qualify the pinned runtime's extension support before choosing the
integration. WBS6 end-to-end acceptance begins with this screen. Multi-repository
management and credential provisioning are outside this UI package.

## WBS2 dispatcher

Use the public, authenticated Gateway API to create native issue sessions and
read/write the registered `agent-crew-job` session extension. The dispatcher
runs in the Gateway plugin and uses the supported SDK `callGatewayFromCli`
client with an explicitly supplied `AGENT_CREW_GATEWAY_TOKEN` and loopback
endpoint. This credential needs operator permission for session metadata
mutation; it is never a tool argument or result. This is the initial co-located
Controller capability. A custom agent harness is not required: the ownership
restriction on the SDK's plugin session-creation helper does not apply to the
operator `sessions.create` API.

One queue per Gateway installation serializes admission and Lobster calls.
Normalize repository names and derive a stable session key from repository and
issue number. Persist `starting` with a job ID and process-generation ID before
invoking the fixed synthetic workflow through `tools.invoke`. Interpret both
the Gateway `ok/output` envelope and Lobster's result; record status and any
returned continuation token internally. Tool results and operator-resolution
responses expose only public job fields, excluding continuation credentials.
Malformed session extensions block admission with an inspection error.
Completed, active, abandoned and uncertain work
blocks another start. Status reads remain available while a workflow is running.

A retained `starting` record without a matching in-flight start is reported as
`needs-inspection`, including after a process restart or a failed metadata
write. Gateway errors are reported without their raw messages, which may
contain credentials. Malformed workflow results and missing continuation
tokens require inspection. The operator-only
`agent-crew.resolve` Gateway method requires `operator.admin` and an inspection
note; `retry` permits one new attempt, while `abandon` keeps the issue blocked.
The next attempt retains the latest operator decision. This boundary assumes
one Gateway owns its state volume; it is not a distributed admission lock.

The pinned Lobster plugin is installed into the Docker image, so container
replacement does not lose its executable path. WBS2 uses synthetic issues and
workflows only. The executable qualification and its limits are recorded in
[WBS2](docs/restart/wbs2.md).

## WBS3 GitHub issue access

Use Octokit for GitHub REST requests, with a replaceable credential provider
that reads a repository-scoped GitHub App installation token from
`/run/secrets/agent-crew-github-installation-token`. Keep HTTP requests confined
to the configured repository, bound request duration and response size, validate
responses, and never automatically resend a write with an uncertain outcome.
WBS3 does not provision a GitHub App or mint installation tokens.

Poll one configured repository for open issues carrying the exact `ready for
agent` label. Submit discovered issues through the serialized WBS2 dispatcher;
repeated discovery returns existing work. Keep the empty-result case distinct
from provider failure. Arbitrary issue dispatch is available only through the
operator-scoped `agent-crew.dispatch` Gateway method, not an agent tool.

Expose `agent_crew_issue_read` and `agent_crew_issue_update` as session-bound
tools using the pinned OpenClaw v2 tool factory's host-provided session key and
invocation-current guard. Derive repository, issue and job identity from the matching
`agent-crew-job` session metadata. Agents cannot provide a session key,
repository or issue number. Allow reads and body-only updates for the active
assignment in the configured repository. Before a body update, persist its
operation ID and body hash in session metadata. If a dispatched write has an
uncertain result or a retained marker is found after restart, block further
writes and require an operator decision (`confirm`, `retry` or `abandon`) with
an inspection note through `agent-crew.resolve`.

WBS3 fixture checks qualify provider and authorization logic. Live GitHub
qualification requires a disposable test repository and a pre-provisioned
GitHub App installation token with Issues read/write permission; report it
separately from fixture results.

## Error handling and retries

| Situation | MVP behavior | WBS |
| --- | --- | --- |
| <a id="error-configuration"></a>Plugin startup fails, or required settings are invalid or missing | Show a clear error; keep secret values out of startup errors. | [1.2](docs/restart/wbs1.md#12-minimal-plugin), [6.1](docs/restart/wbs6.md#61-configure-the-workflow) |
| <a id="error-duplicate"></a>An issue is discovered or requested again | Return the existing work instead of starting another workflow. | [2.2](docs/restart/wbs2.md#22-single-dispatcher-queue), [2.3](docs/restart/wbs2.md#23-lobster-workflow-start), [3.2](docs/restart/wbs3.md#32-connect-discovery-to-the-dispatcher) |
| <a id="error-uncertain"></a>A workflow start, coding result, issue update, push or PR creation has an uncertain outcome | Stop and let the operator inspect before retrying, including after a restart. A blocked start stays blocked until the operator decides how to proceed. | [2.4](docs/restart/wbs2.md#24-operator-status-and-uncertain-outcomes), [3.4](docs/restart/wbs3.md#34-update-the-assigned-issue), [4.3](docs/restart/wbs4.md#43-return-the-coding-result), [5.2](docs/restart/wbs5.md#52-publish-the-branch), [5.3](docs/restart/wbs5.md#53-create-the-draft-pr) |
| <a id="error-discovery"></a>GitHub issue discovery fails | Report the failure separately from an empty result. | [3.1](docs/restart/wbs3.md#31-read-ready-issues) |
| <a id="error-assignment"></a>A session is unbound or requests another issue or repository | Reject the request. | [3.3](docs/restart/wbs3.md#33-read-the-assigned-issue), [3.4](docs/restart/wbs3.md#34-update-the-assigned-issue), [5.1](docs/restart/wbs5.md#51-accept-the-coding-result), [5.2](docs/restart/wbs5.md#52-publish-the-branch) |
| <a id="error-workflow"></a>Coding or publication fails | Show the failure in the result or workflow status. | [4.3](docs/restart/wbs4.md#43-return-the-coding-result), [5.4](docs/restart/wbs5.md#54-return-the-publication-result), [6.3](docs/restart/wbs6.md#63-report-the-draft-pr) |
| <a id="error-slack"></a>Slack delivery fails | Show the delivery failure without misrepresenting the workflow or publication outcome. | [6.2](docs/restart/wbs6.md#62-connect-slack-reporting) |

<a id="error-timeout"></a>Each Lobster call and coding-agent step starts with a
20-minute timeout ([WBS4.2](docs/restart/wbs4.md#42-start-the-coding-agent)). A timeout may
leave an uncertain outcome. Verify inspection behavior before unattended
production use. Automatic retry policy for confirmed failures is not yet
defined; automatic recovery and reconciliation are later decisions.

## Deployment and credentials

Use Docker Compose secrets on encrypted host storage for local development and
personal use. In production, use the cloud provider's secret manager; secrets
must be encrypted at rest. OpenClaw can resolve platform-injected environment
values through SecretRef. Before production use, verify the selected secret
manager's delivery path into each consumer and document the references and
configuration used. Keep secret values out of repository files, logs and
agent context.

Target a cloud VM with Docker for the first production deployment. Validate
locally before cloud deployment. The selected runtime version and image digest
must be recorded and checked against the APIs used by the implementation.

The WBS1 foundation pins OpenClaw `2026.11.3` and its matching plugin SDK. The
[developer handoff](README.md) records the image digest, toolchain
versions and Docker build and integration-check commands.

### WBS4 coding execution

`coding.agentId` selects the OpenClaw agent for issue sessions (default
`coding`). Use that same value in the issue session key and Lobster agent
argument. Configure the matching agent entry in OpenClaw with its workspace
and tool policy. Controller capabilities remain in the plugin; the main
workflow invocation context is distinct from the assigned coding session.
Designer readiness remains later scope.

Use OpenClaw `sessions.create` with its managed-worktree options to give each
assigned issue session a distinct checkout from the configured repository
source. The session worktree is the coding artifact; WBS4 returns its path,
branch, agent run ID, run status and validation summary through Lobster. WBS4
does not push or create a pull request; WBS5 owns publication. Pass issue data
as Lobster workflow arguments to `openclaw.agent`, and re-read the issue before
starting to ensure it remains open and labeled `ready for agent`.

Configure the OpenClaw Docker sandbox for non-main coding sessions with
writable worktrees, a read-only container root, dropped capabilities and no
network egress. Run Lobster from the unsandboxed main controller session and
target the separate assigned coding session explicitly. The coding sandbox
receives only its assigned managed worktree; it does not receive Gateway secrets
or the Docker socket. The Gateway itself needs the host
Docker socket to create sibling sandbox containers. Keep OpenClaw state in the
`openclaw-data` named volume; bind its `worktrees`, `worktree-projections`, and
`sandbox` subdirectories plus the repository source to host directories so
native sibling containers can mount their workspace and skills. Build the
pinned `sandbox` Dockerfile target as `openclaw-sandbox:bookworm-slim` before
starting coding turns. The Gateway image includes a Docker CLI and joins the
host Docker socket group.

Coding run timeout or malformed/uncertain result remains `needs-inspection` and
blocks automatic retry. The initial Lobster and coding-agent deadline is 20
minutes. A GitHub-enabled plugin configuration requires one configured local
repository checkout path corresponding to the configured GitHub repository.

## Later scope

Slack approval that causes the Designer agent to label an issue, automatic
recovery of lost Lobster checkpoints or interrupted coding, automatic
reconciliation of uncertain writes, and full backup/retention automation are
later decisions. An operator handles uncertain outcomes for the MVP.

## Acceptance

The MVP is ready for review when a human can label an issue, observe one coding
workflow, receive a draft PR link in Slack and review the resulting changes.
Demonstrate the selected sandbox, assigned-issue access and secret delivery in
the target installation. Exercise duplicate discovery, interruption and
uncertain outcomes, including the operator inspection boundary, alongside the
successful path. Report any unverified integration separately.

## Planning

Keep each package reviewable in one agent session, targeting 300–600 handwritten
changed lines per branch/PR (additions plus deletions), including tests and
documentation. Above 800 lines, review whether to split. Report lockfile and
generated changes separately. Keep each delivery independently verifiable.

- [WBS0 — restart decisions and targeted feasibility](docs/restart/wbs0.md)
- [WBS1 — Dockerized OpenClaw foundation](docs/restart/wbs1.md)
- [Current exploration items](docs/restart/outstanding.md)

- [NoSlop development checks](docs/noslop/README.md)

## NoSlop development checks

NoSlop constrains AI-generated changes through standard lint, TypeScript
checks, focused product regressions and CI. Agent Crew is the first host;
reusable practices for other Node.js, TypeScript and Docker repositories are
identified during delivery and extracted after implementation review.

WBS0 records the verified baseline inventory. WBS1 adds locked development
tooling and shared Docker/CI lint, compiler and lint-configuration checks.
WBS2–5 cover repository restrictions, regression gaps, merge/change authority
and final acceptance.

`eslint.config.mjs` applies ESLint recommended rules to JavaScript and
typescript-eslint recommended typed rules to TypeScript, including declarations.
The resolved typed preset already enables floating/misused Promise checks;
`no-unsafe-type-assertion` is added explicitly because the preset omits it.
Only installed dependencies and compiled output are ignored. Application code,
scripts, JavaScript workflows and retained JavaScript evidence are linted.
JavaScript receives syntax/scope rules; typed checks apply to the TypeScript
project. Input boundaries use runtime guards instead of narrowing assertions.
The checks image copies the source tree, including `.github` scripts. Compose
mounts the checkout read-only at `/lint-source`; coverage acceptance compares
its JS/TS inventory with ESLint's actual results in the image. Missing, ignored
or extra source files fail the check. Dependency/generated/local-state trees
are excluded from inventory. Fixtures cover new root, nested and hidden paths.
Job status types and validation share one literal list; only `retry-approved`
permits another dispatch after an existing job is found.

Enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`noFallthroughCasesInSwitch` alongside strict mode. All three are suitable for
the current source; no compiler flag or typed rule exception is needed.
The paired `src/config.mjs` is explicitly listed in `tsconfig.json` so declaration
discovery cannot suppress its runtime emit; the build smoke-imports its output.
The build/check stages install pinned development dependencies using the
committed lockfile and `npm ci --include=dev --legacy-peer-deps --ignore-scripts`.
The pinned OpenClaw image supplies the peer SDK and its matching release supplies real
declarations. Runtime dependencies remain unchanged, and quality tools stay
in build/check stages. The existing `scripts/check-all.sh` remains the shared
CI entry and exercises CLI lint acceptance fixtures as well as product checks.

Use maintained presets, native validators and existing test/CI entry points.
Custom checkers require a demonstrated gap and focused tests. Tool configuration
owns enabled rules and narrow exceptions. Behavioral tests establish validation,
authorization and uncertain-effect handling. Confirm actual GitHub protection
capabilities before introducing custom approval infrastructure.

WBS4 uses the solo-maintainer model: the owner reviews quality-rule, workflow
and test changes and merges PRs. Protect `main` with separate rulesets: one
requires PRs and the `Gateway checks` status from GitHub Actions (running
`scripts/check-all.sh`), and blocks force pushes and deletion; the other enables
`Restrict updates` and allows only Repository administrators to bypass for PRs.
Separate rulesets ensure the update bypass cannot bypass required CI. When
applied, the proposed controls are intended to prevent Write-level coding agents
from merging PRs or updating `main` directly. Do not
require an approval count or give agents a bypass. Repository administrators
retain authority to change the rulesets. Verify live enforcement before
describing it as active. Test Git and supported VS Code push defaults first;
add a local `pre-push` guard only for an observed gap.

WBS4 live inspection found no rulesets and `main.protected=false`; required
status checks are disabled. The GitHub Actions status context is `Gateway
checks`, whose job executes `scripts/check-all.sh`. The proposed configuration
uses separate CI/PR and update restriction rulesets, binds the required check to
GitHub Actions as its expected source, and grants Repository administrators
PR-only bypass only on the update restriction ruleset. A PR can weaken the
workflow while retaining the required job name; the owner reviews workflow
changes before merging under the solo-maintainer model. The rulesets have not
been applied or live-tested; server-side protection and agent-authority
enforcement remain deferred.

WBS2 uses native ESLint restrictions for eval/Function/string timers, process
and VM imports, the reviewed public SDK entry points and direct production
imports from scripts/tests/historical material. Static ESM imports are required:
dynamic imports, require loaders and createRequire are rejected so destructured
or renamed bindings cannot bypass module restrictions. Fixed CLI helpers have
file-specific named-import exceptions; the mock harness permits only
createContext/runInContext. Shell options are rejected. These are syntax and
import boundaries, not a general analysis of indirect data flow or subprocess
arguments. No dependency-graph package is required by the current import graph.

The shared checks entry validates resolved Compose JSON with dependency-free
Node assertions for loopback ports, isolated networking, unprivileged services,
state persistence, the read-only lint mount and current OpenClaw plugin/tool,
authentication and version settings. Native OpenClaw validation still owns
schema validity. Actual CLI fixtures exercise restrictions and narrow exceptions;
isolated model mutations exercise deployment assertions.

For every package, record test commands/results and reusable candidates in local
project memory; move settled requirements into this specification. Distinguish
mock, native synthetic and live integration evidence. Extend checks for future
product capabilities alongside their implementation.

### WBS3 review follow-up

Keep issue body update inspection/abandonment state across workflow retries.
A live body PATCH remains `writing`; only a retained marker without a live
in-process operation is treated as interrupted. Operator issue-update decisions
are rejected while that PATCH is still running. Exclude local GitHub secret
files from Docker build context as well as Git tracking.

Clear the issue-update marker after a confirmed success or a failure known to be
safe to retry. Preserve it for uncertain outcomes, including timeouts and
interrupted writes. Operator `confirm`, `retry` and `abandon` decisions apply
only after the operation is no longer running, require an inspection note, and
remain recorded without automatically resending or clearing the inspection
boundary. Workflow-only retry preserves unresolved issue-update state.

Regression coverage includes discovery polls through the registered dispatcher,
workflow-only retry with unresolved body writes, rejection of operator
decisions during a live PATCH, and issue-update marker persistence and
resolution through a disposable Gateway restart. These checks use fixtures
and synthetic metadata, not live GitHub writes.
