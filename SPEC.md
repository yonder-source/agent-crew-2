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
- Start with a 20-minute active-execution limit for each coding task. Time spent
  stopped waiting for human instructions does not count toward that limit.
  Lobster call deadlines must allow this policy: a pause for human input ends the
  current call, and the next resume is a separate call. Qualify how the pinned
  runtime exposes waiting and resumption before implementing the timer.

## Repository connection UI

[WBS4.5](docs/restart/wbs4.5.md), between coding execution and draft PR
publication, delivers a required single-repository connection screen accessible
from OpenClaw at `/plugin?plugin=agent-crew&id=setup` under the connected
Gateway Control UI origin, with custom plugin UI enabled. An authenticated operator can configure the GitHub repository
and matching checkout without editing JSON, inspect credential availability,
validate access and save the connection using the existing configuration store.
Keep secret values out of UI responses. Configuration must survive restart;
report any restart needed to apply changes. Prevent connection changes from
redirecting active or uncertain work. The screen accepts a GitHub App ID and
lets the operator select one repository from the App's installed repositories,
then configure its matching checkout and the existing coding agent ID setting.
Pre-fill the repository source path and offer configured agents in a dropdown,
defaulting to `coding` when available. Show individual validation results and
failures alongside connection status, and save feedback near the save action.
Apply owns checkout creation; do not expose a separate clone action in the
operator form. A saved draft must pass validation before Apply is enabled.
Compare the source checkout's Git remote with the selected repository; distinguish
granted App permissions from confirmed write outcomes. Authenticated
operator authorization is required for reads, validation and changes; assigned
coding agents cannot invoke these operations. Save stores a pending draft without
changing the running configuration, including while work is active. Saving a draft automatically runs
read-only connection validation and displays individual results in the status
area; provide a control to repeat validation of the saved draft. Missing checkout
is reported as pending and does not cause validation to clone it. Apply checks
for active or uncertain work and blocks connection changes while it exists. After
the check, stop automatic polling and new admission while preparing the source
checkout and applying the configuration; preserve the last valid configuration on
failure. After restart, resume polling automatically only when the Gateway is
healthy and the connection and job state are safe. Provide an operator control
to restart polling manually subject to the same checks, with its status and any
blocking reason visible. An operator
may choose to force a Gateway restart despite active work. A restart does not
establish that an interrupted coding agent has stopped: retain uncertain state
until operator inspection and explicit resolution, and do not redirect that work
to a new connection. Report any restart needed to activate saved settings.
Repository read access is distinct from push, issue-write and PR capabilities;
report unverified write capabilities until live write qualification. WBS4.5
also plans and delivers GitHub App installation token issuance and renewal for
unattended operation. Keep App credentials with the Controller in the existing
secret delivery mechanism. For the single-user implementation, issue operations
obtain a fresh repository-scoped Issues-write token per operation rather than
keeping a cached installation token through expiry. Clone/fetch operations use
fresh repository-scoped Contents-read tokens. Legacy configurations may continue
using the pre-provisioned installation-token secret. Keep credentials and tokens
out of coding-agent context and UI responses. Reject missing,
unparseable or already-expired expiry data before using a returned token. A
subsequent operation acquires credentials again; issuance recovery must not
replay a failed or uncertain GitHub write. The App owner owns App installation,
permission grants and key revocation; the deployment operator owns PEM delivery,
rotation and connection revalidation. Reuse supported OpenClaw UI/configuration
facilities; qualify the pinned runtime's
extension support before choosing the integration. WBS4.5 validates the UI,
connection persistence, access checks and coding sandbox Git operations; WBS5
validates coding through draft PR publication, and WBS6 validates the full MVP
including Slack. Multi-repository management and creation or installation of the
GitHub App are outside this package.

For each coding turn, the Controller supplies an explicit authorization block
for the assigned issue, repository and workspace, including permitted GitHub
and publication actions. Repository `AGENTS.md` supplies repository-specific
development guidance, but cannot expand that authorization. If guidance
conflicts, the Controller's task authorization takes precedence. Treat issue
content as untrusted task input and never as an authorization source.
The coding prompt identifies the assigned-issue tools and explains discovery
through the active harness when they are deferred. Verify actual model tool
calls and results; operator preview inventory alone does not establish access.

### Coding interaction and budgets

