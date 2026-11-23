# WBS4.5 authorized Slack task reply ingress

Date: 2026-11-23

## Implemented path

A native before_dispatch hook claims Slack task input when coding Slack settings
are present. It accepts only the default account, consistent host sender/message
IDs and a canonical Slack channel-thread session key. It does not parse task or
user identity from message text. Non-Slack input is unaffected; invalid,
unauthorized or unbound Slack input is handled without an ordinary model turn.

Before resolving a task, native channels.status must show one running, connected
default Slack account. Messages older than its lastConnectedAt are ignored rather
than replayed after downtime. A complete bounded session inventory must contain
exactly one matching retained application thread. Repository/session identity,
authorized users, a successfully sent current question and a newer message
timestamp are required. Timestamp comparison uses integer decimal arithmetic.

The internal Controller seam is shared with operator resume. It rechecks the
reply against retained metadata inside the serialized dispatcher and persists
acceptedReplyTs together with starting state before invoking coding. It preserves
the original task/session/worktree and cumulative active-time budget. A duplicate
or stale event cannot answer another question or repeat execution.

The hook returns after durable admission, not after the model completes. The
background Controller execution retains both task and thread claims until it
settles; additional authorized input receives busy immediately. An interruption
after admission retains the existing inspection boundary. No inbound message
is forwarded as steering. Lost acceptance acknowledgements never trigger a new
model call automatically. Failure responses use static text.

## Verification

Pure reply fixtures cover host identity mismatch, unauthorized users, account
mismatch, non-thread input, bounded content, stale questions, replay timestamps
and reconnection time. Dispatcher fixtures cover the native hook adapter with a
held coding workflow: the hook returns after persistent starting/accepted state,
a second reply receives busy, and exactly one model workflow is invoked. Repeated
Slack events, incomplete inventories, and accepted-state acknowledgement loss
cannot repeat execution. Non-Slack input is left to its normal dispatcher.

The affected pinned Docker checks include lint/typecheck, reply/thread fixtures,
Controller/coding boundaries, coding-result, native Lobster fake-CLI and existing
assigned-issue authorization regressions. These are fixtures, not live Slack
or live Controller-to-model acceptance.

In a separate isolated container with no live state or secrets, native
`openclaw plugins inspect agent-crew --runtime --json` reported plugin status
loaded, typed hook before_dispatch and no plugin diagnostics. Default metadata
inspection alone did not list the hook; it is not a runtime-registration check.
The container used the explicit tracked config and temporary state directory.
This confirms registration, not live Slack ingress.

## Native contract reviewed

The pinned runtime docs plugins/hooks/messages.md define before_dispatch as a
claim that can return handled without text. Runtime dispatch-from-config projects
host content, sender, message, account and canonical session identity into that
hook. Slack threads-and-sessions documents the channel thread session grammar.
The adapter uses the injected public api.on hook and the existing public Gateway
client; no additional private SDK import or duplicate Socket Mode client is used.

## Deployment boundary

This batch is not deployed. Native Slack channel admission remains disabled in
the live Gateway, which still runs source 789c3cf. Native event shape, channel
policy/mention behavior, app event subscriptions and full live reply resumption
must be qualified before claiming Slack acceptance. No real Slack message was
sent during this batch. Provider token accounting and full MVP acceptance remain
outstanding.
