# WBS4 — Merge and change authority

Status: planned. Depends on WBS1 and inspection of actual repository settings.

## Deliver

1. Inspect GitHub rulesets/branch protection, reviewer availability, required
   checks and the credentials available to coding agents.
2. Define who can change quality configuration, workflows and tests, approve
   those changes, bypass protection and merge. Match controls to the actual
   ownership model, including a solo-maintainer workflow if applicable.
3. Prefer GitHub native review requirements, CODEOWNERS and least-privilege
   agent credentials. Prepare reviewable proposed settings before applying
   externally visible permission changes.
4. Verify whether candidate changes can weaken required checks while still
   satisfying merge requirements. Document remaining capability gaps.
5. Propose custom trusted-check or approval machinery only for an observed gap
   that native controls cannot meet and the owner chooses to address.

## Acceptance

Use a disposable PR or suitable isolated repository to demonstrate selected
required-check/review behavior and agent authority limits. Record actual
settings and any bypass paths. If external settings cannot be exercised,
record this package as pending rather than claiming enforcement from files.
Keep findings and the chosen operating contract in SPEC.
