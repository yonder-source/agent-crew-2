# WBS4.5 Slack settings validation and Apply

Date: 2026-11-23

## Behavior

Setup validates optional coding/designer Slack settings before Apply. A role
with either a channel or users requires all of agent, channel and authorized
users. Comma/whitespace-separated users are deduplicated and sorted. Existing
agent roster validation remains in place. Read-only Slack API checks require
an active channel with bot membership and active human user accounts; failures
use static feedback without token values or raw provider errors. Reads use the
mounted bot credential, fixed HTTPS endpoints, redirect rejection and bounded
request/validation deadlines. Shared users are checked once per validation.

Apply persists the settings under `plugins.entries.agent-crew.config.slack`.
Slack-only changes are included in the unchanged comparison, so they cannot be
silently discarded when repository settings match. Existing task admission,
draft hash and runtime activation checks apply. Native Slack ingress policy,
SecretRefs and other plugin settings are preserved. Current settings can be
loaded when no retained draft exists. Empty channel and users leave a role
unconfigured; designer execution and thread routing remain later work.

## Verification

- The isolated `agent-crew-slack-settings-checks` image passed its complete
  Docker checks target, including parser/schema, setup admission and provider
  fixtures. Its native config validator also accepted a configuration containing
  both coding and designer Slack roles through the updated config fixture.
- Regression fixtures cover partial settings, malformed IDs, normalized user
  lists, channel membership/archive failures, inactive users, provider errors,
  missing credentials, redaction, config preservation, Slack-only Apply and
  blocking invalid settings before config writes. Existing active/uncertain
  task Apply fixtures remain passing.
- Executed the new validation helper inside the existing live Gateway using its
  mounted bot token. Coding channel `C0CCV2H31TN`, designer channel `C0CCRN11318`
  and authorized user `U0AU1QTH04T` all passed the real Slack read-only checks.
  No Slack messages were sent.

## Boundary

This source change has not been deployed. Live checks exercised the helper
against Slack, not the new Gateway setup methods or UI Apply across restart.
The previously deployed native Socket Mode transport is unchanged. Task-bound
waiting/resume, cumulative usage and live setup Apply remain unqualified.
