# WBS5 — Acceptance and reuse handoff

Status: acceptance complete; PR #7 awaits review and merge. Depends on WBS1–4.

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

## Implementation evidence

- `./scripts/check-all.sh` passed in a clean detached worktree at commit
  `ab0757f`, using the committed lockfile and pinned checks image. It covered
  deployment assertions, lint CLI fixtures, type/config checks, dispatcher mock
  boundaries, pinned Gateway status/session checks across restart, and synthetic
  dispatcher duplicate/crash/retry/abandon behavior. See local `project-memory.md`
  for the run record.
- PR #7 CI run #14 passed its `Gateway checks` job.
- WBS4 GitHub ruleset application and live agent-authority checks remain
  deferred; no live server-side enforcement is claimed.

## Reuse inventory

| Candidate | Classification | Concrete assets | Dependencies or replacements | Evidence and limits |
| --- | --- | --- | --- | --- |
| Source/check coverage inventory | Configurable by repository | `docs/noslop/rules.md`, `docs/noslop/wbs0.md` | Replace source paths, risk areas and native check references for each repository. | Static inventory rechecked against source and checks; no runtime guarantee. |
| Typed lint, compiler and reproducible Docker check stage | Configurable by repository | `eslint.config.mjs`, `tsconfig.json`, `Dockerfile`, `package-lock.json`, `scripts/check-lint.mjs`, `scripts/check-all.sh`, `.github/workflows/ci.yml` | Node.js 24.22.1; TypeScript 5.9.3; ESLint 10.15.0; typescript-eslint 8.73.0; `@eslint/js` 10.0.1; `globals` 17.14.0. The pinned OpenClaw 2026.11.3 image supplies the matching SDK declarations. Replace pins, declarations and source coverage for the target repo. | WBS1 Docker suite and PR CI. Rules/presets are reusable; toolchain and image pins are not universal. |
| Native ESLint restrictions and resolved Compose assertions | Configurable by repository | `eslint.config.mjs`, `scripts/check-lint.mjs`, `scripts/check-deployment.mjs`, `docs/noslop/wbs2.md` | Uses ESLint built-in rules and Node.js assertions with Docker Compose v2 JSON output; no added dependency-graph package. Select restrictions from demonstrated risks and replace Compose assertions and narrow exceptions. | Accepted/rejected lint fixtures and deployment mutation fixtures in the shared suite; no live deployment acceptance. |
| Canary, failure-injection and guard-removal methods | Configurable by repository | `scripts/check-dispatcher-boundaries.mjs`, `scripts/check-dispatcher.mjs`, `docs/noslop/wbs3.md` | Uses Node.js built-ins and repository-specific fixtures. The techniques transfer; adapt injected boundaries, secret canaries, state transitions and mutation targets. | Mock boundary and native synthetic Gateway checks, including guard-removal results; no live GitHub/Slack acceptance. |
| Gateway session, Lobster continuation and operator-resolution behavior | Agent Crew-specific | `src/index.ts`, `scripts/session-roundtrip.mjs`, `scripts/check-dispatcher.mjs`, `docs/noslop/wbs3.md` | Requires OpenClaw Gateway session metadata, `@openclaw/lobster` 2026.11.3 and Agent Crew job/status contracts; another stack needs replacement. | Pinned local Gateway synthetic integration and restart/failure checks. |
| Solo-maintainer merge and change-authority proposal | Configurable by repository | `SPEC.md`, this WBS4 operating contract, `docs/noslop/wbs4.md` | Depends on GitHub ruleset availability, repository roles/plan and credential model; adapt actor roles, branch patterns and Git/VS Code push behavior. | Isolated bare-repository check and documented VS Code behavior only. GitHub rulesets and agent permissions remain deferred and unverified. |
