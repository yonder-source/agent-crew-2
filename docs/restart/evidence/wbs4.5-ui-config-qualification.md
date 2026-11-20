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

## Initial implementation

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
