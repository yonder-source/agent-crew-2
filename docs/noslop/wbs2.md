# WBS2 — Focused repository restrictions

Status: planned. Depends on WBS1.

## Deliver

1. Use ESLint's existing API/import restrictions for demonstrated risks:
   dynamic execution, shell construction, private SDK imports and production
   imports from test or historical material. Scope fixture exceptions locally.
2. Check whether those restrictions cover actual import forms. Use an existing
   dependency graph package only if a concrete transitive or resolved-path gap
   requires it; record the example before selecting a tool.
3. Reuse OpenClaw validation and `docker compose config`. Add small assertions
   for actual deployment requirements such as loopback published ports,
   intended tool/plugin settings and version compatibility.
4. Add custom code only where existing tools cannot express a required check.
   Ship passing/failing tests and useful diagnostics with that code.

## Acceptance

Run shared checks. Demonstrate rejection of a representative forbidden API or
import and an unsafe configuration mutation in isolated fixtures. Confirm
existing synthetic I/O and VM tests work with their specific exceptions.
Validate the resolved Compose model without changing external deployments.
Record reusable restrictions separately from Agent Crew settings.
