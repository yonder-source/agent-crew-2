# WBS4.5 native UI and configuration qualification

2026-11-20. Inspected the documentation shipped in the locally built
`agent-crew-openclaw:2026.11.3` image. This is documentation and repository
inspection, not an executed UI or Gateway configuration qualification.

## Available facilities

- `/app/docs/plugins/feature-plugins.md` documents native plugin pages and
  navigation through `host.ui.registerPage` and `host.ui.registerNavigation`.
  User-installed native UI is disabled by default and requires the Control UI
  custom-plugin lab setting. It needs the Gateway's Control UI origin and HTTPS
  or browser-trusted loopback for authenticated native assets. The UI executes
  as trusted code with the connected operator's Gateway authority.
- The same page documents typed feature operations. Queries require
  `operator.read`, actions require `operator.write`, and tools are registered
  only when explicitly declared. A custom Gateway method can instead specify
  its required scope, as the existing `agent-crew.resolve` method does.
- `/app/docs/plugins/sdk-runtime/state-and-system.md` documents a plugin-bound
  retained keyed store, `api.runtime.state.openKeyedStoreV2`, that survives
  restarts. It is a candidate for the pending draft, not the active connection
  configuration. Verify its actual behavior and authorization before relying
  on it.
- `/app/docs/gateway/configuration/config-rpc.md` documents `config.get` and
  revision-checked `config.patch`. A patch may apply a change or schedule a
  restart; it is therefore not a Save-draft operation. SDK configuration
  mutation helpers also document explicit post-write policies in
  `/app/docs/plugins/sdk-runtime/config-and-utilities.md`.

## Current checkout constraints

- `infra/local-dev/openclaw/compose.coding.yaml` bind-mounts the selected
  configuration file read-only. The normal image also places the default
  configuration inside the image. Neither arrangement is a qualified writable,
  durable operator configuration store.
- OpenClaw's bundled configuration documentation says managed writes replace
  the config path atomically. A writable directory or a supported state-volume
  layout must be qualified; changing a single-file mount to read-write alone is
  not sufficient evidence that atomic replacement works.
- `src/index.ts` parses `api.pluginConfig` during registration. The current
  dispatcher serializes admissions in process, while active and uncertain job
  records are in session metadata. Applying a new connection safely requires
  the same admission boundary plus a reliable inventory of relevant retained
  work; the existing config API does not by itself provide that guard.
- The current native feature UI build contract uses an `esbuild` development
  dependency, or permits a prebuilt self-contained browser bundle declared in
  the manifest. No extra package was installed during this qualification.

## Batch 1 implementation

The Agent Crew native page exposes the setup draft through `operator.admin`
Gateway methods. The retained plugin store contains only form fields, not an
active configuration or credential values. The page reads the current
repository and coding settings when no draft exists. Apply is deliberately
disabled until admission, active-job inventory, restart and durable-config
behavior are implemented together. GitHub repository listing and cloning
remain batch 2.

The SDK typecheck and targeted ESLint passed using the existing checks image. The
pinned `openclaw plugins validate` command rejected an asset outside a dedicated
`dist` subdirectory, so the runtime image now copies it under
`dist/control-ui/agent-crew`. The remaining validator error, `plugin entry does
not expose tool or feature authoring metadata`, also occurs in the unchanged
checks image. `openclaw config validate` accepted the changed default configuration.

A disposable, network-isolated Gateway using the pinned checks image advertised
the UI in `plugins.controlUi.list`. A synthetic draft was saved and read after a
real Gateway restart; low-scope reads and writes were rejected, and an extra
credential-shaped field was rejected. `scripts/check-setup-draft.mjs` captures
these checks. The full `scripts/check-all.sh` suite passed before the final UI
layout and stylesheet change; the updated assets, synthetic draft, authorization
and restart checks then passed separately in a new isolated Gateway. This does
not establish browser rendering, Apply or GitHub access.

