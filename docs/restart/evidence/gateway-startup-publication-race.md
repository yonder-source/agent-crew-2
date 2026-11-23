# Gateway startup publication race — 2026-11-23

## Reproduction and diagnosis

After deploying the App-token changes, `tools.invoke` for `agent_crew_status`
with `sessionKey=agent:main:main` failed with `UNAVAILABLE` and
`agent-database-inspection-failed`. The reason was `prepared model runtime
publication was superseded`, accompanied by the generic `doctor --fix` hint.
Repeated native restarts reproduced the failure, including with no CLI requests
until HTTP startup completed. HTTP health and GitHub read access still passed.

Read-only `openclaw doctor --session-sqlite inspect --session-sqlite-agent main
--json` reported integrity `ok`, four entries and no issues. No database reset or
manual Doctor repair was performed. The existing container entrypoint itself
runs Doctor during startup.

Temporary stack probes in the pinned OpenClaw bundles established this sequence:

1. Background agent database admission reached its `models` publication phase.
2. `publishConfiguredModelRuntimeSnapshots` in the Gateway sidecar started a
   second refresh and invalidated the first owner generation.
3. The first build threw `PreparedModelRuntimePublicationSupersededError`.
4. Startup retries recognized only `AgentDatabaseStartupSupersededError`, so the
   model exception escaped into a retained database-admission refusal.

This directly identifies an OpenClaw startup race. The App-token expiry code is
not on this failing path. A trial adding `joinSupersedingPublication` suppressed
the original exception but still failed the final published-owner assertion;
that trial was discarded.

## Fix

The build-time patch in `scripts/patch-openclaw-startup.mjs` catches only the
exact runtime publication-supersession class around the startup model refresh,
and translates it to the startup supersession class. The existing maximum of
four startup publication attempts owns retry. Other errors and final
publication/admission assertions remain unchanged.

The patch requires the exact original SHA-256 of `gateway-prewarm.js` from the
pinned upstream image and unique replacement anchors. A version or bundle change
fails the build until the patch is reviewed. It applies to the shared Gateway
base used by checks and runtime; the coding sandbox target remains upstream.

All temporary stack probes were removed. A native restart with the trial fix
restored the main-agent status RPC, preserving issue #2 job
`b50763bd-5410-4484-ba17-2a312e9c150a` and delivery commit
`db3fc8db90fd77d079b24ac618e6437e159ba377`, including its exact session, run,
workspace, branch, base and structured validation binding.

## Rebuilt deployment verification

Rebuilt and recreated the persistent Gateway with image
`sha256:638c1bae9ea7df3340f1c05c82526a0b4f84dcddec093c3160acb76c741a0463`.
The build accepted the exact upstream source hash and applied the patch; the
installed bundle also passed Node syntax checking. The new container contains
the image patch, rather than temporary debug modifications.

Native status RPC again verified the complete retained issue #2 binding. Session
inventory returned all 11 sessions, none active, and polling running without a
blocking reason. Docker health was `healthy`. The installed App client repeated
two successful repository reads and two issue reads, issuing eight fresh tokens
with future expiries. No issue write, new coding task, push or PR was invoked by
this verification. These checks exercise startup and retained data, not a new
model coding turn.
