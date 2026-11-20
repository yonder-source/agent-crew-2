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
Compose mounts the checkout read-only for `check:lint` to compare its source
inventory against files actually linted in the image, including `.github`
scripts. Rebuild the checks image after adding or removing source files.

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

Gateway state is stored under `.local/openclaw-gateway-state` on the Docker host
and remains ignored by Git. The local setup preserves the original named volume
as a rollback copy after migrating its contents into this bind-mounted directory.

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

The image includes `@openclaw/lobster@2026.11.3`. The read-only
`agent_crew_status` tool accepts a `repository` (owner/name) and positive
`issueNumber`. The operator-only `agent-crew.dispatch` Gateway method accepts
those fields for synthetic checks. The Gateway plugin uses
`AGENT_CREW_GATEWAY_TOKEN` for authenticated loopback calls; local Compose
supplies its disposable operator token. The native issue session's
`agent-crew-job` extension holds admission and workflow status.

The operator Gateway method `agent-crew.dispatch` accepts a repository and
issue number and requires `operator.admin`; agents cannot dispatch arbitrary
issues. `agent-crew.resolve` also requires `operator.admin` and a nonempty
inspection note. It resolves uncertain workflow starts with `retry` or
`abandon`, and uncertain issue body updates with target `issue-update` and
decision `confirm`, `retry` or `abandon`.

`./scripts/check-all.sh` also runs `scripts/check-dispatcher.mjs` (host Node.js
required). It counts actual synthetic Lobster executions, checks duplicate and
ordered admission, kills the Gateway during a paused workflow, and verifies
restart blocking and explicit operator decisions. Its fixed workflow only
writes a disposable execution log and returns a synthetic result; it performs
no coding, GitHub or Slack actions. It uses and removes its own Compose project
and volume and needs local port 18789 available.

## WBS3 GitHub issue access

Configure the plugin with `github.repository` and optional `github.pollIntervalMs`
to enable polling. The Gateway reads the pre-provisioned GitHub App installation
token from `/run/secrets/agent-crew-github-installation-token`; local Docker
users can mount it with `infra/local-dev/openclaw/compose.github.yaml` using a
file at `.local/secrets/github-app-installation-token`. The installation needs
Issues read/write permission. WBS3 checks use deterministic fixtures unless a
disposable GitHub repository and installation token are supplied; fixture
results are not live GitHub qualification.

## Local coding workflow

The default Compose config stays credential-free for synthetic checks. To run
the real coding workflow, copy
`infra/local-dev/openclaw/openclaw.coding.example.json` to
`.local/openclaw-coding.json`, then replace both `owner/repo` values with the
same GitHub repository. Clone that repository to
`.local/repositories/owner/repo`; the in-container path is
`/workspaces/repositories/owner/repo`. Put the pre-provisioned GitHub App
installation token at `.local/secrets/github-app-installation-token`.
The Gateway's normal OpenClaw auth store must also contain valid credentials for
the configured coding model; the example does not provision model credentials.

Build the sandbox image and start the coding configuration with:

```sh
docker build --target sandbox -t openclaw-sandbox:bookworm-slim .
docker compose -f infra/local-dev/openclaw/compose.yaml -f infra/local-dev/openclaw/compose.coding.yaml -f infra/local-dev/openclaw/compose.github.yaml up -d --build gateway
```

The `coding` overlay mounts the local config read-only; `compose.github.yaml`
mounts the token as a Gateway secret. Never put token values in the config
file. Stop and remove the disposable runtime with the same Compose files and
`down` when finished.
