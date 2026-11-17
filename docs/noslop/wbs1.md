# WBS1 — Standard tooling and CI

Status: complete. Depends on WBS0.

## Implementation

- `package-lock.json` locks the quality toolchain. The Docker build installs
  development tools explicitly even under the base image's production setting;
  the runtime stage receives compiled output and existing runtime files only.
- `eslint.config.mjs` uses maintained recommended presets. The resolved typed
  preset includes floating/misused Promise rules but omits unsafe narrowing
  assertions, so `no-unsafe-type-assertion` is added explicitly. Unknown Gateway
  payloads now pass runtime guards before use.
- All three assessed compiler flags are enabled without exceptions.
- `src/config.mjs` is an explicit compiler input alongside its declaration;
  `npm run build` smoke-imports the emitted module. This prevents declaration
  discovery from silently omitting a required runtime JavaScript file.
- `npm run lint` covers JS/TS module extensions and declarations. JavaScript
  uses recommended syntax/scope rules; TypeScript uses the real SDK-backed
  project. Scripts, workflows and retained JS evidence remain in scope.
- `scripts/check-lint.mjs` tests coverage and runs the actual CLI against safe
  and rejected assertion/Promise/JavaScript examples. Docker checks run these
  fixtures and lint through the existing `scripts/check-all.sh` CI entry.
- Review follow-up: the checks stage copies the full source context. Compose
  mounts the checkout read-only, and coverage checks compare its JS/TS paths
  with actual lint results. New root/nested/hidden-path fixtures demonstrate
  successful coverage and rejection of missing files and invalid JavaScript.
  Job status definitions share one list; every existing non-retry state blocks
  redispatch in the mock boundary regression.

## Deliver

1. Pin compatible ESLint, typescript-eslint and TypeScript versions; commit a
   lockfile and install reproducibly in the Docker checks stage.
2. Start with ESLint recommended and typescript-eslint recommended typed
   configuration. Inspect resolved rules before adding explicit unsafe-assertion
   restrictions. Cover application TypeScript, JavaScript scripts and workflows.
3. Assess `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
   `noFallthroughCasesInSwitch`. Enable suitable flags and fix findings in
   reviewable increments. Document any remaining blocked flag or rule.
4. Expose one lint command and integrate it into `scripts/check-all.sh`, which
   CI already invokes. Keep the runtime image free of quality-only dependencies.
5. Add representative fixtures that prove typed lint, Promise handling,
   JavaScript coverage and failing exit status are wired correctly.

## Acceptance

Run the lint entry, typecheck and existing Docker suite. Demonstrate a rejected
unsafe assertion and floating Promise plus accepted safe equivalents through
the actual configuration. Confirm intended files are linted and no broad
ignore silently hides active code. Verify reproducible installation from the
committed lockfile. Record results and reusable setup in project memory.

The shared Docker suite passed, including lint CLI acceptance, type/config
checks, mocked boundaries and native synthetic Gateway/session/dispatcher
restart, SIGKILL, retry and abandon scenarios. This qualifies WBS1 tooling
and existing synthetic integration; GitHub/Slack workflow acceptance remains
with the later product packages.

## Suggested PR boundaries

Deliver tool installation and shared entry first, then typed/async findings and
compiler flags as needed. Each PR enables useful checks and carries its own
integration fixtures. Use the README's size guidance to decide actual splits.
