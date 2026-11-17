# WBS1-restart — Dockerized OpenClaw foundation

## Goal

Establish a reproducible Docker-based development environment and a minimal
Agent Crew plugin that runs inside OpenClaw. Demonstrate one native interaction
through the running Gateway. Product behavior is defined in
[the root SPEC](../../SPEC.md).

## 1.1 Container and toolchain

**Work:** Select and record the OpenClaw image digest and matching Node.js,
package manager and plugin SDK versions. Add the smallest Docker-based build and
development commands for a strict TypeScript plugin.

**Done when:** A clean checkout can build the development environment and run
a typecheck inside Docker. The documented commands do not require installing
Node.js dependencies on the host.

## 1.2 Minimal plugin

**Work:** Add the plugin manifest, entrypoint and minimal configuration
validation. Register a small read-only status capability using the selected
OpenClaw API. Keep startup failures understandable and free of secret values.
See [configuration errors](../../SPEC.md).

**Done when:** OpenClaw loads the plugin and its status capability can be
invoked through the Gateway. Plugin startup and shutdown follow the supported
lifecycle.

## 1.3 Native session integration

**Work:** Add one small integration using a disposable OpenClaw session: store
and read synthetic plugin-owned session metadata through the selected native
API. Use a test identity and no external credentials.

**Done when:** A real Gateway call writes and reads synthetic metadata for the
same session, and the metadata remains available after restarting the disposable
Gateway. This is an integration check, not a coding workflow.

## 1.4 Checks and CI

**Work:** Add the smallest useful automated checks for plugin configuration,
status and the implemented session integration. Provide a shared Docker-based
local/CI check and configure pull-request CI.

**Done when:** A clean checkout runs the relevant checks in Docker without
production credentials. Report separately any Gateway integration check that CI
cannot execute.

## 1.5 Developer handoff

**Work:** Document build, start, status, stop, data location and check commands,
including the version and the disposable integration setup. Keep example
configuration free of real credentials.

**Done when:** A developer can follow the documentation to run the foundation
and repeat the session check. Review the resulting package diffs together.

## Handoff

Later workflow packages implement discovery, dispatcher, Controller APIs,
Lobster coding and publication, Slack reporting, sandbox validation and cloud
deployment. Introduce separate application persistence and migrations only
when the workflow demonstrates a need to preserve state beyond the facilities
already available; the native OpenClaw session store is part of this phase.
