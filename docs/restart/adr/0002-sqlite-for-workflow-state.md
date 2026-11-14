# Use SQLite for v1 workflow state

Status: Accepted · Date: 2026-11-01

Use SQLite for Controller workflow state on the initial single-host
installation.

The expected workload does not justify operating a separate database service.
SQLite keeps deployment small at the cost of serialized writes and downtime
when the host fails.

Reconsider a client/server database if measured contention, multiple active
writers or multi-host availability become requirements.

Related documents in the original repository: state storage, backup and recovery.