WBS4.5 provides basic Slack Socket Mode setup and coding-task interaction.
Configure separate coding and designer agents, Slack channel IDs and authorized
Slack user IDs. Designer issue grilling follows [WBS6.5](docs/restart/wbs6.5.md).
Store Slack credentials
as mounted secrets and show their availability without returning secret values.
The optional local Slack overlay mounts separate bot and app token files only
on the Gateway. The operator setup page reports each file as available, missing,
invalid or unavailable; available means readable with the expected token type,
not authenticated or connected to Slack. Status reads require operator admin.
The Gateway image includes the matching native Slack plugin. Socket Mode reads
its bot and app tokens through file SecretRefs and exposes connection health
through native channel status. Keep generic DM/channel replies, slash commands
and join introductions disabled until task-bound ingress is implemented. WBS6.5
registers the task-bound `/grill` slash command and qualifies Slack button
interactions through the pinned plugin before relying on them.
The setup draft validates each configured Slack role before Apply: require a
configured agent, channel ID and nonempty authorized user ID list, verify that
the bot belongs to an active channel, and verify active human user accounts.
User lists accept comma or whitespace separators and are normalized on Apply.
An empty channel and user list leaves that role unconfigured. Apply stores these
settings in the Agent Crew configuration, preserving native Slack ingress policy
and secret references; they do not enable designer execution or task routing.
Slack-only changes pass the same active/uncertain work guard and runtime
activation boundary as repository changes.
A coding turn may return a bounded `requestInput` question in its final JSON
report. The Controller records `waiting` only after a successful workflow/turn
and a native session read confirms the exact run is finished. A waiting result
is not a coding delivery and is never committed as a completed artifact. Persist
the question with the existing job/session/worktree/base binding, expose it in
status, reject assigned-issue operations while waiting, and block duplicate
admission and configuration Apply. Unknown or mismatched stopped-state evidence
requires inspection. Operator-admin `agent-crew.resume` accepts bounded input
and the expected waiting run ID. It rechecks the retained physical session,
repository/agent/worktree binding and stopped state, keeps the job ID, and starts
a separate turn. Concurrent replies receive busy; stale replies cannot answer
a later question. Resume does not reopen automatic issue admission after restart.

For tracked tasks, persist cumulative `activeMs` measured with a monotonic clock
around each coding workflow call. This conservatively includes CLI/orchestration
overhead, excludes human waiting between calls, and supplies only whole remaining
seconds from the shared 20-minute limit to subsequent turns. Reaching the limit
blocks delivery and requires inspection. Persist an uncertainty marker before
execution so interrupted or unacknowledged calls cannot resume or retry with
unknown elapsed time. Native execution deadlines must cancel request-owned
sandbox processes through the host cancellation path; a terminal timeout receipt
alone does not establish that descendant processes stopped. Legacy waiting
records without elapsed time or physical session identity cannot resume by assuming zero. With coding Slack settings,
the Controller creates and retains one task root message before coding starts,
including its channel, agent and authorized user IDs. Resume reuses that thread
and rejects changed Slack settings. A confirmed waiting question is sent as a
plain-text reply in the retained thread; its run ID and delivery state are
persisted. Root creation and input-request sends record an intent before the
write. Failed or unacknowledged root creation blocks coding for inspection;
failed input delivery leaves the task waiting. Lost metadata acknowledgements
retain the sending marker and never trigger automatic replay. A native `before_dispatch` claim handler routes authenticated Slack thread
replies through the Controller resume seam. It derives user, account, channel,
thread and message identity from host context, matches exactly one retained task,
and rechecks authorization when dispatch is serialized. Only a successfully sent
question can accept a newer reply. Persist the accepted message timestamp with
the starting state before execution; repeated events cannot resume again. The
handler returns after durable admission, keeping later replies out of the native
ordinary model queue. Other Slack input is claimed without executing an agent
when coding Slack settings are present. Replies predating the current native
Slack connection must be resent. This ingress path passed a real authorized-human Slack reply and same-task
resumption qualification, including validated committed delivery and replay
protection. Native admission is enabled only for the configured coding channel
and authorized user allowlist. Provider
The Controller accumulates reported per-turn totals in taskTokenUsage and
checks an optional coding.tokenBudget between turns. The setup draft accepts
a positive integer or an empty value to leave the limit unconfigured. Snapshot
the limit per task, expose it with usage in status, and reject changed limits
on resume/retry. With a limit configured, unknown or exhausted usage requires
inspection before another turn or a committed delivery. Persist unknown before
execution so interrupted accounting cannot restart from zero. Legacy records
without cumulative usage remain unknown. This turn-boundary guard does not
interrupt an in-flight model request. A real one-token-limit test retained
13146 reported tokens in inspection without a commit. Qualification found that
native abort conflated cancelled workspace artifact
finalization with process cleanup. A pinned, source-hash-guarded runtime patch
now keeps successful sandbox termination confirmation separate from artifact
errors; genuine cleanup failures remain uncertain and retirement remains strict.
A second guarded patch makes missing or tokenless attempt reports invalidate
the shared usage aggregate, and later successful attempts cannot clear unknown
usage. Adapter-default zeros without an available usage report remain unknown;
only explicitly measured zero is accepted. Native regressions exercise reported
retry/compaction contributions,
missing attempts, real child termination and artifact-finalization failures.
Live qualification is recorded in the token evidence. The
Controller now retains the latest turn's native CLI usage as codingUsage with
reported/unknown status and exposes only token counts. Agent-authored reports
cannot supply usage; missing, malformed or unavailable data remains unknown.
This observational field is not a cumulative budget or completeness guarantee. A read-only qualification confirmed
that session-row totalTokens measures context rather than cumulative task usage;
sessions.usage exposes a distinct aggregate. Provider-internal unreported work
is not observable and these counters remain
runtime-reported rather than a billing cap; see
[token accounting evidence](docs/restart/evidence/wbs4.5-coding-token-qualification.md).
Each coding task uses a bound thread. Status updates and requests for human input
are distinct operations: only a confirmed transition to waiting stops the task's
active-time clock. Accept the first authorized reply in the bound thread and
resume the same session and worktree; additional replies while running receive a
busy response, not steering. Persist the binding, waiting state and elapsed
active time across Gateway restart; check that the connection, agent and channel
remain compatible before resuming. Replies while the Gateway is offline must be
resent after it is healthy. A waiting task blocks incompatible configuration
changes. Failed delivery is visible and leaves the task waiting; WBS6 adds up to
three retries after the first attempt, accepting possible duplicates when delivery
is uncertain. WBS6 posts Controller-derived progress in the retained coding
thread when coding starts, implementation completes and validation starts,
validation completes, the task waits for human input, and the task completes or
requires operator inspection. These are event-based updates; WBS6 adds no
periodic progress timer. Apply the same bounded retry policy to progress updates;
delivery retries never rerun coding or publication. The integrated workflow
covers normal transitions; fixtures cover waiting and operator inspection.

