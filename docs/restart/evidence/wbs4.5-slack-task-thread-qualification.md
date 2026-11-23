# WBS4.5 Slack task thread and input-request delivery

Date: 2026-11-23

## Behavior

When coding Slack settings are configured, the Controller creates a task root
message before invoking the coding workflow. It retains the agent, channel,
authorized users and root timestamp with the existing job metadata. Missing
Slack settings preserve repository-only behavior. Configured agent mismatch or
a changed retained Slack binding blocks the turn. Resume reuses the retained
thread instead of creating a second one.

A confirmed waiting result sends the input question as a reply to that root.
Delivery records the coding run ID and message timestamp. Root writes persist
creating before sending; questions persist sending only after waiting is durable.
The fixed chat.postMessage endpoint uses the mounted bot secret, a bounded
request, no redirects, and one attempt. Message content uses plain_text blocks
with bounded chunks, so a question cannot introduce Slack mentions or markup.
Credential/provider errors are replaced by static messages.

Failed root creation blocks coding and requires inspection. A failed question
leaves the task waiting with failed delivery. If a write succeeds but its
metadata acknowledgement is lost, the retained creating/sending marker requires
inspection and is not replayed. Repeated issue discovery and startup reads do
not resend messages. WBS6 owns automatic delivery retries.

## Verification

The pinned Docker checks image passed lint/typecheck and the affected task thread,
coding, dispatcher, coding-result, native Lobster fake-CLI and assigned-issue
fixtures. Additional cases verify:

- Intent metadata exists before each Slack API write; question writes occur only
  after the task is durably waiting.
- A root and its question share one thread; repeated dispatch sends neither again.
- Plugin reconstruction retains delivery state, and resumed coding reuses the root.
- Failed question delivery preserves waiting; failed root creation never invokes
  the model workflow.
- Successful Slack writes followed by failed metadata persistence retain unresolved
  intents and are not replayed.
- Malformed Slack responses, channel mismatch and secret-bearing errors fail with
  one request and static feedback. Message blocks are plain text and bounded.

## Boundary

Later deployment and real task root/question delivery, restart retention and
authorized human resumption are qualified in
[live Slack evidence](wbs4.5-slack-live-qualification.md). The following paragraph
is the historical boundary of this original fixture batch.

No live Slack messages were sent, and this batch is not deployed. Provider writes
and state transitions were exercised with fixtures, not live Slack acceptance.
The retained application thread is not a native conversation binding. Native
inbound ownership, authorized user reply handling and end-to-end Controller
resumption from Slack remain outstanding. Generic Slack ingress stays disabled.
The live Gateway remains at source 789c3cf.
