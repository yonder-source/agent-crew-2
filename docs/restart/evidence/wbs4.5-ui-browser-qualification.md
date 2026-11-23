# WBS4.5 native browser acceptance

2026-11-23. Chromium connected to the deployed OpenClaw `2026.11.3` Gateway
at `http://127.0.0.1:18789`, using the actual Control UI operator connection,
native plugin assets and `host.request` transport. No mock host or RPC responses
were used. The deployed image was
`sha256:c7082e58f9bab060e75faeae424d36c375b273f72489ff9b1643432da65afd12`,
from repository commit `3fac835`.

## Entry and prerequisites

Open `/plugin?plugin=agent-crew&id=setup` on the connected Gateway's Control UI
origin. Authenticate as an operator with `operator.admin`, and enable Settings →
Labs → Custom plugin UI. Use HTTPS or browser-trusted loopback for authenticated
native plugin assets. Provision the GitHub App private key and Slack bot/app
secrets through the existing Gateway mounts; the page accepts no secret values.
See the [native UI/configuration evidence](wbs4.5-ui-config-qualification.md) and
[Slack credential readiness evidence](wbs4.5-slack-credential-readiness.md).

## Executed browser flow

- The native page loaded the configured agent roster and retained settings for
  `yonder-source/disposable-test-repo`, its checkout, coding/designer Slack roles,
  and an empty token budget. Slack credential status reported both mounted files
  available without returning their contents.
- **Load repositories** called the real GitHub App discovery path and returned
  five accessible repositories, with the selected disposable repository bound to
  installation `177772976`. Its source path remained
  `/workspaces/repositories/yonder-source/disposable-test-repo`.
- **Save** retained the draft and automatically validated it. The page displayed
  GitHub repository read access, matching checkout remote, configured agents,
  active Slack channels with bot membership, and active authorized human users.
  It separately displayed granted write permissions and unverified publication
  outcomes. Successful validation enabled **Apply**.
- **Apply** exercised the real Controller validation, repository preparation and
  scheduling guard with the current connection. It returned
  `Connection is already active; scheduling checks passed.` Scheduling remained
  Running. This was an unchanged-connection Apply, not a browser-driven switch to
  a different repository or a new checkout.
- Editing the token budget immediately disabled Apply. Saving `0` displayed
  `Failed: Token budget must be a positive safe integer or empty.` and kept Apply
  disabled. Restoring the empty value and saving again passed validation and
  enabled Apply. The active configuration retained no token budget throughout.
- Reloading the page preserved the restored draft and repository. Apply remained
  disabled until fresh validation, rather than trusting a previous page's result.
- At viewport widths 780px and 390px, document scroll width equalled viewport
  width. At 390px the App ID/load button group fit within the form (330px wide,
  button right edge 355px); the native page had no horizontal overflow.

## Restart and scope

The persistent Gateway was gracefully restarted after saving the restored draft.
After health returned, the browser reloaded the native page and confirmed the
selected repository, coding channel and empty token budget remained saved.
Scheduling resumed automatically as Running; Apply required fresh validation.
Native Slack status separately confirmed Socket Mode connected with a successful
probe. Existing issue 2 and issue 4 completed deliveries remained intact,
including issue 2 head `db3fc8db90fd77d079b24ac618e6437e159ba377`.

The browser exercised real GitHub reads and Slack validation, but performed no
GitHub push, issue write or PR creation. Changed-connection configuration writes,
active/uncertain-task rejection and authorization tests retain their separate
native RPC/fixture evidence; this browser run does not replace those checks.
Designer role validation does not establish designer execution or inbound routing.

## Changed settings and inspection guard — 2026-11-23

A subsequent native browser run saved token budget `10000000`. While disposable
issue 6 was retained as `needs-inspection`, validation succeeded but Apply was
rejected before changing the active configuration. Save therefore remained a
pending draft and did not bypass the task guard. The issue's real model had
finished without running its requested timer; this was not timeout acceptance.
After confirming its native run stopped, the operator abandoned that test and
removed its ready label.

Fresh validation and Apply then saved the changed budget. The page reported
runtime activation pending; a native current-settings read after reload reported
`tokenBudget="10000000"`, matching the durable configuration file. The page
retained that value on reload. Scheduling initially remained paused, and the
native page's Resume scheduling control restored it after safety checks.

The same browser then saved and applied an empty budget. The active runtime and
saved draft both reported `tokenBudget=""`, and polling returned to Running
with `activationPending=false`. This exercises a real configuration change and
restoration, rather than only the unchanged-connection fast path. It does not
change the selected repository, clone a second source checkout, or enable any
publication action.

## No-draft startup regression

The current-settings RPC omitted `githubAppId` and `installationId`, so a page
without a retained draft could not prefill the complete existing connection.
A Controller fixture with an absent draft reproduced the missing App ID; commit
`0ae0284` adds the non-secret identifiers to current settings and covers App-mode
and legacy-token configurations.

A separate fresh native Gateway using the corrected image had no retained draft,
no mounted secrets and fixture App/installation/repository identifiers. The real
RPC returned `draft=null`, App ID `1234` and installation `17`. Chromium loaded
its actual native plugin page and confirmed App ID `1234`, repository
`fixture/repository` and the configured source path were prefilled without
repository discovery or saving a draft. This is native browser integration with
fixture connection data, not GitHub access acceptance. The isolated Gateway
was stopped after the check. Live GitHub reads are qualified above using the
persistent Gateway's actual connection.
