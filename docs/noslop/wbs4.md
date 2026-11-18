# WBS4 — Merge and change authority

Status: planned. Design settled by grilling; verify actual repository settings
and enforcement during implementation.

## Deliver

1. Inspect GitHub rulesets/branch protection, reviewer availability, required
   checks and the credentials available to coding agents. Inspect the local
   Git branch/upstream and push configuration used by the supported VS Code and
   CLI workflows as well.
2. Use the solo-maintainer model: the owner reviews quality configuration,
   workflow and test changes and merges PRs. Do not require an independent
   approval count that the repository cannot provide.
3. Prefer GitHub native review requirements, CODEOWNERS and least-privilege
   agent credentials. Prepare reviewable proposed settings before applying
   externally visible permission changes.
4. Configure server-side protection for `main`: require pull requests and
   passing `check-all`; block direct updates, force pushes and deletion. Do not
   require an approval count or configure a push allowlist. Give coding agents
   feature-branch/PR permissions only; do not grant ruleset administration or
   bypass. The owner retains admin authority and can change or bypass controls.
   Confirm plan support and actual enforcement before claiming it is active.
5. Assess Git's native push safeguards for the local workflow, including
   `push.default=simple` and `branch.autoSetupMerge=simple`. Verify how creating
   a feature branch from `origin/main` affects its upstream, and make first
   publication explicitly target the same-named remote branch. Do not assume a
   local default prevents an explicit push to `main` or a GUI-selected target.
6. Demonstrate the behavior in an isolated bare repository: a feature branch
   with an `origin/main` upstream must not update remote `main` on a default
   push; intended feature publication succeeds; explicit direct updates to
   `main` are rejected by the server-side control. Include editor/CLI behavior
   supported by the project and report any bypass paths.
7. Verify whether candidate changes can weaken required checks while still
   satisfying merge requirements. Document remaining capability gaps.
8. First verify Git defaults and supported VS Code behavior. Propose a
   repository-managed `pre-push` guard only if these and server-side rules leave
   an observed gap. If selected, constrain remote ref
   updates to `main`, document installation and the effects of skipping local
   hooks, and test default, explicit-ref and multi-ref pushes. A local hook is
   an early warning; it cannot replace server-side protection.
9. Propose custom trusted-check or approval machinery only for an observed gap
   that native controls cannot meet and the owner chooses to address.

## Acceptance

Use an isolated bare repository to test default and explicit push behavior,
upstream mismatch, and any selected local hook. Inspect the live repository
settings and demonstrate server-side `main` protection, required checks and
agent authority limits where permissions allow. Record actual settings and
tested bypass paths. If a check cannot be exercised, record it as pending
rather than claiming enforcement from files. Keep findings and the chosen
operating contract in SPEC.
