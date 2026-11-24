# WBS4.5/WBS5 adoption of the WBS5 grilling notes

Date: 2026-11-24

Reviewed the working copies of `SPEC.md` and `docs/restart/wbs4.md`, `wbs5.md`
and `wbs6.md` in `/home/budin/code/agent-crew-2-docs-wbs5-grilling`, branch
`docs/wbs5-grilling`, HEAD `e10241d`. The grilling changes were uncommitted at
review time. That worktree was read without modifying or committing its work.
The current root SPEC and implemented WBS4.5 branch/base/delivery contracts take
precedence over this older planning snapshot.

## Adopted

| Proposal | Application |
| --- | --- |
| Structured validation and server-owned assignment identity | Already implemented by WBS4.5; WBS5 explicitly consumes the retained ready delivery and cannot accept replacement authorization/head/validation from an agent. |
| Separate push and PR effects | WBS5 persists independent operation identities, pre-write intent, confirmation and inspection state across restart. Confirmed push alone is not a published PR. |
| Idempotent existing draft PR lookup | WBS5 verifies repository, issue association, exact branch/head and base before reusing an open draft. Closed/merged/non-draft/mismatched or ambiguous results require inspection. |
| PR contents and public result | Base is main; title/body use assigned issue and bounded summaries. Only published may expose a confirmed PR URL. Public output excludes internal credentials. |
| Independent coding, publication and message delivery outcomes | WBS4.5 hands off its original committed delivery. WBS5 publication failure does not overwrite it; WBS6 delivery-only retries cannot rerun coding or publication. |
| Explicit failure/duplicate/restart acceptance | WBS5 now lists the corresponding fixtures and a separate disposable live GitHub publication check. |

These are specification and handoff changes. WBS5 publication operations and WBS6
message retries are not implemented or live-qualified by adopting their contracts.

## Adapted or not adopted

- **Publication branch rename:** Do not adopt `feat/issue-<number>` or switch to
  a second deterministic branch. WBS4.5 already creates and records native
  `openclaw/agent-crew-issue-<number>` and its exact base/head. WBS5 publishes
  that same branch without rewriting history.
- **Publication-time main equality:** Do not require local and remote main to
  remain equal or recreate the task base. Equality/divergence checks belong to
  task preparation. Publication checks the recorded base ancestry and exact
  delivery head; remote main advancing alone does not invalidate the task.
- **Automatic publication commit:** The prohibition on another WBS5 commit is
  retained, while WBS4.5's Controller-owned local commit remains required. This
  reconciles the older grilling assumption with private sandbox Git metadata.
- **Blanket 4xx failure:** Do not infer a side-effect-free failure from every HTTP
  4xx or Git process exit. Classify definitively rejected operations separately
  from conflicts, ambiguous remote responses and uncertain writes. Preserve
  inspection rather than allowing automatic replay.
- **Coding-agent publication endpoint:** The API belongs to the Controller and
  trusted Lobster workflow; publication is not an agent tool or an agent-supplied
  authorization block.
- **Full WBS6 expansion:** Keep message operation IDs, retry/backoff details and
  Slack failure classification for WBS6. Carry forward the truthful publication
  result and side-effect-free reporting seam without expanding WBS4.5 into full
  reporting/retry implementation.

## Deferred acceptance

Per the user's instruction, the complete 20-minute Controller → Lobster → coding
timeout test remains pending user execution. The existing corrected 60-second
native process-tree test and deterministic cumulative-time fixtures remain
separate evidence. PR creation does not mark that acceptance passed; see
[timeout qualification](wbs4.5-coding-timeout-qualification.md).