`sessions.list` with `archived: "all"` exposed an archived synthetic Agent Crew
session, including its key and active-run status. This supports investigating the
Apply guard, but does not yet establish race-free enumeration or application.

## Batch 2 implementation status

2026-11-20. Implemented GitHub App installation and repository discovery with
bounded pagination, and added repository selection and clone actions to the
native page. The Controller reads the fixed
`/run/secrets/agent-crew-github-app-private-key`, signs a short-lived App JWT,
and requests installation tokens with Contents read permission. Clone tokens
are limited to the selected repository. Git receives credentials through a
short-lived Unix socket helper; the token is absent from the remote URL, Git
configuration, command arguments, process environment and UI response. Clone
targets are constrained to the configured repository root; an existing
checkout must have the matching credential-free HTTPS remote.

Before cloning, the Controller pauses discovery, invalidates queued admissions,
waits behind the serialized issue dispatcher, and inspects the complete session
inventory for active or uncertain Agent Crew jobs. A capped, paginated or
uninspectable inventory blocks the clone operation. The inventory relies on the
Gateway session activity fields and persisted plugin extensions; this guard has
not been exercised against the pinned Gateway build.

The local Compose GitHub overlay now mounts `.local/secrets/agent-crew.pem` as
the App private-key secret. The existing installation-token secret remains for
WBS3 issue operations. The UI keeps Apply disabled; repository discovery and
clone do not change the active Agent Crew configuration.

After installing the Node development declarations and the pinned OpenClaw peer
package locally, host lint and TypeScript checks pass. Fixes validate stdin
chunks and session-extension elements, retain a defined discovery instance in
service callbacks, and sanitize UI control characters without a restricted
regular expression. A file-specific lint exception permits only `execFile` in
the repository clone module; shell options and production import restrictions
remain enforced. This does not qualify sandbox execution or live GitHub access.

## Batch 2 qualification completed — 2026-11-20

Rebuilt `agent-crew-openclaw-checks:2026.11.3` from the current checkout and ran
the Compose checks service. Lint, lint configuration/coverage fixtures,
TypeScript, configuration, dispatcher/coding boundary, coding-result and WBS3
checks passed. The VM boundary harnesses now supply the newly imported GitHub
client. `scripts/check-repository-connection.mjs` adds scoped-token, paginated
and empty discovery, denied access, missing-key, matching/mismatched checkout,
non-Git path preservation and path/symlink escape fixtures. Setup admission
fixtures block active, unknown and paginated job inventories before cloning.

Using App ID `5577366` and the existing PEM through a read-only secret mount,
live discovery returned four accessible repositories. In a disposable container,
cloned the private `yonder-source/agent-crew` repository with a repository-scoped
Contents-read installation token. A second clone returned `already-present`.
An invalid token failed against that private repository, a repository outside
the installation list was rejected, and failed clone staging and credential
socket directories were removed. The resulting `.git/config` retained only the
credential-free remote and contained neither token nor credential-helper config.
An earlier invalid-token probe against the public `agent-crew-2` repository
succeeded anonymously; it was discarded as an authentication test and replaced
with the private-repository probe.

A separate native Gateway exercised the actual operator-admin repository-list
and clone RPCs against GitHub. They returned four repositories, `cloned`, then
`already-present`. Both methods rejected `operator.read`; draft Save/read
preserved the selected installation ID, including after an actual Gateway
restart. No push, issue write or PR was performed.

Chromium executed the actual `ui/setup.js` module with a controlled host fixture.
Repository options, automatic checkout path, installation ID on Save and clone,
success/error feedback and button recovery passed. This verifies browser DOM
behavior with fixture RPCs; live API acceptance was exercised separately through
the native Gateway. It does not establish a browser-to-GitHub end-to-end run.

Batch 2 repository discovery and cloning are accepted. Apply, WBS3 token renewal,
live write-permission reporting, sandbox task execution and later interaction
budgets remain subsequent batches. The persistent local Claw was not restarted
or removed during these checks; qualification used a separate Gateway.

