# WBS2 — Focused repository restrictions

Status: planned. Depends on WBS1.

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

## Candidate risk mapping

Confirm rule behavior against the installed ESLint version and fixtures before
choosing a rule; these candidates do not claim to cover aliases or wrappers.

| Risk | Candidate native restriction |
| --- | --- |
| Dynamic code execution | `no-eval`, `no-new-func`, `no-restricted-syntax` |
| Shell construction | `no-restricted-imports`, `no-restricted-properties`, `no-restricted-syntax` |
| Private SDK import | `no-restricted-imports` |
| Production import from test or historical material | `no-restricted-imports` |

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
