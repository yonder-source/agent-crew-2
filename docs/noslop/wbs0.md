# WBS0 — Baseline and inventory

Status: complete.

Inventory rechecked against baseline `87b644c`: source/check paths and all
relative links in `docs/noslop/` resolve. The worktree was clean before delivery.

## Inventory

Record source paths, existing checks and behavioral risks in
[rules.md](rules.md). Keep this inventory descriptive until WBS1–4 introduce
enforcement. Do not add a separate exception registry; the configurations that
enforce checks own their exceptions.

## Baseline findings

These findings describe the pre-WBS1 baseline; [rules.md](rules.md) tracks
coverage as subsequent packages land.

- TypeScript strict mode and Docker-based checks already exist.
- ESLint, typed lint presets and a quality-tool dependency lockfile remain to
  be introduced.
- CI already executes `scripts/check-all.sh`; extend that entry point.
- Boundary fixtures and native synthetic dispatcher tests already cover part
  of the proposed behavior. WBS3 starts by finding missing cases.
- GitHub issue access and publication belong to later product work. Their
  behavioral checks accompany those implementations.

## Acceptance

Check that the inventory matches the existing source and test files, verify
document links and ensure package statuses are accurate.

## Reuse assessment

The inventory method and distinction between configuration and behavior are
reusable. Gateway metadata, Lobster continuation handling and operator
resolution scenarios are Agent Crew-specific. Reassess this classification
when implementation provides concrete reusable files.
