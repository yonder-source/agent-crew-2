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
