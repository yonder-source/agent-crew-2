# WBS3 — Product regression gaps

Status: planned. Depends on WBS0; coordinate code fixes with WBS1–2.

## Deliver

1. Review current boundary, config, session and dispatcher tests against SPEC.
   List uncovered behaviors before adding cases.
2. Extend existing tests for malformed input/envelopes, public field projection
   and sensitive values in errors. Use canaries where they prove leakage.
3. Exercise missing persistence-failure and uncertain-effect paths: verify
   invocation counts and recorded state when a write or response fails.
4. Verify native denial of operator resolution without the required scope.
   Retain duplicate, restart, SIGKILL, retry and abandon coverage.
5. Fix product defects exposed by these tests in the same reviewable change.

## Acceptance

Run affected tests and the shared Docker suite. Show that new regression cases
fail when the relevant product guard is removed. Record mock versus native
scope, state transitions and side-effect counts where relevant. An unavailable
native scenario remains an explicit gap. Future issue/publication capabilities
receive tests in their own product packages.

## Reuse

Canary and failure-injection techniques may transfer to other repos. Session
schema, continuation projection and operator resolution cases belong here.
