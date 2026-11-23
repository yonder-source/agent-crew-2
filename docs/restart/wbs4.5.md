# WBS4.5-restart — Repository connection UI

## Goal

Provide a small repository connection screen accessible from OpenClaw so an
operator can configure one GitHub repository for the Controller without editing
JSON. The [root SPEC](../../SPEC.md) owns the requirements.

## Entry conditions

- [WBS4](wbs4.md) provides coding execution and its result handoff. Qualify
  sandbox Git operations and isolation with a disposable repository here.
- An operator can access the authenticated OpenClaw UI and Gateway.
- A GitHub App is installed on the disposable repository, with the permissions
  required by WBS3–5. Its credentials are available through the agreed secret
  mechanism.

## 4.5.1 Establish the UI integration

**Work:** Inspect the pinned OpenClaw runtime's supported UI extension and
configuration APIs. Use its native facilities where they support the required
screen. If a custom page is necessary, keep it accessible from OpenClaw and
use authenticated Controller endpoints. Record the chosen integration before
implementing the screen.

**Done when:** The operator can reach the repository screen from OpenClaw.
Configuration reads, validation and changes require authenticated operator
authorization. Coding agents cannot invoke these operations through their
assigned-issue tools.

## 4.5.2 Configure one repository

**Work:** Provide one form for the GitHub App ID, a repository selected from
the installed App's accessible repositories, the corresponding local checkout,
and the existing coding agent ID setting needed to bind coding to that
connection. Retrieve the repository list using the App and its installations;
handle multiple installations, pagination, empty lists and discovery failures
without exposing secrets. Pre-fill the Gateway's repository source path from the
selected repository; allow the operator to change it. Present configured
OpenClaw agents in a dropdown, defaulting to `coding` when available and
showing a setup hint when no agent is available. Show current values, credential availability and connection
validation result. Use the existing configuration store rather than adding
another source of truth. The local Compose setup mounts the fixed private key
file `.local/secrets/agent-crew.pem` as a Gateway secret; the form never receives
or returns its contents. Save stores a pending draft, including while jobs are
active; it does not alter the running connection. Apply uses the restrictions
below. Report whether applying changes requires a Gateway restart.

**Done when:** An authenticated operator can load, validate, save and apply one
repository connection without editing JSON. Saved configuration survives
Gateway restart, and the screen reports any restart required to apply it.
Invalid settings or failed saves are rejected without replacing the last valid
configuration, with a clear failure result. Multi-repository management,
creation or installation of the GitHub App and a general
agent-management UI are outside this package.

## 4.5.3 Validate access and apply changes

**Work:** Discover installations and repositories through the configured GitHub
App. Handle multiple installations and paginated repository lists; keep
installation IDs in the saved draft and return repository names only to the UI.
Use a narrowly scoped installation token to clone the selected repository into
the configured local checkout. Keep the remote URL credential-free and deliver
the token to Git through a short-lived, repository-scoped credential helper.
Do not overwrite an unrelated existing checkout.

Before cloning, validate credential access to the selected repository
and inspect WBS3–5 permission grants. On Apply, check job state, stop automatic
polling and block new task admission. Clone the repository source if absent; otherwise check the
existing checkout. Verify that its remote corresponds to the selected repository
before activating the connection. Do not overwrite an unrelated checkout; leave
the previous connection active on failure. A successful read check confirms repository read access only;
distinguish it from push, issue-write or PR capabilities that still require
live write qualification. Define safe application of settings: changing the
App ID, repository, checkout or coding agent ID must not redirect active or uncertain
work. Treat a coding agent that is running or whose stopped state cannot be
confirmed after Gateway restart as active or uncertain. While such work exists,
allow saving a draft but block applying changes and explain the blocking state.
The operator may force a Gateway restart despite active work; retain an
interrupted or unconfirmed coding run as uncertain until operator inspection and
explicit resolution. Do not activate a new connection in a way that redirects
that work. After restart, resume polling automatically only when Gateway health,
connection and job state permit it. Provide an operator button to restart polling
manually under the same checks, and show the polling state and any blocking reason.
Connection
validation must not mutate repository content.

