# WBS4.5 live Slack task qualification

Date: 2026-11-23

## Deployment

Deployed source 4a76f76 and a compatibility correction for the pinned runtime's
lowercase canonical Slack session keys. The reply parser normalizes the channel
segment back to the Slack API ID before comparing retained settings. Added pure
parser and Controller adapter regressions using the native lowercase grammar.

Initial image: sha256:653149e14416d4a22d95a4dbc1420768cb4ac13acef7cd6f1a4ba2822875fcad.
Corrected image: sha256:a3cafb31c803b9b3c30ea587960fcbdebb64250fcadfedb25983f38acbe5e7d6.
Backup image: agent-crew-openclaw:before-slack-reply-qualification-20261123.
Configuration backup: ignored .local/deployment-backups/slack-reply-20261123.

Native Slack groupPolicy is allowlist, with only coding channel C0CCV2H31TN,
requireMention=false and users=[U0AU1QTH04T]. Bot input, DMs, native commands,
slash commands and join introductions remain disabled. Agent, model, secret
references and GitHub configuration were preserved. The candidate passed native
config validation. Existing issue-2 committed delivery survived replacement.

## Observed live waiting path

Created disposable-test-repo issue 4 and applied ready for agent. Real discovery
created job d3df81da-1dfd-4cda-a914-68b48870e07f in session
agent:coding:agent-crew-fb19503e3f8d0a1a9a3296860382eb75, using worktree
/home/node/.openclaw/worktrees/c2f6b1f78d368c73/agent-crew-issue-4 and branch
openclaw/agent-crew-issue-4, base 48e1200874eca26e69d88024db6f90abaf5bb3c7.

Real model run 37715116-0ec6-48f1-934e-5b8383c76d9d returned a request for
GO-SLACK-4. Controller retained waiting, activeMs=13532 and known elapsed time.
The actual Slack root was acknowledged at 1795434885.423099, and the input
question at 1795434900.117339. Both target C0CCV2H31TN. Socket Mode reported
connected and bot probe successful. Bot auth confirmed chat:write and the
needed channel/history/user read scopes without exposing token values.

After corrected-image replacement, the same waiting job, initial run, root and
question timestamps, source/worktree/branch/base bindings and activeMs=13532
were retained. Waiting time across Gateway replacement did not reset or grow
the active-time record.

## Pending acceptance

An authorized human must send GO-SLACK-4 in the task thread after the corrected
Gateway is connected. Bot credentials cannot impersonate the human sender.
The human step was requested through the interactive question, with the actual
thread permalink. Native inbound reply admission, same-job resumption, final
coding delivery and deduplication are not yet claimed as passed.
