# Restart handoff

This directory is the handoff package for a new repository. Copy its contents
together so the links remain valid. The [specification](spec.md) owns the MVP
requirements; [WBS0](wbs0.md) records the decisions and feasibility findings,
and [WBS1](wbs1.md) is the first implementation package. The remaining WBS
documents describe subsequent work. [Outstanding items](outstanding.md)
captures proposed solutions and deferred questions.

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
The restart specification and WBS take precedence over these historical records.

Source: Agent Crew repository, commit `585a21b`, plus the locally excluded
restart research and probe artifacts copied into this package. The historical
ADRs retain their original decisions; references to documents outside this
package are described as original-repository context.
