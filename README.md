# Agent Crew OpenClaw foundation

Current project requirements and decisions are maintained in the repository
[`SPEC.md`](SPEC.md). The restart handoff and WBS packages are under
[`docs/restart/`](docs/restart/README.md).

This checkout pins OpenClaw `2026.11.3` to
`ghcr.io/openclaw/openclaw@sha256:e73f689d663567f0fe3c5a85c54beb3e102dc21f0814bf375e9039ee2d2df51b`.
The image supplies Node.js `24.22.1`, npm `12.2.2`, OpenClaw/plugin SDK
`2026.11.3`, and TypeBox `1.3.35`. The Docker build adds TypeScript `5.9.3`
and restores the SDK declaration files from the matching npm release (the runtime
image omits them). Typechecking uses those declarations, without local SDK stubs.
Build tools, restored declarations and plugin sources stay in the separate checks
image; the Gateway image receives compiled plugin output and runtime files only.

## Commands

Build and typecheck without installing Node.js dependencies on the host:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml --profile check build
docker compose -f infra/local-dev/openclaw/compose.yaml --profile check run --rm checks
```

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
surviving a Gateway restart:

```sh
./scripts/check-all.sh
```

Gateway state is stored in the named Docker volume `agent-crew-2_openclaw-data`
(Compose prefixes the volume with the checkout directory name). Remove this
disposable state with `docker compose down --volumes`.

## Disposable session check

`scripts/check-all.sh` uses its own temporary Compose project and volume, then
removes those resources when the checks finish. It starts the Gateway with a fixed test token and
`environment: disposable`, invokes `agent_crew_status`, writes and reads
synthetic `agent-crew-job` metadata on session
`agent:main:agent-crew-wbs1`, restarts the Gateway, then reads the metadata
again. It uses no external credentials. The token is only for local disposable
use and must not be reused elsewhere.

Pull request CI runs the same Docker type/config checks and the Gateway status
and restart-persistence integration check. Docker availability is required on
the runner.
