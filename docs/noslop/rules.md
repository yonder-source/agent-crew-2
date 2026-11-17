# Coverage inventory

Planned checks below are not yet enabled. Update this map
when delivery changes coverage; executable configuration owns rule details.

| Area | Existing evidence or configuration | Remaining delivery |
| --- | --- | --- |
| Type safety | `tsconfig.json` enables strict mode; `src/index.ts` validates session fields but uses assertions | WBS1: typed preset, targeted assertion rule, compiler flag assessment |
| Async work | Dispatcher serializes admission and awaits state writes | WBS1: floating/misused Promise rules; WBS3: failure behavior |
| JavaScript and tools | `src/config.mjs`, `scripts/*.mjs`, workflow `.mjs` execute in existing checks | WBS1: explicit lint coverage, including declarations and module extensions |
| Node APIs and imports | Public OpenClaw SDK imports; VM boundary fixture; fixed synthetic file I/O | WBS2: focused restrictions with local fixture exceptions |
| Deployment | Pinned Docker image; local Compose; OpenClaw config validation | WBS2: resolved settings and intentional exposure/permission assertions |
| Inputs and public output | `scripts/check-dispatcher-boundaries.mjs` uses mocked Gateway responses and continuation canaries | WBS3: missing malformed-envelope, error and public-output cases |
| Errors and secrets | `scripts/check-config.mjs` checks parsing and native config validity | WBS3: missing secret-canary and uncertain-effect cases |
| Persistence and recovery | `scripts/session-roundtrip.mjs`, `scripts/check-dispatcher.mjs` exercise restart, duplicates, SIGKILL and operator decisions | WBS3: missing persistence-failure and low-privilege denial cases |
| CI and review | `.github/workflows/ci.yml` runs `scripts/check-all.sh` | WBS1: new checks in same entry; WBS4: actual merge/authority settings |

## Scope and intentional fixture operations

Lint application source, scripts and JavaScript workflows. Include supported
module extensions and declaration files explicitly. Keep generated output and
installed dependencies outside lint inputs. Use validators for JSON, Compose
and workflow configuration, and shell syntax checks for shell entry points.

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
