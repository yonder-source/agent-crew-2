# Restart handoff

This directory is the restart handoff package. [`spec.md`](spec.md) is the
bootstrap plan for the restart WBS; root [`SPEC.md`](../../SPEC.md) was
initialized from it and evolves as the WBS work settles requirements and
decisions. This package also preserves restart-specific evidence, implementation
packages and historical context. [WBS0](wbs0.md) records feasibility findings,
[WBS1](wbs1.md) is the foundation package, [WBS2](wbs2.md) is the dispatcher
package, and [WBS3](wbs3.md) adds GitHub discovery and assigned issue access.
[WBS4](wbs4.md) adds real coding, [WBS4.5](wbs4.5.md) adds the repository
connection UI, [WBS5](wbs5.md) adds draft PR publication, and [WBS6](wbs6.md)
completes Slack reporting and workflow acceptance.
[Outstanding items](outstanding.md) captures proposed solutions and
deferred questions.

The [evidence](evidence/) includes the restart research, the native workflow
probe report, and the Lobster prototype with its scripts. The probes used
disposable environments and synthetic inputs; their reports describe what was
and was not demonstrated. They are not a turnkey environment or MVP acceptance.
The native workflow report records observations but has no corresponding
standalone harness in this package.

The [historical ADRs](adr/) preserve earlier decisions and rationale. ADR 0001
is relevant context for using OpenClaw with Controller capabilities, while the
restart revisits Controller placement. ADRs 0002 and 0003 describe the earlier
SQLite and writer model; they do not establish a SQLite or writer requirement
for the restart. Revisit them if additional durable application state is needed.
The root specification owns current requirements; WBS files define package
work. Historical ADRs do not override either.

Source: Agent Crew repository, commit `585a21b`, plus the locally excluded
restart research and probe artifacts copied into this package. The historical
ADRs retain their original decisions; references to documents outside this
package are described as original-repository context.
