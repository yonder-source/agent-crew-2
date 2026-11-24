# WBS6.5 — Slack issue grilling with Designer

## Goal

Let an authorized person explicitly name an issue in Slack, discuss and refine
that issue with the configured Designer agent, and publish the agreed task
definition back to that issue. This is a user-started intake conversation, not
issue discovery or coding-task dispatch.

The [root SPEC](../../SPEC.md) remains the requirements source. This package
does not change the existing coding lifecycle or automatically admit an issue
for coding.

## Entry conditions

- WBS4.5 supplies the configured repository, Designer agent, Slack channel,
  authorized user list and GitHub App credential delivery.
- WBS6 has established Slack operation and reporting behavior used by the
  configured Gateway.
- The configured GitHub App has issue read/write access for the selected
  repository. Actual write results must be qualified separately from granted
  permissions.

## 6.5.1 Start grilling for an issue

**Work:** Register `/grill` as a Slack native slash command and accept the
`/grill <issue-number>` and `/grill search <query>` forms. Configure the Slack
App to deliver slash command events to the Gateway through its supported Socket
Mode integration. The Gateway's pinned Slack plugin must also be qualified for
receiving and acknowledging button interaction events; do not treat Slack
platform support alone as plugin qualification.

Add a Controller path for these user-started requests. Derive the Slack user,
channel and command identity from authenticated host context, then bind the
configured repository and selected issue to a newly created Slack thread. Later
thread messages and button actions resolve that retained binding; Designer
input cannot choose or change the repository, issue or Slack identity. Keep
these short-lived thread bindings separate from coding jobs and worktrees.

Accept commands only from an authorized Slack user in the configured Designer
channel. Resolve the repository from active Controller configuration; do not
accept a caller-selected repository, agent, channel or user identity from
command text. For `/grill <issue-number>`, validate and read that issue through
the Controller before starting the Designer turn. Every explicit issue command
starts a new independent grilling request, even when that issue has another
grilling thread. Post a root acknowledgement in the channel and continue the
conversation in its thread. Retain trusted context binding later messages to
the request.

For `/grill search <query>`, search only the configured repository using
GitHub issue search syntax, including ordinary keywords and supported
qualifiers such as `label:`, `assignee:`, `author:`, `is:open` and `is:closed`.
Restrict results to issues, excluding pull requests. Default to open issues;
allow an explicit `is:closed` query. Return up to 10 matching issues to the
requesting user as an ephemeral response, with issue number, title, labels and
link. If more than 10 issues match, ask the user to narrow the query. Search
alone does not start a Designer conversation. The user may start grilling by
explicitly invoking `/grill <issue-number>` or clicking `Grill this issue` on a
search result.

Do not scan GitHub for issues, poll for work, start coding, create a worktree,
or create a publication job as part of Designer intake. An explicitly named
issue that cannot be read or is outside the configured repository receives a
clear error and does not start the conversation.

**Done when:** An authorized Slack request starts a Designer conversation for
the named issue and posts a root acknowledgement with the conversation in a
thread. Unauthorized, malformed, unreadable and cross-repository requests do
not invoke the Designer or access another issue. Search returns only
configured-repository issues, caps the ephemeral
result list at 10, and does not start grilling until an explicit issue command
or the selected result's `Grill this issue` button is used. The registered
native command reaches the Gateway through Socket Mode; ordinary messages
beginning with `/grill` do not serve as a fallback trigger.

## 6.5.2 Grill and settle the issue

**Work:** Give Designer the bound issue title/body and repository development
guidance as untrusted task material, and let it ask focused questions in the
Slack thread until the human settles the scope and acceptance criteria. Keep
Controller authorization separate from issue content and repository guidance.
Designer may read the bound issue and prepare a proposed issue update; it cannot
change the repository, start coding, apply labels or publish a PR.

Show the proposed settled task definition as a complete issue body to the
authorized human in the same thread. Preserve the current issue title. Provide
`Confirm and write back` and `Continue discussion` buttons. Bind the confirmation
button to the exact proposed body version; any revision invalidates prior
buttons. A rejected or revised proposal returns to grilling and does not mutate
the issue. Keep conversational messages and button values as task input, never
as authorization.

**Done when:** The conversation can gather missing requirements, present a
reviewable final issue update, and wait for explicit human confirmation before
any GitHub write.

## 6.5.3 Write back and hand off

**Work:** On confirmation, have the Controller first re-read the bound issue and
verify its body has not changed since this grilling thread started. If it has
changed, do not overwrite it; return to grilling with the current issue body for
review. Otherwise update only the bound issue body using its configured
repository-scoped credential, preserving the title. Read the issue back and
verify the saved body before reporting success. A failed or uncertain write
must be reported without claiming the issue was updated; uncertain writes remain
subject to the existing inspection boundary and are not blindly replayed.

After verified writeback, report the issue link and that it is ready for human
review. Do not apply `ready for agent` automatically. The human decides whether
to apply the existing label and thereby enter the coding workflow. Keep Slack
conversation completion separate from coding admission and publication status.

Check for issue-body changes immediately before writeback. Changes during the
conversation do not require a GitHub re-read before every Designer turn; if the
pre-write check detects a change, return the current body to the conversation
and require a newly reviewed proposal before another confirmation.

**Done when:** The confirmed issue definition is read back and reported in the
same Slack thread. A mismatch or uncertain result is visible for inspection,
and no code workflow starts until the human separately applies `ready for agent`.

## 6.5.4 Validate and hand off

Search-result buttons start grilling only for the selected issue, and only when
the click comes from an authorized user in the configured Designer channel.
The `Confirm and write back` button is the approval action; the authorized
human does not need to type `confirm`. Grilling discussion itself remains
ordinary thread messages.

Cover fixtures for:

- Slack authorization, malformed issue references and configured-repository
  binding;
- issue read and Designer prompt boundaries, including untrusted issue content;
- proposal edits and rejection without GitHub mutation;
- confirm/continue button authorization, stale buttons and issue changes since
  the thread started;
- issue write/readback mismatch and uncertain write;
- restart or duplicate Slack delivery without unintended repeated issue writes;
- confirmation that Designer cannot start coding, apply labels or publish;
- pinned Slack plugin button payload receipt, acknowledgement and thread routing.

Qualify one disposable issue through Slack request, human grilling, confirmed
writeback and GitHub readback. Record fixture results separately from live
Slack/GitHub evidence.

**Done when:** A human can inspect the Slack thread and the matching updated
GitHub issue. Evidence demonstrates the explicit confirmation gate and the
separate human-controlled `ready for agent` handoff.

## Handoff

This package hands a clarified issue back to the existing human-controlled
admission flow. Designer skill-management UI, automatic issue discovery,
automatic label application and coding execution remain outside this package.
