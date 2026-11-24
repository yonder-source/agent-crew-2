# WBS4.5 local skill delivery — 2026-11-21

## Implementation

The local base Compose file mounts ignored host `.local/skills` read-only at
`/opt/agent-crew-skills`. Root OpenClaw config and the real-coding example add it
to native `skills.load.extraDirs`. Existing installation configuration was updated
through config.get/config.set with a revision hash, preserving other skill settings.
The persistent Gateway was recreated after confirming no active sessions; its
state, repository drafts and completed task worktrees were retained.

Pinned OpenClaw 2026.11.3 discovers extra roots at lowest precedence, materializes
selected skills in its sandbox skills workspace and protects those copies with
read-only nested mounts. No Controller copy logic or custom sandbox bind override
was introduced. The read-only source is not included in the image or task Git history.

## Live evidence

- Gateway mount inspection: host `.local/skills` at `/opt/agent-crew-skills`, RW=false.
- Native coding-agent catalog: 82 total skills; 33 `openclaw-extra` local skills,
  including `grilling`, marked eligible. Eligibility is native metadata, not proof
  that all skill workflows or supporting tool dependencies work.
- Created separate native session `agent:coding:skills-qualification-20261121`
  with its own managed worktree from main. This is runtime qualification, not a
  Controller-assigned issue or an issue-tool authorization test.
- Real model run `e8059e00-81af-45ae-954d-719b0fcbe456` completed. It used
  `skills_read` and `sandbox_exec` and read:
  `/workspace/.openclaw/sandbox-skills/skills/grilling/SKILL.md` and
  `grilling/agents/openai.yaml` beside it. No repository edits were requested; the native worktree remained clean.
- Actual sandbox `openclaw-sbx-workspace-dad8a3301ae00a5845af3bd8a668b4b4`
  has exactly two mounts: its own projected worktree (rw) and native skills (ro).
  A direct read check passed for both files. A write probe in the skill directory
  was denied. Gateway PEM path, Docker socket and `/workspaces/repositories`
  were absent. Other task worktrees were not mounted.
- Isolated runtime-image checks with the exact config path selected exercised
  missing and empty extra-root directories. Both exited successfully and listed
  zero extra skills. Initial attempts without selecting the image config failed
  with unknown coding agent, and were not counted as skill behavior evidence.
  A config override inside the running Gateway did not isolate its active skill
  catalog; only the separate containers qualify the missing/empty cases.

## Scope

Verified native top-level directories with SKILL.md frontmatter and a supporting
YAML file. Hidden/system packs and nested distribution formats were not qualified.
No claim is made that Codex-specific skill instructions, external tools, scripts,
network access or third-party services are available in this sandbox. Assigned-
issue tool visibility remains a separate investigation. Skill management UI is
later scope.


Local direct configuration fixtures could not launch the native CLI (first PATH,
then sandbox EPERM); use the pinned checks container against the source mount for
native configuration validation. These local environment failures are not treated
as product or skill-discovery failures.
The pinned checks container validated the current source configuration and coding
example successfully. Compose validation passed, and the persistent Gateway is
healthy with the skills mount active.
