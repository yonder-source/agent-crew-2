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
4. Configure two server-side rulesets for `main`. The CI/PR ruleset requires
   pull requests and the `Gateway checks` status from GitHub Actions (this job
   runs `./scripts/check-all.sh`), and blocks force pushes and deletion. The
   separate update restriction ruleset enables `Restrict updates` and gives
   Repository administrators the only bypass, with `For pull requests only`.
   This separation prevents that bypass from bypassing the required CI rules.
   Do not require an approval count or give coding agents ruleset administration
   or bypass. The owner retains admin authority and can change the rulesets.
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

## Implementation findings

- GitHub connector reads show a public repository with default branch `main`,
  no repository or inherited rulesets, and `main.protected=false` with required
  status checks disabled. The dedicated branch-protection endpoint is not
  readable through the connector, but the public branch response reports the
  branch as unprotected.
- The required status context is `Gateway checks` (the CI job name); its step
  runs `./scripts/check-all.sh`. It is not named `check-all` in GitHub checks.
- The local checkout has no explicit `push.default`, `branch.autoSetupMerge` or
  `core.hooksPath`. Git's effective `push.default=simple` rejects a default
  push when the feature branch tracks `origin/main`; with
  `branch.autoSetupMerge=simple`, a branch created from `origin/main` has no
  upstream and a default push fails until the branch is published. Explicit
  same-name publication and subsequent default push succeed in an isolated
  bare-repository check. A synthetic receive hook rejected direct, force and
  delete updates to `main`; this does not prove GitHub enforcement.
- VS Code 1.146.0 is installed. Its documented Publish Branch action is shown
  when a branch has no upstream and sets the upstream when publishing. An
  explicit target remains possible; the server-side ruleset is necessary to
  enforce the boundary.
- The user accepted `Restrict updates` for `main`, with Repository
  administrators as the only bypass actor and `For pull requests only` as
  bypass mode. Keep this in a separate ruleset from required PR, CI, force-push
  and deletion rules so the admin bypass does not bypass CI. Bind `Gateway
  checks` to GitHub Actions as the expected source. This prevents Write-level
  coding agents from merging or directly updating `main`; the owner keeps
  authority to change the rulesets. A PR could keep the `Gateway checks` job
  name while weakening its steps, so the owner reviews workflow changes before
  merging. These settings are proposed only; live GitHub configuration remains
  unchanged and unverified.