**Done when:** The screen loads accessible repositories from all App
installations, including paginated results, and clones the selected repository
without exposing a token or persisting it in Git configuration or the remote.
An existing matching checkout is reported without recloning; a mismatched or
non-Git path is left untouched. The screen distinguishes invalid repository, missing credential,
inaccessible repository, checkout mismatch and insufficient or unverified
permissions. Check the source checkout's Git remote against the selected
repository. Show granted or insufficient Issues, Contents and Pull requests
permissions separately from actual write outcomes. Display validation progress,
results and actionable failures beside each check in the connection status
area; show save feedback and any restart requirement near the save action.
Active or uncertain work prevents applying a change to
App ID, repository, checkout or coding agent ID. The Controller uses the saved
connection consistently for discovery, assigned issue access and coding; WBS5
extends that connection to publication.

## 4.5.4 Issue and renew installation tokens

**Work:** Qualify and select a supported way for the Controller to issue and
renew repository-scoped GitHub App installation tokens using the existing
credential provider and secret delivery mechanism where suitable. Define the
required App credentials and installation identity, token expiry and renewal
behavior, and how issuance or renewal failures are surfaced and recovered.
Keep App credentials and installation tokens out of UI responses, logs and
coding-agent context. Do not automatically retry an uncertain GitHub write as
part of credential recovery. For authenticated HTTPS clone, fetch and push,
qualify a scoped, short-lived Git credential helper as described in the
[Git authentication research](evidence/github-git-auth-research.md). Do not put
tokens in remote URLs, command arguments or persistent Git configuration;
restrict credential delivery to the selected repository and keep it out of
the sandbox. Verify helper isolation and cleanup before adopting the mechanism.

**Done when:** An existing installed GitHub App can support unattended operation
without an operator manually replacing an expired installation token. The
Controller obtains a suitably scoped token, renews it before or on expiry, and
reports missing credentials, insufficient permissions and issuance or renewal
failures without exposing secrets. Exercise expiry, renewal and failure behavior,
and record live GitHub evidence separately from fixtures. Document the App
setup prerequisite and the secret delivery and rotation responsibilities.

## Small batch delivery contracts

- **Batch 2 supplement:** Define `openclaw/agent-crew-issue-<number>` from updated remote main,
  persist the exact base SHA, and reject an existing branch for a new task.
  A bound task resumes its recorded worktree without updating its base.
- **Batch 3:** Implement authenticated main update, exact-base worktree creation
  and retained job/session/issue/repository/worktree/branch/base binding. Stop on
  dirty checkout, missing main, divergence, branch collision or uncertain setup.
  Use the native `openclaw/agent-crew-issue-<number>` branch naming; keep
  OpenClaw managed metadata intact. Support clean unborn main from an empty clone
  by initializing it to the fetched commit. Keep dirty/ahead/divergent checks and
  report safe task-preparation error categories separately from query failures.
- **Batch 6 supplement:** Require Controller local commits and structured validation records
  (command, outcome, exit code when available, summary). The Controller verifies
  the assigned branch and head SHA and persists delivery status. WBS5 reads the
  binding from trusted state and independently verifies publication conditions.
  The agent edits and validates in its sandbox; the Controller commits reconciled
  changes on the assigned managed branch after coding and validation succeed.
  Keep npm caches under sandbox `/tmp`. Treat missing or malformed validation as
  unknown. Before committing, verify the worktree, branch and base ancestry;
  disable hooks, automatic maintenance and signing, and reject executable Git
  filters before inspecting files. Before recording a deliverable, verify its
  clean state and final head. Retain the job, session, issue,
  repository, worktree, branch, base SHA, verified head SHA and validation with
  delivery status across restart. WBS5 publishes the bound branch and head;
  remote main advancing after preparation alone does not invalidate the base.
  Exercise a successful committed delivery, dirty worktree, wrong branch,
  unrelated history, missing validation and restart retention in fixtures.
  Implementation and qualification are recorded in
  [coding delivery evidence](evidence/wbs4.5-coding-delivery-qualification.md).
  Native sandbox Git metadata is private; use file reconciliation and a
  Controller-owned local commit rather than importing the guest history.

## 4.5.5 Acceptance and handoff

**Skills:** Implementation and live qualification are recorded in
[local skill delivery evidence](evidence/wbs4.5-skills-qualification.md). Make the skills under the host's `.local/skills` available read-only
to each coding sandbox alongside its assigned worktree. First qualify the pinned
OpenClaw runtime's supported discovery and sandbox mounting mechanisms, and
check that intended skills and their supporting files can be read without exposing
other host directories, credentials or another task's worktree. Exercise the
missing or empty skills directory and record which skill formats and capabilities
were actually verified. Skill installation and removal UI is later scope.