## Persistent local deployment — 2026-11-20

Deployed the batch 2 runtime using the base Compose file plus
`infra/local-dev/openclaw/compose.setup.yaml`. The setup overlay mounts only the
App private-key secret, without requiring the legacy WBS3 installation-token
file. It retains the current configuration in `.local/gateway-config/openclaw.json`
through a writable directory mount at `/etc/agent-crew`, preserving atomic
configuration writes. This does not implement Agent Crew Apply.

Before deployment, the complete session inventory reported no active runs.
Saved the previous config under `.local/deployment-backups/batch2-20261120/`
and retained the old image as `agent-crew-openclaw:pre-batch2-20261120`.
The new config is JSON-equivalent to that backup; existing state, sandbox,
worktree, projection and repository host mounts are retained. The PEM mount
is read-only. The deployment does not activate a GitHub discovery connection
or choose a task repository.

After deployment, Gateway health passed, the native UI catalog advertised the
Agent Crew page, and `agents.list` retained `main`, `coding` and `designer`.
The deployed repository-list RPC returned all four live repositories for App
ID `5577366` using the mounted PEM.

The App ID row uses a remaining-space input plus a content-width repository-load
button. Its combined width is capped at the same 640px as the other fields;
border-box sizing prevents padding from extending inputs beyond their columns.
Chromium layout checks compare this row with the repository selector below and
check the button remains within its row.

The operator reported that Save and clone were manually tested successfully in
the persistent local Claw on 2026-11-20. This supplements the automated native
Gateway and fixture checks above; Apply and task-tool visibility are not covered
by that manual confirmation.

## Saved-connection validation — 2026-11-20

Added the operator-admin `agent-crew.setup.validate` method. It validates the
retained draft, verifies App/installation repository access, reports Contents,
Issues and Pull requests grants separately from untested write outcomes, checks
the checkout remote without cloning, and confirms configured coding/designer
agent IDs. An absent checkout is pending rather than a failed GitHub connection.
Validation never creates checkout directories or changes the active connection.
Save automatically invokes validation, with individual results in the right-hand
status area; operators can repeat it with Validate saved connection.

The pinned checks image passes all existing checks plus permission parsing and
read-only checkout regression cases. A separate Gateway with the real PEM and
a read-only host checkout mount accepted the real App grants, reported absent
checkout as pending, rejected a missing agent, rejected low-scope validation and
rejected validation without a saved draft. Chromium with fixture RPCs confirmed
Save triggers validation and renders its results. Apply, renewal and polling
lifecycle remain subsequent work; this change does not enable task admission.
Deployed the validation change to the persistent local Claw after confirming no
active runs. The served asset contains the validation control; the user's
existing saved draft passed repository read, granted permissions, checkout
remote, coding and designer agent checks. Actual write operations remain
explicitly unverified. Gateway health passed after deployment.

## Repository Apply and scheduling — 2026-11-20

Apply verifies the saved-draft hash, blocks immediately during dispatch, checks
retained active/uncertain tasks, validates the draft and prepares its checkout.
It uses a revision-checked native configuration write that preserves other
plugins, agent/model settings, redacted secret placeholders and polling interval.
The native configuration service restores secrets and owns atomic persistence.

Live qualification found a self-reload dependency with `config.patch`: Gateway
waits for Apply to finish before replacing the plugin, while Apply waits for
replacement acknowledgment. The final flow uses persistence-only `config.set`,
reports saved/pending activation, then lets native reload proceed after the RPC
returns. Old-instance scheduling stays blocked. If reload is disabled or remains
pending, Gateway must be restarted. Unacknowledged writes remain paused for
inspection and are never retried automatically.

App-mode startup checks checkout, repository access and retained tasks before
resuming scheduling. Transient reload failures retry at the polling interval;
Resume scheduling repeats the guards explicitly. UI status refreshes every five
seconds. Apply replaces the clone button. App-mode issue operations obtain a
fresh repository-scoped Issues-write token per operation; legacy token-file
configurations remain supported. Credential failure never retries a write.

