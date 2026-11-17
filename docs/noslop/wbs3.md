# WBS3 — Product regression gaps

Status: planned. Depends on WBS0; coordinate code fixes with WBS1–2.

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
