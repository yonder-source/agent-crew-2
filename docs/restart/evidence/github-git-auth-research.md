# GitHub App authentication for Git operations

Research date: 2026-11-20

## Findings

- GitHub supports an installation access token as the HTTPS Git password, with `x-access-token` as the username. The installation needs repository Contents permission. GitHub's example embeds the token in the clone URL, but doing so risks persisting it in the clone's remote configuration or exposing it in process arguments. [GitHub: authenticating as an installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- Installation tokens expire after one hour. GitHub supports narrowing a token to selected repositories and permissions; Octokit can generate and renew installation tokens. [GitHub: generating an installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- Git supports an external credential helper and invokes it for `get`, `store`, and `erase`; a helper may ignore unsupported operations. An empty `credential.helper` resets previously configured helpers, and `credential.useHttpPath` makes HTTP credential matching include the repository path. [Git credentials](https://git-scm.com/docs/gitcredentials)
- Git supports process-scoped configuration through `GIT_CONFIG_COUNT` and `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`; `GIT_TERMINAL_PROMPT=0` disables terminal prompts. [Git config](https://git-scm.com/docs/git-config), [Git environment](https://git-scm.com/docs/git)

## Recommendation for implementation

The Controller obtains an installation token just before each authenticated HTTPS clone, fetch, or push, scoped to the selected repository and minimum permissions for the operation where GitHub permits. Keep the remote URL credential-free. Supply the token through a Controller-owned, read-only credential helper over a short-lived local IPC channel; have the helper return `x-access-token` and the token only for the exact approved HTTPS host and repository, ignore `store` and `erase`, and reject other requests. Clear inherited credential helpers for the Git process and configure only this helper with path matching; disable interactive prompts and inherited tracing. The IPC mechanism and peer access controls need implementation validation. Avoid putting the token in a URL, command arguments, Git config, logs, or the coding sandbox.

Using an environment variable to pass a token to a helper avoids command arguments and persistent Git config, but process environments can be visible to sufficiently privileged local processes and inherited by children. A protected short-lived IPC channel reduces unnecessary exposure; it does not protect against compromise of the Controller or host. Redact errors and verify credential handling with failure cases, including clone remote configuration, log output, helper scope, expiration, and token issuance failure.

Fetch or clone needs Contents read; push needs Contents write and remains subject to repository rules. A successful permission check does not prove a future push will succeed. An authentication failure can request a new token for a subsequent operation; do not blindly retry a push after an ambiguous transport failure because the remote may already have accepted it.
