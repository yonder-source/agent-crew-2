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

Run the repository's shared check entrypoint before opening a pull request:

```sh
./scripts/check-all.sh
```

See the project README for setup details. Do not install project dependencies
on the host unless the maintainers document that as an option. For
documentation-only changes, review links, paths, and rendered Markdown. If a
relevant check cannot be run, explain why in the pull request.

## Commit messages

Use Conventional Commits, for example `feat: add issue discovery` or
`docs: clarify local setup`.
