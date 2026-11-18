# Coverage inventory

WBS1–3 enable the tooling, restrictions and regressions below. WBS4 authority
checks remain planned; executable configuration owns rule details.

| Area | Existing evidence or configuration | Remaining delivery |
| --- | --- | --- |
| Type safety | `tsconfig.json` enables strict mode and three additional flags; `eslint.config.mjs` enables recommended typed rules and unsafe-assertion rejection; `src/index.ts` guards unknown inputs | WBS1 delivered; extend alongside new source |
| Async work | Typed preset rejects floating/misused Promises; dispatcher serializes admission and awaits state writes | WBS3 exercises failed writes and uncertain results |
| JavaScript and tools | `eslint.config.mjs` covers JS/TS module extensions and declarations; `scripts/check-lint.mjs` exercises actual CLI rejection and safe equivalents | WBS1 delivered; JS syntax/scope rules, TS typed rules |
| Node APIs and imports | Native ESLint API/import restrictions, named CLI/VM exceptions and real lint fixtures | WBS2 delivered; indirect data-flow analysis is outside syntax rules |
| Deployment | Native OpenClaw validation plus resolved Compose assertions and mutation fixtures in `scripts/check-deployment.mjs` | WBS2 delivered; no external deployment changes |
| Inputs and public output | Mocked Gateway and Lobster envelopes, continuation canaries and public projection checks | Extend with future capabilities |
| Errors and secrets | Config validation plus mocked Gateway errors and stored-error canaries | Extend with future capabilities |
| Persistence and recovery | Mock write failures and lost responses; native synthetic restart, duplicates, SIGKILL and operator decisions | Extend with future capabilities |
| CI and review | `.github/workflows/ci.yml` runs `scripts/check-all.sh`; Docker checks run lint, acceptance fixtures, type/config and boundary checks from locked tooling | WBS4: actual merge/authority settings |

## Scope and intentional fixture operations

Lint application source, scripts and JavaScript workflows. Include supported
module extensions and declaration files explicitly. Keep generated output and
installed dependencies outside lint inputs. Use validators for JSON, Compose
and workflow configuration, and shell syntax checks for shell entry points.

The baseline active inputs are `src/index.ts`, `src/config.mjs`,
`src/config.d.mts`, the five `scripts/*.mjs` checks and
`infra/local-dev/openclaw/workflows/synthetic-issue.mjs`. Archived JavaScript
under `docs/restart/evidence/lobster-prototype/` is retained evidence, not a
product integration check; include it in basic JavaScript lint coverage.

The existing VM fixture loads built dispatcher code. Config checks and Docker
health probes use fixed Node invocations. Synthetic workflows write under their
fixture root. Local checks use disposable Gateway credentials. Evaluate each
operation when enabling the applicable restriction; document narrow exceptions
next to that restriction and verify it still catches relevant misuse.

## Evidence scope

The boundary script is a mock-based integration fixture. Gateway, session and
dispatcher scripts run against a disposable native installation with synthetic
workflows. Record these scopes separately from future live GitHub/Slack
acceptance. Authorization and uncertain effects need behavioral evidence.