### Designer issue grilling

An authorized human can invoke `/grill <issue-number>` in the configured
Designer Slack channel to start an independent grilling thread for that issue.
The Controller derives Slack identity from authenticated host context and binds
each thread to the configured repository and selected issue, separately from
coding jobs and worktrees. `/grill search <query>` searches only the configured
repository using GitHub issue search syntax, excludes pull requests, defaults
to open issues, allows an explicit closed-issue qualifier, and shows up to 10
matches ephemerally with number, title, labels and link. Search results offer a
`Grill this issue` button; search alone does not start a conversation. Qualify
the pinned Slack plugin's ability to send and receive interactive button events.

Designer receives bound issue content and repository development guidance as
untrusted task material. It can grill and propose a complete replacement issue
body, but cannot alter the title, repository, labels, coding state or
publication. The authorized human can continue discussion or approve the exact
proposed body with `Confirm and write back`. Before writing, the Controller
checks whether the issue body changed since the thread started; if so, it
returns the current body for review without overwriting it. Otherwise it updates
only the bound issue body, reads it back and verifies it before reporting
success. Failed or uncertain writes do not claim success and follow the existing
inspection boundary. The human separately applies `ready for agent`; each
explicit command or selected result starts a separate thread. Issue-wide
discovery, polling, deduplication, automatic label application and coding
dispatch remain outside Designer intake.

Apply a shared configurable per-task token budget, accumulating usage across
coding turns, resumption, model retries and compaction to the extent reliably
reported by the pinned runtime and provider. Expose the budget and task usage.
Unknown usage must not count as zero: pause for operator inspection. At the
20-minute active-time or token limit, stop further execution and require operator
inspection; do not automatically continue with a new agent. If a run is
interrupted and its stopped state or elapsed usage is uncertain, retain the
inspection boundary. Qualify the runtime's usage and stop behavior, including
potential overshoot during an in-flight model request; this is not a billing cap.

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

