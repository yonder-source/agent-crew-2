# Agent Crew repository guidance

- Use Node.js ESM and strict TypeScript; keep OpenClaw SDK usage compatible
  with the pinned `2026.11.3` runtime.
- Keep GitHub credentials in Gateway-mounted secrets. Derive issue access from
  the host-provided session context and validated assignment metadata; never
  accept agent-supplied session or issue identity for assigned-issue actions.
- `SPEC.md` is the current requirements source. WBS packages, handoff notes and
  restart evidence belong under `docs/restart/`; update the spec when a WBS
  settles a requirement or decision.
