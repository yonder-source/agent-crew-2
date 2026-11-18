# WBS5 — Acceptance and reuse handoff

Status: planned. Depends on WBS1–4.

## Settled scope

- Close out the existing NoSlop checks and operating guidance. Do not add a new
  checker, dependency or product-code change unless acceptance exposes a
  concrete gap; bring any such gap back for a separate scope decision.
- Keep `SPEC.md` as the canonical source for settled requirements. Keep local
  run results and interim reuse notes in ignored `project-memory.md`.
- Do not apply or live-test GitHub rulesets in WBS5. Record the WBS4 server-side
  ruleset and agent-authority acceptance as deferred, not complete.
- Inventory reusable practices for later review. Do not extract a generic
  Node.js/TypeScript/Docker specification or shared skills in this WBS.

## Deliver

1. From a clean checkout, run `./scripts/check-all.sh`. This invokes the pinned
   checks image and installs development dependencies from the committed
   lockfile inside Docker; the host needs Docker and Node.js for the shared
   script. Record the command, result and evidence boundary in
   `project-memory.md`. Confirm the final WBS5 PR runs the same shared suite
   successfully in CI.
2. Update `CONTRIBUTING.md` with the shared check command, host prerequisites,
   pointers to the detailed README instructions, observed common fixes, and a
   narrow-exception procedure. Keep rule details in tool configuration. An
   exception must be scoped at the enforcing rule, explain its reason, and have
   an accepted and rejected fixture through the actual configured check.
3. Update `SPEC.md` with the settled quality requirements and operating
   contract. Describe WBS4 ruleset behavior as proposed behavior until GitHub
   settings are applied and verified. Update delivery statuses based on
   evidence: WBS3 PR #5 is merged; WBS4 local specification and push-workflow
   checks are done but external ruleset acceptance is deferred; WBS5 remains
   planned until its acceptance is complete. Resolve duplicate or stale status
   statements in `docs/noslop/README.md` and relevant WBS pages.
4. Add a reuse inventory to this document for WBS0–4. For each candidate,
   classify it as reusable as-is, configurable by repository, or Agent
   Crew-specific, and cite concrete files, dependencies/replacements and the
   evidence type that supports the classification.

## Acceptance

The documented clean-checkout command passes with the committed dependency
lockfile and pinned checks image, and the final WBS5 PR's CI run passes. The
delivery status, SPEC, operating guidance and executable configuration agree.
The reuse inventory cites concrete artifacts and evidence. Report the WBS4 live
ruleset and agent-authority acceptance as deferred; do not claim it is active.

The user reviews this completed implementation before extracting a general
Node.js/TypeScript/Docker specification or shared skill set. This package
prepares that evidence and inventory.
