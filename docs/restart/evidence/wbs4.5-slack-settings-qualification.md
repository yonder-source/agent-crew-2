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

## Live Gateway deployment

Deployed source commit `789c3cf` using all three Compose files (base, setup,
Slack). Runtime image: `sha256:4306f3ba4547d724d935c1df541c3014031385fe6b0596ad4cba5f35a7472dad`.
Previous image retained as `agent-crew-openclaw:before-slack-settings-20261123`.
Preflight found 12 sessions and no active runs.

The authenticated native setup Validate method passed repository, agent and
both Slack role checks. Apply acknowledged the saved configuration and reported
activation pending. After Gateway restart, draft.get current values matched the
saved channel/user settings and polling returned to running with no activation
pending. Native Slack account status reported running/connected with a successful
bot probe. The retained issue-2 job, run, workspace, branch, base and committed
coding delivery remained identical. No Slack message, GitHub write or publication
was performed.

## Original boundary (superseded for browser and interaction)

The actual native browser flow is now qualified in
[browser evidence](wbs4.5-ui-browser-qualification.md), task-bound human replies
in [live Slack evidence](wbs4.5-slack-live-qualification.md), and accounting in
[token evidence](wbs4.5-coding-token-qualification.md). The original batch
boundary below remains a description of the checks performed at that point.

### Historical batch boundary

The live setup RPC path and restart persistence are qualified; browser clicks
were not exercised. Task-bound waiting/resume and cumulative usage remain
unqualified. The deployment does not enable ordinary Slack command dispatch.
