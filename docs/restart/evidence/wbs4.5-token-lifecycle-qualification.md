# WBS4.5 App token lifecycle — 2026-11-23

## Selected behavior

App-mode operations create fresh installation tokens on demand. The Controller
does not cache a token or wait for a renewal timer. Repository discovery uses
installation-level Contents read to enumerate accessible repositories; final
clone/fetch and issue-operation tokens are restricted to the selected repository
and Contents read or Issues write respectively. Legacy token-file mode remains
manually provisioned and does not gain automatic issuance.

The issuer now parses `expires_at` and rejects invalid, missing or already-expired
values before returning a token. Invalid expiry produces a safe
`GITHUB_RESPONSE_INVALID`; expired tokens produce `GITHUB_TOKEN_EXPIRED`. The
issue provider maps acquisition failures to `GITHUB_CREDENTIAL_UNAVAILABLE`
before dispatching an issue write. No token, PEM or raw transport error appears
in these failures.

The existing provider acquires credentials again for a later operation. It never
retries a failed issue write as part of credential recovery. A known authorization
failure remains rejected; a transport failure after dispatch remains uncertain
and retains the existing operator-inspection boundary.

## Fixture evidence

Built the current source and passed ESLint, the repository-connection fixtures
and WBS3 fixtures. New integrated App-client/issue-provider cases cover:

- Expired and unparseable returned expiry values.
- Issuance HTTP 401, 403, 500 and transport failure; exactly one scoped issuance
  attempt and zero issue writes per failed operation.
- A missing key followed by restored credential access using the same client.
- Later successful operations acquiring fresh tokens after failure, rather than
  reusing a previous token.
- Issue-write HTTP 401 and transport failure after successful acquisition;
  exactly one write attempt, no automatic credential-refresh replay, and distinct
  rejected/uncertain results with secret details redacted.

These fixtures inject expired responses and failures. They do not wait for a real
token to expire or rotate/revoke the deployed App key.

## Live evidence and operator documentation

Loaded the newly compiled `GitHubAppClient` as a temporary module in the existing
Gateway, using its existing read-only PEM mount and configured disposable
repository. The installed plugin and Gateway configuration were not replaced.
Token values stayed inside that process; only expiry, requested scopes and read
outcomes were printed.

Two repository GETs returned HTTP 200 and two calls through the actual issue
provider read open issue #1 from `yonder-source/disposable-test-repo`. These four
operations issued eight tokens: four installation-level enumeration tokens and
four final repository-scoped tokens (two Contents read, two Issues write).
Every expiry parsed as future; GitHub reported expiry timestamps from
`2026-11-23T09:19:24Z` through `2026-11-23T09:19:31Z`. This establishes live fresh
issuance and read access for both operation paths. No issue PATCH, branch push,
PR creation or token/key revocation was performed.

The README now distinguishes unattended App mode from the legacy token-file
example. It documents the App owner's installation/grant/revocation duties and
the deployment operator's secret delivery, safe Gateway recreation, connection
validation and PEM rotation duties. GitHub permits overlapping keys for rotation;
validate the replacement before revoking the old key. A single-file Docker bind
must be refreshed by container recreation after an atomic host-file replacement.
No key was generated, replaced or revoked during this qualification.

Primary sources:

- [GitHub installation access tokens and expiry](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
- [GitHub App private keys and rotation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

## Persistent Gateway deployment

Deployed runtime image `sha256:1149e6f77faf39653d6e474fe40fed6a56ba3437ff7dfec5da9f413acdf927bd` using the existing Compose configuration. Previous image is retained as `agent-crew-openclaw:before-token-lifecycle-20261123`; configuration backup is under `.local/deployment-backups/token-lifecycle-20261123/`. No configuration or PEM replacement was made.

The installed `/app/extensions/agent-crew/dist/github-app.js` passed the same four live read operations, with eight fresh issuances and future expiries from `2026-11-23T09:31:31Z` through `09:31:37Z`. HTTP health and polling recovered.

Initial deployment acceptance was blocked: main-agent RPC reports `prepared model runtime publication was superseded`, including after a restart with no CLI calls until HTTP startup completed. The issue-2 delivery retention RPC therefore could not be verified. Read-only `openclaw doctor --session-sqlite inspect --session-sqlite-agent main --json` reports integrity `ok`, four entries and no issues. The runtime recommended `openclaw doctor --fix`, but investigation identified a startup model-publication race. A narrow build-time compatibility patch restores the existing bounded startup retry without resetting agent data; see [diagnosis](gateway-startup-publication-race.md). The initial image above was superseded by the patched image recorded in that report.
