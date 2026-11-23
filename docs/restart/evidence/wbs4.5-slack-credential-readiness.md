# Slack credential readiness — 2026-11-23

## Scope and implementation

The optional `compose.slack.yaml` mounts two fixed files as read-only Docker
secrets on the Gateway:

| Host file | Gateway path |
| --- | --- |
| `.local/secrets/slack-bot-token` | `/run/secrets/agent-crew-slack-bot-token` |
| `.local/secrets/slack-app-token` | `/run/secrets/agent-crew-slack-app-token` |

`agent-crew.setup.slack.credentials` requires `operator.admin` and returns only
`botToken` and `appToken` statuses: `available`, `missing`, `invalid` or
`unavailable`. Available means readable, nonempty and matching the expected
`xoxb-`/`xapp-` token type. This is not token authentication or scope validation.
Raw file contents and exception messages never enter the response. Each request
reads the current files; no credentials are cached. The setup page displays this
status independently of repository validation and can repeat the check.

No Slack token input is added to the form, retained draft or plugin config.
The optional overlay does not enable Slack channels or start a connection.
Native Slack plugin installation/configuration, channel and user validation,
Socket Mode connection and task waiting/resumption remain subsequent work.

## Verification

The credential fixtures exercise present files, trailing newlines, swapped token
types, empty values, missing files, permission failure and subsequent recovery.
A secret canary in file contents and exception messages is never returned.
Resolved Compose verification checks matching secret targets and confines both
mounts to the Gateway. The shared check entry covers the overlay model without
requiring real secret files or mounting them in checks.

Build/lint and the coding/setup boundary fixtures passed. The endpoint fixture
checks its admin scope and result shape; the native Gateway test additionally
confirmed both missing-file statuses and rejection of an `operator.read` caller.

Deployed image:
`sha256:3695a8f3d3aa5f34878fa6631140bf310120c82e10a556adced0912940cb66c9`.
The persistent Gateway uses its original Compose configuration with no Slack
tokens mounted, so both `missing` results are expected. No real token was
created, installed or sent to Slack; no Slack message or login was initiated.
The pinned image currently has no `/app/extensions/slack` installation.