<a id="error-timeout"></a>Each coding task starts with a 20-minute active-execution
limit; waiting for human instructions is excluded ([WBS4.2](docs/restart/wbs4.md#42-start-the-coding-agent)).
Lobster call deadlines must not cut that active budget short. A timeout may
leave an uncertain outcome. Verify inspection behavior before unattended
production use. Automatic retry policy for confirmed failures is not yet
defined; automatic recovery and reconciliation are later decisions.

## Deployment and credentials

The pinned OpenClaw runtime needs a guarded compatibility patch so model-runtime
publication supersession during agent startup uses its existing bounded startup
retry. Preserve database admission checks and propagate other failures; do not
reset agent data to recover from this runtime race. Review the patch when the
upstream bundle changes.

Use a Docker Compose secret sourced from `.local/secrets/agent-crew.pem` for the
GitHub App private key in local personal use, mounted at a fixed Gateway secret
path. Restrict host file access and keep it out of Git and the Docker build
context. In production, use the cloud provider's secret manager; secrets
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
as Lobster workflow arguments to the pinned `openclaw agent` CLI through
quoted workflow environment variables, and re-read the issue before
starting to ensure it remains open and labeled `ready for agent`.

Before each new task, the Controller updates the source checkout from remote
`main` and creates `openclaw/agent-crew-issue-<number>` and its worktree
from the exact updated base commit. Record that base SHA in the Controller-owned task binding. An
existing branch blocks a new task and requires inspection; resuming an already
bound task reuses its recorded branch and base without pulling or recreating it.
Stop and report the reason if the checkout is dirty, local and remote `main`
have diverged, remote `main` is missing, or the update fails; never overwrite
local changes or automatically merge divergent histories. A clean source checkout
with symbolic HEAD on main but no local main ref (an empty clone) may initialize
main from the fetched commit. Other Git failures must not be treated as unborn.
Distinguish safe task-preparation failures from GitHub query failures in polling
status; report dirty source, branch collision, unavailable remote main and local
ahead/divergent main without exposing raw Git output or credentials.
Bind the job, session, issue, repository, worktree, branch and base commit in
retained Controller state. Small batch 6 requires local committed deliverables,
structured validation evidence and a Controller-verified head SHA. WBS5 obtains
these values from that state and independently checks publication eligibility;
agent-supplied validation is evidence, not publication authorization.
The coding agent edits and validates in its assigned sandbox and reports
validation as structured records with command, outcome, exit code when available,
and summary. Missing or malformed validation is unknown, not successful. Keep
npm caches under sandbox `/tmp`, outside project contents; an untracked project
`.npm/` blocks Controller commit rather than being included in delivery. After successful
coding and validation, the Controller checks the assigned managed worktree and
branch/base binding, commits reconciled changes locally using a Conventional
Commit, and verifies the resulting head and clean state before retaining the
delivery. Disable Git hooks, automatic maintenance and signing for that commit;
reject configured executable clean/process filters before file inspection or
staging. A failed or uncertain commit requires inspection before another coding
attempt. The retained starting job blocks automatic restart/retry if the process
stops before recording the commit result. WBS5 publishes that
bound branch and head without recreating the branch; remote main advancing after
task preparation alone does not invalidate the recorded base.
The retained `codingDelivery` contains validation and either `ready` with the
Controller-read `headCommit`, or `needs-inspection` with a coding, validation or
worktree inspection reason. A successful model turn alone cannot complete a
coding task. WBS5 rechecks this delivery before any publication.
Pinned runtime sandbox Git metadata is private: accepted file changes reconcile
to the managed worktree, while guest commits do not advance its HEAD. Agents do
not commit; the Controller commits the accepted changes without importing guest
Git metadata. It neither trusts guest-reported SHAs nor runs task validation on
the credential-bearing Gateway.

Qualify this behavior together with Git operations and isolation inside the
coding sandbox through the WBS4.5 integration check.

WBS5 publication is a planned Controller-only operation invoked by the trusted
Lobster workflow. It consumes the retained `ready` coding delivery, requires
coding and validation status `ok`, and independently verifies repository/worktree
binding, clean state, exact branch/head and recorded base ancestry. It does not
accept caller-supplied authorization, expose a coding-agent publication tool,
create another commit or rename the native managed branch. An incompatible
remote task branch blocks publication; never force-push. Remote `main` advancing
alone does not invalidate the recorded task base. Create a missing remote task
ref atomically with an empty-expectation lease that requires it to remain
absent; this cannot update an existing ref, and a competing creation cannot be
fast-forwarded. Push to an explicit URL derived from the configured repository
rather than an arbitrary `remote.origin.pushurl`. Run network publication Git
operations from a temporary isolated repository that references the verified
worktree's objects, so local `url.*.pushInsteadOf` and other checkout URL
rewrites cannot redirect the write.
The Controller retains the delivery only after the coding workflow has returned
and the native run is confirmed stopped. A separate trusted Lobster publication
workflow then invokes publication. Retain the native coding session ID and
require it to match both the current Gateway session and the publication
invocation's session authority; a recreated session with the same key cannot
reuse the delivery.

Persist push and PR creation as separate operations with unique identities,
pre-write intent and confirmed/failed/inspection outcomes. Unacknowledged writes
and unfinished intent markers require operator inspection across restart, not
automatic replay. A definitively rejected operation with no remote effect can be
failed; ambiguous responses and conflicts must not be assumed side-effect-free.
PR creation obtains a fresh repository-scoped pull-requests-write token; the
Controller reuses an exact retained open draft rather than issuing another
create request.
PR creation uses base `main`, the assigned issue title, bounded coding/validation
summaries and `Fixes #<issue-number>`. Reuse an existing open draft only when its
repository, issue association, head branch/SHA and base match the delivery.
Closed, merged, non-draft, mismatched or ambiguously identified PRs require
inspection rather than automatic replacement or duplicate creation.
Lookup the task head across all bases so an existing mismatched-base PR cannot
look absent. Compare repository canonical identity case-insensitively. A 422
response that indicates an existing/conflicting PR is uncertain and requires
inspection; only a definitive rejected operation becomes failed.
Unknown 422 formats remain uncertain. A 422 is definitive only for an explicit
missing/invalid-field validation structure; opaque/conflicting formats cannot
be assumed to prove no write or no existing PR.

Public publication status is `published`, `needs-inspection`, `failed` or
`abandoned`; only `published` may expose a confirmed PR URL. Preserve coding
delivery separately from publication. The shared public result contains only
repository, issue, status, task branch/head, validation outcome, a bounded
inspection reason and a confirmed open-draft PR identity/URL when published.
Exclude operation IDs, hashes, full PR body, workspace/session identity,
continuation references and credentials. Revalidate a retained confirmed PR
read-only on later publication reporting; stale or ambiguous remote identity
becomes inspection and cannot trigger replacement creation. WBS6 consumes this
result for Slack reporting: delivery failure
or delivery-only retry must not rerun coding, push or PR creation. Implementation
and live publication acceptance belong to [WBS5](docs/restart/wbs5.md).
Fixture and disposable live publication evidence is recorded in
[WBS5 publication qualification](docs/restart/evidence/wbs5-publication-qualification.md).
That acceptance remains separate from the deferred full 20-minute WBS4.5
operator timeout check.

Configure the OpenClaw Docker sandbox for non-main coding sessions with
writable worktrees, a read-only container root, dropped capabilities and no
network egress. Run Lobster from the unsandboxed main controller session and
target the separate assigned coding session explicitly. The coding sandbox
receives only its assigned managed worktree; it does not receive Gateway secrets
or the Docker socket. The Gateway itself needs the host
Docker socket to create sibling sandbox containers. Keep OpenClaw state in a
host bind mount, and create temporary inference workspaces under its `tmp`
directory so sibling sandboxes can mount them. Bind its `worktrees`,
`worktree-projections`, and `sandbox` subdirectories plus the repository source
to host directories so native sibling containers can mount their workspace and
skills. Preserve existing state when migrating from the named volume. Build the
pinned `sandbox` Dockerfile target as `openclaw-sandbox:bookworm-slim` before
starting coding turns. The Gateway image includes a Docker CLI and joins the
host Docker socket group.

WBS4.5 makes skills in the host's `.local/skills` available read-only to each
coding sandbox alongside its assigned worktree. The local setup mounts this
directory read-only at `/opt/agent-crew-skills` and registers it through native
`skills.load.extraDirs`; use native sandbox skill materialization and protected
read-only mounts rather than copying skills into task Git history. Qualify the pinned runtime's
skill discovery and sandbox access, including compatibility of the intended
skills and any required supporting files. Do not expose other host directories
or credentials through this mount. Installing or removing skills through a UI
is a later decision.

Coding run timeout or malformed/uncertain result remains `needs-inspection` and
blocks automatic retry. An explicit operator-approved retry may be dispatched
while polling is paused after restart, only after confirming the retained task
has no active run and revalidating its repository/worktree/base binding. Apply
and uncertain configuration activation still block retry admission.
A GitHub-enabled plugin configuration requires one configured local
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
Installed dependencies, compiled output and local state are ignored. Application code,
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
