# WBS2 — Focused repository restrictions

Status: complete. Depends on WBS1.

## Deliver

1. Inspect current source, scripts, retained historical JavaScript evidence,
   workflows and configuration before enabling restrictions. For each
   demonstrated risk, use ESLint's native API/import restrictions where they
   express the intended boundary: dynamic execution, shell construction,
   private SDK imports and production imports from test or historical material.
   Do not enable a rule solely because it is available.
2. Prove each restriction with passing and failing fixtures that exercise the
   actual lint configuration and assert the expected rule ID. Keep legitimate
   VM execution, fixed-argument CLI subprocesses and synthetic workflow I/O
   working through narrow path/operation exceptions next to the rule. Do not
   exempt broad directories such as all scripts. Exercise relevant bypass
   forms supported by this repository, including destructured aliases and dynamic
   imports; investigate wrappers when they expose a concrete boundary gap.
3. Check whether native import restrictions cover the actual import forms.
   Consider an existing dependency-graph package only after recording a
   concrete transitive-import or resolved-path bypass that native restrictions
   cannot catch. Add a fixture for that gap before choosing the tool.
4. Validate only the current local Compose and OpenClaw configuration
   requirements. Reuse OpenClaw's native validation and
   `docker compose config --format json`; use small dependency-free Node.js
   assertions for confirmed requirements such as loopback published ports,
   intended tool/plugin settings and version compatibility. Do not change
   external deployments or build a general policy engine.
5. Add a custom checker only for a demonstrated required gap, such as a real
   bypass or resolved-path case that native rules and suitable existing tools
   cannot cover. Include isolated accepted and rejected cases and useful
   diagnostics.

## Implemented risk mapping

`eslint.config.mjs` owns the rules and local named-import exceptions.
`scripts/check-lint.mjs` exercises actual CLI diagnostics and exception paths.

| Risk | Native restriction |
| --- | --- |
| Dynamic code execution | `no-eval`, `no-new-func`, `no-restricted-syntax` |
| Shell construction | `no-restricted-imports` for child_process; `no-restricted-syntax` for shell options |
| Private SDK import | `no-restricted-imports` |
| Production import from test or historical material | `no-restricted-imports` |

Dynamic imports, require loaders and createRequire are rejected; static module
restrictions cover renamed/destructured bindings at import time. Re-exports are
also exercised. No current production import chain requires a dependency-graph
package; direct path restrictions do not establish arbitrary transitive or
data-flow safety. VM exceptions permit only createContext/runInContext; CLI
exceptions permit only each existing helper's spawnSync or execFile import.
Synthetic filesystem I/O needs no exception to these execution/import rules.

`scripts/check-deployment.mjs` consumes native resolved Compose JSON, validates
the current local deployment intent and runs isolated mutation fixtures. The
shared shell entry invokes it before building; OpenClaw schema validation stays
in the existing native configuration check.

## Delivery size

Target 300–600 handwritten changed lines per PR and review splitting above 800,
as described in the [delivery plan](README.md#delivery). If the confirmed scope
exceeds the budget, split it into independently verifiable packages with their
own fixtures and acceptance; retain the remaining confirmed restrictions as
explicit follow-up work.

## Acceptance

Run `./scripts/check-all.sh` and inspect the resolved Compose model. Demonstrate
each enabled restriction with accepted/rejected fixtures against the real lint
configuration, checking expected rule IDs. Confirm existing synthetic I/O and
VM tests work with their specific exceptions. Demonstrate rejection of an
unsafe mutation to a confirmed local Compose/OpenClaw requirement. Record
reusable restrictions separately from Agent Crew settings, and distinguish
fixture, mock, native synthetic and live evidence; this WBS does not claim live
deployment acceptance.

The shared Docker suite passed, including native synthetic restart, SIGKILL,
retry and abandon scenarios. After narrowing VM imports and extending the
exception fixtures, the updated source passed the container lint fixtures,
build smoke-import and mock boundary checks. Resolved deployment assertions
and mutation fixtures also passed. Exact commands and logs are in local
project memory.
