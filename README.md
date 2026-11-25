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
The build applies a source-hash-guarded startup patch for this pinned runtime:
model publication supersession enters the existing bounded agent-startup retry
instead of leaving a healthy agent database unavailable. See the
[diagnosis and native verification](docs/restart/evidence/gateway-startup-publication-race.md).
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

Configure `github.repository`, `github.appId`, `github.installationId` and
optional `github.pollIntervalMs`, or use the repository setup page. In App mode,
the Controller reads the private key from
`/run/secrets/agent-crew-github-app-private-key` and obtains a fresh token for each
operation: repository-scoped Contents read for clone/fetch and Issues write for
issue operations. It does not cache installation tokens or require their manual
replacement. Invalid or expired token responses are rejected before use. The
installation needs Issues read/write permission. Fixtures are separate from
live GitHub qualification.

Configurations without an App ID retain the legacy pre-provisioned installation
token at `/run/secrets/agent-crew-github-installation-token`. Local Docker users
can mount `.local/secrets/github-app-installation-token` with
`infra/local-dev/openclaw/compose.github.yaml`; that overlay also mounts the App
private key. Legacy tokens require manual replacement on expiry. The key and
tokens never enter the UI or coding sandbox.

For unattended App-mode setup, use
`infra/local-dev/openclaw/compose.setup.yaml`. It needs only
`.local/secrets/agent-crew.pem`, and mounts the writable configuration
directory `.local/gateway-config` at `/etc/agent-crew`. Initialize
`.local/gateway-config/openclaw.json` from the existing Gateway configuration
to preserve agent and model settings (or from root `openclaw.json` on a fresh
installation). Then build and start with:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml -f infra/local-dev/openclaw/compose.setup.yaml up -d --build gateway
```

Save retains and validates a pending draft. Apply checks active/uncertain work,
pauses admission and scheduling, prepares the checkout, then saves the
revision-checked native configuration while preserving other settings. Saving
and runtime activation are reported separately; the native reloader activates
the connection after the Apply request finishes. Runtime activation resumes scheduling only after connection and task-state
checks. Resume scheduling repeats those checks manually. An unacknowledged
configuration write requires inspection before retrying or resuming.
Native UI assets are snapshotted at Gateway startup and served under an
immutable revision URL. After updating UI files, restart the Gateway to publish
the new revision; copying files into a running container is insufficient.

### GitHub App credentials and rotation

The App owner installs the App on the intended repository and grants the needed
permissions; the deployment operator provisions the PEM at the fixed host path.
GitHub installation tokens expire after one hour. Each new operation obtains a
new token rather than extending an old one. Credential acquisition failures stop
that operation; recovery never automatically replays an issue write with an
uncertain outcome. See [GitHub's installation token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

To rotate the PEM:

1. The App owner generates an additional private key in GitHub, keeping the old
   key active until the new one is validated.
2. The operator confirms no coding run is active, resolves uncertain tasks and
   stops the Gateway before replacing `.local/secrets/agent-crew.pem`. Preserve
   permissions that allow the Gateway user to read it and keep it out of Git.
3. Recreate the Gateway with the same Compose files (`up -d --force-recreate
   gateway`). Recreating refreshes the single-file secret bind after an atomic
   host-file replacement; a process restart alone is not sufficient for that case.
4. Validate the saved connection using the UI, confirm discovery/read access and
   scheduling status, then have the App owner revoke the old key in GitHub.

Missing keys, rejected App authentication, unavailable installations or missing
permissions require correcting the credential/setup before validation and
resuming scheduling. Inspect and explicitly resolve any uncertain write before
retrying it. The Controller reads the current PEM when creating each App JWT;
it does not keep the private key or installation token in a retained store.
See [GitHub's private-key rotation documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

## Slack credential readiness

Provision the Slack bot token in `.local/secrets/slack-bot-token` and the
Socket Mode app token in `.local/secrets/slack-app-token`. Keep them out of Git
and readable by the Gateway user. Add
`-f infra/local-dev/openclaw/compose.slack.yaml` to the existing Compose command
when recreating the Gateway to mount both files read-only as Docker secrets.
Only the Gateway receives these mounts.

The setup page's **Slack credentials** area checks readability and expected
token type, with a button to repeat the check. Values and raw filesystem errors
are never returned. `Available` means file readiness, not successful Slack
authentication. The native transport setup below separately enables the
Socket Mode connection. The WBS6 operator handoff below describes applying
channel/user routing and using task-bound interaction. The optional overlay
requires both files to exist.

### Native Slack Socket Mode connection

The Gateway image includes `@openclaw/slack@2026.11.3`. To enable its transport,
append `slack` to the existing `plugins.allow` and
`/opt/agent-crew-slack/node_modules/@openclaw/slack` to `plugins.load.paths`,
preserving the other entries. The
[`slack.socket.patch.example.json`](infra/local-dev/openclaw/slack.socket.patch.example.json)
fragment supplies plugin enablement, file SecretRefs and Socket Mode settings.
Merge it into the existing configuration and validate with the pinned runtime
before applying; use the Slack Compose overlay when recreating the Gateway.

The fragment disables generic DM/channel handling, slash commands and join
introductions. Native `channels.status` reports the account's `running`,
`connected` and probe result; file availability alone does not establish
connection. See [native connection evidence](docs/restart/evidence/wbs4.5-slack-socket-qualification.md).

## WBS6 operator handoff

The live MVP qualification used OpenClaw and Slack plugin `2026.11.3`, Node.js
`v24.22.1`, coding model `gpt-6-luna`, and runtime image
`sha256:c03278f73c3e9e78efd0977f42b0f71edcff2bfe64cdae6015da10d05cf919ed`.
See the [recorded qualification](docs/restart/evidence/wbs6-mvp-qualification.md)
for the disposable issue, coding result, draft PR and Slack thread.

For the integrated workflow, provision the GitHub App PEM and Slack bot/app
tokens at the host paths described above, then start the Gateway with all three
overlays:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml \
  -f infra/local-dev/openclaw/compose.setup.yaml \
  -f infra/local-dev/openclaw/compose.slack.yaml up -d --build gateway
```

