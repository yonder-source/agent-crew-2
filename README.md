# Agent Crew OpenClaw foundation

Current project requirements and decisions are maintained in the repository
[`SPEC.md`](SPEC.md). The restart handoff and WBS packages are under
[`docs/restart/`](docs/restart/README.md).

This checkout pins OpenClaw `2026.11.3` to
`ghcr.io/openclaw/openclaw@sha256:e73f689d663567f0fe3c5a85c54beb3e102dc21f0814bf375e9039ee2d2df51b`.
The image supplies Node.js `24.22.1`, npm `12.2.2`, OpenClaw/plugin SDK
`2026.11.3`, and TypeBox `1.3.35`. The Docker build installs locked development
tools with `npm ci --include=dev --legacy-peer-deps --ignore-scripts`: TypeScript `5.9.3`,
ESLint `10.15.0`, typescript-eslint `8.73.0`, `@eslint/js` `10.0.1` and
`globals` `17.14.0`. OpenClaw is supplied by the pinned image, so peer dependency
installation is skipped. The build restores SDK declarations from the matching
npm release (the runtime image omits them). Typechecking uses those declarations,
without local SDK stubs.
Build tools, restored declarations and plugin sources stay in the separate checks
image; the Gateway image receives compiled plugin output and runtime files only.

## Commands

Build and run lint, lint acceptance fixtures, type/config and boundary checks
without installing Node.js dependencies on the host:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml --profile check build
docker compose -f infra/local-dev/openclaw/compose.yaml --profile check run --rm checks
```

Run just lint in the checks image with
`docker compose -f infra/local-dev/openclaw/compose.yaml --profile check run --rm checks npm run lint`.
Typed lint needs the real OpenClaw SDK declarations supplied during Docker build.
The build also imports emitted `dist/config.mjs`; its source is an explicit
TypeScript input so the paired declaration cannot suppress JavaScript emit.
`eslint.config.mjs` uses ESLint recommended rules for JavaScript and
typescript-eslint recommended typed rules plus `no-unsafe-type-assertion` for
TypeScript, including declaration files. Only `dist/` and `node_modules/` are
excluded; scripts, workflows and archived JavaScript evidence are covered.

Start the disposable Gateway, query its health, and stop it:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml up -d --build gateway
docker compose -f infra/local-dev/openclaw/compose.yaml exec gateway openclaw gateway health --token disposable-agent-crew-token
docker compose -f infra/local-dev/openclaw/compose.yaml exec gateway node scripts/check-gateway.mjs
docker compose -f infra/local-dev/openclaw/compose.yaml down
```

The plugin lives inside each image at `/app/extensions/agent-crew`.
Rebuild after source changes. Builds do not write generated files into the host
checkout, so they also work with CI checkout ownership.

Run the complete local check, including plugin status and session metadata
surviving a Gateway restart, plus synthetic dispatcher interruption checks:

```sh
./scripts/check-all.sh
```

Gateway state is stored in the named Docker volume `agent-crew-2_openclaw-data`
(Compose prefixes the volume with its project name). Remove this disposable
state with `docker compose -f infra/local-dev/openclaw/compose.yaml down --volumes`.

## Disposable session check

`scripts/check-all.sh` uses its own temporary Compose project and volume, then
removes those resources when the checks finish. It starts the Gateway with a fixed test token and
`environment: disposable`, invokes `agent_crew_environment`, writes and reads
synthetic `agent-crew-job` metadata on session
`agent:main:agent-crew-wbs1`, restarts the Gateway, then reads the metadata
again. It uses no external credentials. The token is only for local disposable
use and must not be reused elsewhere.

Pull request CI runs the same Docker lint/type/config checks and the Gateway status
and restart-persistence integration check. Docker availability is required on
the runner.

## Synthetic WBS2 dispatcher

The image includes `@openclaw/lobster@2026.11.3`. Tools `agent_crew_dispatch`
and `agent_crew_status` accept
`repository` (owner/name) and a positive `issueNumber`. The Gateway plugin uses
`AGENT_CREW_GATEWAY_TOKEN` for authenticated loopback calls; local Compose
supplies its disposable operator token. The native issue session's
`agent-crew-job` extension holds admission and workflow status.

The operator Gateway method `agent-crew.resolve` accepts the same issue fields,
`decision` (`retry` or `abandon`) and a nonempty inspection `note`. It requires
`operator.admin` and only accepts `needs-inspection` work. Retry authorizes a
new dispatch; it does not automatically resume a possibly running workflow.

`./scripts/check-all.sh` also runs `scripts/check-dispatcher.mjs` (host Node.js
required). It counts actual synthetic Lobster executions, checks duplicate and
ordered admission, kills the Gateway during a paused workflow, and verifies
restart blocking and explicit operator decisions. Its fixed workflow only
writes a disposable execution log and returns a synthetic result; it performs
no coding, GitHub or Slack actions. It uses and removes its own Compose project
and volume and needs local port 18789 available.