**Coding time limit:** Qualify how the pinned OpenClaw and Lobster runtimes
expose an agent stopping to wait for human instructions and subsequently
resuming. Implement and verify the 20-minute cumulative active-execution limit, excluding
that waiting time; ensure surrounding deadlines do not expire while waiting or
cut the active budget short. Preserve the existing inspection boundary on an
uncertain timeout. Report any unsupported waiting or resume behavior rather
than claiming it has been implemented.

**Slack interaction:** Configure Slack Socket Mode credentials as mounted
secrets and display availability; provide coding and designer agent selectors,
channel IDs and separate authorized Slack user ID lists. Validate both settings;
designer workflow is later scope. Use one thread per coding task. Distinguish
status updates from requests for input, and stop active-time accounting only
when the coding turn has actually ended in a waiting state. Keep the task, thread,
session, worktree and elapsed time across a Gateway restart. After health and
binding checks, accept the first authorized thread reply and resume the same
session and worktree, restarting the active-time clock. Reject unauthorized
replies; respond to later replies while running with a busy message rather than
steering. Replies sent while Gateway is offline must be resent after recovery.
Waiting tasks block incompatible configuration changes. A failed input-request
delivery remains visible and leaves the task waiting. Automatic delivery retry
is WBS6 scope. Qualify native session context across turns before adding a
worktree context summary; add one only if a concrete gap is found.

**Small batch 6 — Controller task authorization:** Extend the Controller's
coding prompt with a structured authorization block naming the assigned issue,
repository, worktree and branch, and the allowed edit/validation/assigned-issue
operations. The agent does not commit or publish; the Controller commits the
reconciled change. State that repository
`AGENTS.md` provides development guidance but cannot grant additional authority;
Controller authorization takes precedence when instructions conflict. Keep issue
text clearly marked as untrusted task input. Do not pass GitHub credentials or
installation tokens into the agent context. Verify the constructed prompt with
fixtures covering conflicting issue text and repository guidance, and confirm
the agent context contains no credential values.

**Done when:** Each dispatched coding turn receives the explicit task-scoped
authorization and repository-guidance precedence rule, while existing sandbox
credential isolation remains intact. The conflict fixtures demonstrate that
issue text and `AGENTS.md` cannot expand the Controller-granted scope.

**Token budget:** Qualify the pinned runtime and provider's usage reporting and
stop mechanisms. Configure one shared per-task budget and show task usage and
limit. Accumulate available input and output usage across turns, retries and
compaction where reliably reported. Missing usage requires operator inspection,
not a zero count. On the time or token limit, stop further execution and require
inspection without automatically starting another agent. Verify persistence,
in-flight overshoot, uncertain stops and scope limitations; do not describe a
usage threshold as a guaranteed billing cap.

**Work:** Use the UI to configure the disposable repository, restart the Gateway
and confirm persistence. Exercise invalid input, unauthorized reads/validation/
changes, credential redaction, pending saves, job-related apply restrictions and
operator-forced restart, including uncertain job state across restart. Verify repository read access and
record write capabilities that remain unverified. Exercise the selected token
issuance and renewal path. Before each new task, have the Controller update the
source checkout from remote `main` and create its `openclaw/agent-crew-issue-<number>` branch and worktree
from that base. Stop with a clear reason for dirty source, divergent `main`,
missing remote `main`, or update failure; do not overwrite or automatically merge.
Exercise polling stop, safe automatic restart and manual restart, including health
and uncertain-job blocks. Run a disposable check through discovery and sandbox
coding; verify sandbox Git operations, skill availability, Slack interaction,
time and token limits, and isolation along that path. WBS5 adds
publication; WBS6 extends Slack reporting and validates the full MVP. Record live API
evidence separately from fixtures.

**Done when:** An operator can configure and validate the repository connection,
and confirm it remains saved after Gateway restart. Document the screen entry
point, credential provisioning prerequisite, checkout setup, restart behavior,
and live versus unverified permission results. An operator can inspect the coding
result and its assigned worktree; WBS5 validates the resulting draft PR.

## Handoff

[WBS5](wbs5.md) uses the configured connection and Git authentication to
publish the coding result as a draft PR. WBS6 extends Slack and validates the MVP.