Open the OpenClaw Control UI and select **Agent Crew** in its navigation. Load
repositories with the GitHub App ID, choose the repository, checkout path,
coding/designer agents, Slack channel IDs and authorized user IDs, and polling
interval. Save, validate the saved connection, then Apply. Check connection and
scheduling status on the page; it also has **Resume scheduling** for a
connection that passed its readiness checks but remains paused. Apply and resume
recheck repository access, Slack channel membership/archive state, authorized
user activity and transport readiness. A failed check keeps scheduling paused.

When a labeled issue is discovered, inspect its issue and Slack task thread.
Read the retained Controller job and confirmed publication result with the
status tool from the Gateway container, replacing the repository and issue
number:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml \
  -f infra/local-dev/openclaw/compose.setup.yaml \
  -f infra/local-dev/openclaw/compose.slack.yaml exec gateway \
  openclaw gateway call tools.invoke \
  --params '{"name":"agent_crew_status","args":{"repository":"owner/repo","issueNumber":1},"sessionKey":"agent:main:main"}' \
  --json
```

The result reports workflow status and includes a draft PR URL only when
publication is confirmed. Match the issue and URL against GitHub before treating
publication as complete. Inspect the task's Slack thread for progress and final
reporting. Slack delivery state is separate from coding/publication; after
checking the thread and retained job, an operator may retry one specific
delivery with `agent-crew.slack.delivery.retry` and its retained `operationId`.
For example, replace the repository, issue and operation ID below:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml \
  -f infra/local-dev/openclaw/compose.setup.yaml \
  -f infra/local-dev/openclaw/compose.slack.yaml exec gateway \
  openclaw gateway call agent-crew.slack.delivery.retry \
  --params '{"repository":"owner/repo","issueNumber":1,"operationId":"00000000-0000-4000-8000-000000000000"}' \
  --json
```

Retries are bounded and do not rerun coding or publication.

If a task reports `needs-inspection`, inspect the GitHub issue, branch, head and
pull requests, then inspect the Slack thread for the actual delivery. Do not
blindly retry an uncertain push or PR creation. Record the evidence in a
nonempty note and use operator-only `agent-crew.resolve` with the matching
target (`workflow`, `publication-push`, `publication-pr` or `issue-update`).
Workflow and publication targets allow `retry` or `abandon`; `issue-update`
also allows `confirm`. For example, after checking the issue, branch and head
and searching GitHub for an existing PR, record that evidence and approve
recovery of the retained PR operation:

```sh
docker compose -f infra/local-dev/openclaw/compose.yaml \
  -f infra/local-dev/openclaw/compose.setup.yaml \
  -f infra/local-dev/openclaw/compose.slack.yaml exec gateway \
  openclaw gateway call agent-crew.resolve \
  --params '{"repository":"owner/repo","issueNumber":1,"target":"publication-pr","decision":"retry","note":"Checked GitHub issue, branch and head; no matching PR exists."}' \
  --json
```

A retry approves recovery of the retained operation; it does not prove that the
external action succeeded. Read status again and confirm the result in
GitHub/Slack. The [WBS6 qualification](docs/restart/evidence/wbs6-mvp-qualification.md)
records a real case where a later check confirmed the existing PR without
creating a duplicate.

The next deployment slice still needs cloud VM startup/network qualification
and production secret delivery/rotation. Slack readiness approval and automated
recovery policy remain open; the local disposable qualification does not
establish them.

## Local coding workflow

This example uses legacy token-file credentials; the setup overlay above provides
App-mode issuance for unattended operation.

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
mounts the installation token and App private key as Gateway secrets. Never put
credential values in the config file. Stop and remove the disposable runtime
with the same Compose files and `down` when finished.


### Local skills

The local base Compose file mounts `.local/skills` read-only at
`/opt/agent-crew-skills`. Root `openclaw.json` and the coding example add that directory to native
`skills.load.extraDirs`; preserve existing entries when enabling it in a retained
Gateway config. Keep each skill in its own directory containing `SKILL.md` and
its supporting files. An empty directory means no additional local skills.
The local directory remains ignored by Git and excluded from the image context.

Native OpenClaw discovers these skills and materializes sandbox-readable copies
in its protected skills workspace. Source discovery alone does not establish
that a particular harness can use a skill or execute its supporting tools.
Skill installation/removal UI remains later scope.
