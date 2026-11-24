# Native Slack Socket Mode qualification — 2026-11-23

## Package and configuration

The shared Gateway base now installs `@openclaw/slack@2026.11.3` with development
dependencies, install scripts and automatic peer installation disabled. Its
OpenClaw SDK resolution points to the existing pinned `/app` runtime, avoiding
a second independently resolved OpenClaw installation. Default synthetic config
does not enable Slack or require token files.

The example configuration uses two native `singleValue` file secret providers
and SecretRefs for `channels.slack.botToken` and `appToken`. It enables Socket
Mode while disabling generic DM/channel handling, native and single slash
commands, and channel join introductions. Plugin allowlist/load paths are
appended to the existing config rather than replacing other plugins.

This batch qualifies the transport. Task-bound Slack input, waiting/resumption,
active-time/token accounting, and setup UI application of channel/user routing
are not implemented by this configuration fragment.

## Live prerequisites

The user provisioned both token files. Gateway file readiness returned
`available` for both and Docker inspection confirmed read-only secret mounts.
The bot `auth.test` succeeded for workspace `Yonder Source`, bot `slackagent1`.
An initial temporary Socket Mode connection received Slack's `hello`; that
temporary connection was closed before enabling the persistent native plugin.

Read-only API checks verified the saved setup draft:

| Setting | Result |
| --- | --- |
| Coding channel `C0CCV2H31TN` | `neos-coding`, bot is a member, not archived |
| Designer channel `C0CCRN11318` | `neos-design`, bot is a member, not archived |
| Authorized user `U0AU1QTH04T` | `victor.tseng`, not deleted |

These validate existence/access for the current saved values, not a reusable
UI validation pipeline or active routing policy.

## Native deployment and verification

A candidate preserved existing agents, models, repository and Agent Crew config.
Native `openclaw config validate --json` returned `valid=true`, no warnings.
The validator ran in a disposable container with an isolated state directory:
the first attempt with the live state bind was refused by the Gateway's PID
namespace ownership lock, so that approach was discarded.

After confirming 12 sessions and no active runs, stopped the Gateway, backed up
the previous config to `.local/deployment-backups/slack-transport-20261123/`,
atomically replaced the config, and recreated the Gateway with the setup and
Slack overlays. The source config contains file references, never token values.

Image:
`sha256:3a59f9d41e49eb4180768107da8b840433138b6f9e62aaca1e2383abfbc0adc8`.

Native `channels.status` with probing confirmed the default Slack account:
`enabled=true`, `configured=true`, `running=true`, `connected=true`, probe
`ok=true`, and no last error. This is an actual persistent Gateway connection,
not only a temporary WebSocket handshake or file-readiness check.

The existing issue #2 job, run, workspace, branch, base and structured delivery
binding remained unchanged, including commit
`db3fc8db90fd77d079b24ac618e6437e159ba377`. Lint/build, resolved deployment
guardrails and the added pinned-Slack version assertion passed. No test Slack
message, issue write, push or PR was sent.
