# WBS3 — Product regression gaps

Status: implemented and verified; awaiting review. Based on WBS0–2.

## Deliver

1. Review `scripts/check-dispatcher-boundaries.mjs`,
   `scripts/check-dispatcher.mjs`, `scripts/session-roundtrip.mjs`,
   `scripts/check-config.mjs` and relevant product code against [SPEC](../../SPEC.md).
   Record covered behaviors and gaps before adding regressions.
2. Extend existing mock boundary tests for malformed Gateway and Lobster
   envelopes and public job projection. Add continuation and error canaries to
   prove credentials stay out of public results while valid continuation data
   remains internal.
3. Inject metadata persistence failures before and after dispatcher invocation.
   A pre-invocation failure causes zero workflow calls; if the invocation may
   have happened but its result cannot be saved, the issue stays blocked for
   inspection and is not automatically invoked again. Keep uncertain-effect
   coverage within dispatcher invocation and persistence.
4. Extend native Gateway coverage to prove `agent-crew.resolve` is denied
   without `operator.admin`, with session state unchanged. Retain authorized
   retry/abandon persistence, duplicate suppression, restart and SIGKILL cases.
5. Fix product defects exposed by these regressions in the same reviewable
   change.

## Acceptance

Run affected tests and the shared Docker suite. Every new regression must fail
when its relevant product guard is removed and pass with the guard present.
Record mock/native scope, injected failure point, state transitions and
workflow invocation counts. Demonstrate authorization denial against the
pinned Gateway; mocked handler checks do not qualify. Include mock boundary,
canary, failure-injection and native Gateway evidence. Record unavailable
native scenarios as gaps. Future issue/publication capabilities receive tests
in their own product packages.

## Reuse

Canary and failure-injection techniques may transfer to other repos. Session
schema, continuation projection and operator resolution cases belong here.

## Evidence

Mock Gateway cases exercise malformed responses, public output and error
canaries, failed metadata writes and lost responses. They assert persisted
state, inspection behavior and invocation counts. Native synthetic Gateway
checks cover low-scope resolution denial, duplicate suppression, SIGKILL,
restart, retry and abandon, including decision persistence across restart.
Guard-removal checks cover the new boundaries and native scope and retry
persistence. Mock guard-removal checks ran against the dispatcher compiled by
the final shared Docker suite. All 12 mock mutations made the boundary script
fail with an assertion; the Gateway and Lobster `ok` guards were removed
individually. Results are recorded in
`/tmp/noslop-wbs3-mutation-current.log`. The earlier
`/tmp/noslop-wbs3-mutate.py` used an outdated build and is not the evidence for
this run. Native disposable Gateway mutations also
confirmed that removing the `agent-crew.resolve` scope guard admits
`operator.read`, and removing retry decision persistence loses approval across
restart.

| Removed guard | Regression that failed |
| --- | --- |
| Gateway and stored error redaction | Gateway/stored error canary assertions |
| Stored workflow-status membership validation | Invalid stored `workflowStatus` rejection |
| Duplicate extension validation | Duplicate session metadata rejection |
| Workflow envelope validation | Malformed Lobster envelope yields `needs-inspection` |
| Gateway `response.ok` validation | Otherwise valid response with Gateway `ok: false` yields `needs-inspection` |
| Lobster `workflow.ok` validation | Otherwise valid workflow with Lobster `ok: false` yields `needs-inspection` |
| Continuation validation | Missing or malformed continuation yields `needs-inspection` |
| Admission persistence before invocation | Pre-invocation persistence failure keeps invocation count at zero |
| Inactive-start inspection and uncertain-state persistence | Ambiguous start/result persistence stays blocked and is not invoked again |
| Public job projection | Continuation/error canaries stay out of public results |
| Native `operator.admin` scope | Low-scope resolution reaches the handler after the scope guard is removed |
| Native retry decision persistence | Retry approval is lost across restart after persistence is removed |

These results do not establish live GitHub or Slack acceptance.
