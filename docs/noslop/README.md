# NoSlop delivery plan

NoSlop uses standard lint, compiler checks, regression tests and CI to constrain
AI-generated changes. Agent Crew is the first implementation and dogfooding
repository. Reusable Node.js, TypeScript and Docker practices are collected
while implementing each package; extraction into a shared skill set follows
completion and review of the actual results.

## Status and authority

WBS0–3 are complete, including the merged WBS3 delivery. WBS4 local design and
push-workflow checks are complete; applying and live-testing its GitHub rulesets
is deferred. WBS5 is in progress.

[Root SPEC.md](../../SPEC.md) owns requirements and settled decisions. This
folder describes delivery and acceptance. Executable tool configuration owns
enabled rules; the inventory links to it once implemented. Local
`project-memory.md` records work in progress, test results and reuse candidates.

## Delivery

| Package | Outcome | Dependency |
| --- | --- | --- |
| [WBS0](wbs0.md) | Baseline and existing coverage inventory | Complete |
| [WBS1](wbs1.md) | Standard lint, compiler checks and shared CI entry | WBS0 |
| [WBS2](wbs2.md) | Focused API, import and deployment restrictions | WBS1 |
| [WBS3](wbs3.md) | Product boundary and failure regressions | Complete; PR #5 merged |
| [WBS4](wbs4.md) | Review, merge and agent change authority | Local work complete; live ruleset acceptance deferred |
| [WBS5](wbs5.md) | Acceptance, operating guidance and reuse inventory | In progress; WBS1–4 |

Each package may span several PRs. Target **300–600 handwritten changed lines**
per branch/PR, counting additions plus deletions, including tests and docs.
Above **800**, review whether to split. Report generated files and lockfile
changes separately. Preserve coherent acceptance when choosing boundaries.

## Implementation choices

- Start with maintained ESLint and typescript-eslint presets. Add explicit
  rules only for demonstrated gaps. Enable typed rules with a real TS project;
  configure active JavaScript deliberately.
- Commit the dependency lockfile and use a reproducible install in the checks
  image. Keep quality tooling out of the runtime image.
- Add each check to the existing shared command and CI in its delivery PR.
- Test configuration wiring with representative passing/failing examples.
  Custom checkers need their own focused tests; upstream rules do not need a
  duplicate syntax-variant suite here.
- Prefer native config validators and ESLint restrictions. Introduce an import
  graph tool only when resolved dependency analysis is actually required.
- Use product tests for validation, authorization and uncertain effects. Lint
  cannot establish those behavioral guarantees.
- Keep exceptions in the configuration that enforces the rule, with a reason
  and relevant test. Add no separate exception registry before a consumer needs it.

A generic policy engine, custom module resolver, evidence manifest, doctor
command and external approval service are deferred until an observed gap
justifies their maintenance cost.

## Completion record

For each package, record commands, results, evidence scope and remaining gaps
in local project memory. Assess whether each delivered part is reusable as-is,
requires repo-specific configuration, or belongs to Agent Crew. Update SPEC
with settled decisions. WBS5 consolidates candidates for the user's later
shared-spec extraction.
