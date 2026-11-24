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

## Completed live acceptance

An actual authorized human (U0AU1QTH04T) replied GO-SLACK-4 at
1795435184.576519 in the retained task thread:
https://yondersource.slack.com/archives/C0CCV2H31TN/p1795434885423099.
The Controller persisted that accepted reply and resumed the same job, coding
session, worktree, branch and base. Resumed run:
01833ebf-5c5e-4064-a7bf-a76abbf2d00a; physical session:
ef0b6ec3-d96d-4dd4-b848-c01710432725.

The task completed with validation=ok and ready delivery at commit
fccdc19d2da2325db5aa4286a7aee83b8b4b6bd6. Git HEAD matched the delivery,
the worktree was clean, and the only changed path was
docs/slack-thread-qualification.md. Its exact contents matched the issue's
requested human-confirmation marker. Total active time was 41194 ms; human
waiting and Gateway replacement were excluded. Repeated dispatch retained the
same job, run and delivery rather than starting another execution. No publication
or draft PR was performed; those remain WBS5 scope.

## State corrections found during qualification

A same-process resume could briefly appear as needs-inspection while its starting
metadata write awaited acknowledgement. Track in-flight admissions until the write
settles; interrupted writes and prior-process starts still require inspection.
Final result construction also retained a previous inputRequest through its spread
of current metadata. Clear prior outcome fields before assigning the new outcome.
Both cases have regressions observed failing before their respective fixes and
passing afterward. Native pluginPatch namespace replacement was independently
verified; merge behavior was ruled out as the cause.

The completed live job's stale inputRequest was removed without changing its
identity, delivery or accepted-reply evidence. The final deployed state-fix image is
sha256:884bf8af5c74a62ed3757f18bb05a0aaf86659eefe7341bee4ddad32c9a5393a.
Targeted fixtures cover coding admission/outcomes, dispatcher boundaries, Slack
reply authorization/replay/reconnect and task-thread delivery. These complement
the real human/model/Slack run above; they do not claim WBS6 reporting or full MVP
acceptance.

After final replacement, Gateway health was healthy, the native Slack account was
running with a successful bot probe and no account error. Issue 4 retained its
completed result and accepted reply with no stale inputRequest; issue 2 retained
its original committed delivery unchanged.
