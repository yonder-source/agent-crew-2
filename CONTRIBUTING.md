# Contributing

Thanks for helping improve **Agent Crew by Yonder Source Studio**.

## Before you start

Align contributions with [`docs/restart/spec.md`](docs/restart/spec.md) and the
acceptance criteria in the relevant WBS document. For substantial changes,
open an issue first to agree on scope and acceptance.

## Pull requests

- Keep each change focused and reviewable; separate unrelated work.
- Explain the user-visible or operational change, its evidence, and any checks
  that were not run.
- Call out behavior that remains unverified, especially synthetic or mock
  evidence that does not establish a real integration.
- Link the relevant issue when one exists. Do not include credentials, personal
  data, or production state in commits, logs, or examples.
- Follow the repository's pull request template when present.

## Local checks

The shared check entrypoint needs Docker Compose and host Node.js. It builds a
pinned checks image and installs development tools from `package-lock.json`
inside Docker; do not install project dependencies on the host. Run it before
opening a pull request:

```sh
./scripts/check-all.sh
```

See the [project README](README.md#commands) for Docker setup and focused check
commands. If the disposable Gateway check reports that port `18789` is already
in use, stop the process using that port and rerun the suite. If lint reports
missing OpenClaw SDK declarations on the host, use the checks image rather than
installing dependencies locally. Rebuild the checks image after changing the
source-file inventory, as described in the README.

For documentation-only changes, review links, paths and rendered Markdown. If
a relevant check cannot be run, explain why in the pull request.

### Narrow lint exceptions

Add an exception beside the rule in `eslint.config.mjs` and scope it to the
specific file and operation that needs it. Include a short reason. Add an
accepted fixture for the intended use and a rejected fixture for a nearby
disallowed use through the actual lint check; assert the expected rule ID for
the rejected case. Do not disable a rule across a directory to accommodate one
file. Upstream rules do not need a duplicate syntax-variant suite; custom
checkers need focused passing and failing fixtures.

## Commit messages

Use Conventional Commits, for example `feat: add issue discovery` or
`docs: clarify local setup`.
