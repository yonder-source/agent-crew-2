# WBS1 — Standard tooling and CI

Status: planned. Depends on WBS0.

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

## Suggested PR boundaries

Deliver tool installation and shared entry first, then typed/async findings and
compiler flags as needed. Each PR enables useful checks and carries its own
integration fixtures. Use the README's size guidance to decide actual splits.
