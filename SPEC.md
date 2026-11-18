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
