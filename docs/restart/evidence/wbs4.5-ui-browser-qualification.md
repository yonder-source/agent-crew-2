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
