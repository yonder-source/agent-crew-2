# WBS4 — Merge and change authority

Status: planned. Depends on WBS1 and inspection of actual repository settings.

## Deliver

1. Inspect GitHub rulesets/branch protection, reviewer availability, required
   checks and the credentials available to coding agents. Inspect the local
   Git branch/upstream and push configuration used by the supported VS Code and
   CLI workflows as well.
2. Define who can change quality configuration, workflows and tests, approve
   those changes, bypass protection and merge. Match controls to the actual
   ownership model, including a solo-maintainer workflow if applicable.
3. Prefer GitHub native review requirements, CODEOWNERS and least-privilege
   agent credentials. Prepare reviewable proposed settings before applying
   externally visible permission changes.
4. Protect `main` with a server-side rule that requires pull requests and
   blocks direct updates, force pushes and deletion. Keep routine user and agent
   credentials out of the bypass list where the repository plan permits it.
   Confirm the applicable GitHub plan and the actual ruleset behavior before
   treating this as enforced.
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
8. Propose a repository-managed `pre-push` guard only if Git defaults and
   server-side rules leave an observed gap. If selected, constrain remote ref
   updates to `main`, document installation and the effects of skipping local
   hooks, and test default, explicit-ref and multi-ref pushes. A local hook is
   an early warning; it cannot replace server-side protection.
9. Propose custom trusted-check or approval machinery only for an observed gap
   that native controls cannot meet and the owner chooses to address.

## Acceptance

Use an isolated bare repository to test default and explicit push behavior,
upstream mismatch, and any selected local hook. Use a disposable PR or suitable
isolated repository to demonstrate server-side `main` protection, required
checks/review behavior and agent authority limits. Record actual settings and
all tested bypass paths. If external settings cannot be exercised, record them
as pending rather than claiming enforcement from files. Keep findings and the
chosen operating contract in SPEC.