Pinned checks pass Apply, in-flight dispatch rejection, active-task blocking,
stale-draft rejection, revision propagation, unrelated-config preservation,
unacknowledged-write pause and explicit resume fixtures. Credential fixtures
verify fresh Issues tokens request no Contents grant. A network-isolated native
Gateway verified admin scopes, native stale-revision rejection, reload and safe
paused scheduling with a missing checkout.

Live App credentials read zero ready issues from `yonder-source/n8n-nodes-qrcode`.
A disposable Gateway validated and cloned it, acknowledged the real Apply RPC
within five seconds, hot-reloaded the connection and automatically completed an
empty discovery at the next polling interval. Explicit resume also passed.
The plugin-replacement window briefly returned UNAVAILABLE for a status read;
subsequent reads recovered. No coding session or GitHub write was performed.
Chromium with fixture RPCs separately verified Save/validation/Apply gating and
feedback; these UI fixtures are not browser-to-GitHub acceptance.

Deployed to persistent local Claw after confirming zero active runs. Gateway
health and served Apply assets passed. The operator's saved draft is retained;
the active repository remains empty and scheduling stays paused until the
operator applies that draft. No real task connection was activated by deployment.


## Batch 3 implementation — 2026-11-20

The batch 2 supplement defines new-task branch collision handling, exact base
commit binding and batch 6 committed-deliverable contracts in SPEC and WBS4.5.

Pinned OpenClaw `2026.11.3` hardcodes `openclaw/${name}` in managed worktree
preparation (`service-preparation` runtime); sessions.create exposes a name and
base ref, but no branch override. The operator approved keeping the existing
`agent-crew-issue-<number>` name, producing
`openclaw/agent-crew-issue-<number>`. Do not rename branches behind native metadata.

Dispatch now prepares a clean source checkout on main using a short-lived
Contents-read token and the existing private credential socket. It rejects an
existing task branch, fetches remote main, rejects ahead/divergent local main and
fast-forwards only. It passes the exact fetched SHA as worktreeBaseRef. Before
starting coding it verifies the returned branch, actual worktree HEAD and common
Git directory, then retains baseCommit with job/session/issue/repository and
workspace binding. Public operator status includes baseCommit.

An operator-approved retry reuses the recorded base and worktree without fetch
or recreation, verifying branch ownership and base ancestry first. Legacy or
orphaned sessions without a retained base require inspection and cannot resume
by guessing their base; the existing coding fixture expectation reflects this.
The VM harness dependencies were updated for the new Git boundary.

Local lint and typecheck passed. Runtime checks, live authenticated fetch/task
execution and deployment of this batch have not been performed; this is an
implementation handoff, not live acceptance.


### Batch 3 local deployment and checks — 2026-11-20

Rebuilt and recreated the persistent Gateway with the base and setup Compose
files. Before restart, the full session inventory contained five sessions, all
reporting no active run. After restart the container was healthy, the saved draft
was retained, and the deployed compiled dispatcher contained the exact-base
worktree parameter. Polling remains stopped with `No active repository connection`;
no configuration was applied and no coding task was launched by deployment.

The compiled coding/dispatcher VM boundary checks passed. A temporary isolated
Git check (`/tmp/agent-crew-batch3-check.mjs`) exercised fast-forward to the exact
fetched SHA, actual worktree branch/common-directory/HEAD checks, branch collision,
resume with descendant commits, wrong initial HEAD/workspace rejection, dirty
source, local-ahead rejection and missing remote main. Its fetch command was
redirected to a disposable local bare remote; it does not establish GitHub
credential access or native session/model acceptance. The credential socket
required elevated execution because the filesystem sandbox forbids socket listen.

Live acceptance still requires applying a disposable repository connection and
labeling a small issue `ready for agent`, then inspecting the retained task's
baseCommit/workspaceBranch/workspacePath and actual Git checkout. Do not count
health or fixture checks as that acceptance.
