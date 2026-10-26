# Schema 1 fixture

`sync/` is a TaskDB/Tasks v1 workspace. It contains four synthetic tasks: a P1 `@planning` parent, an `@planning` child depending on it, a completed uncategorized task, and a paused `@operations` task. The task/order files have valid v1 hashes. There is intentionally **no SQLite cache or `.tasks-local/`**: an implementation must rebuild local state from these files.

Use a new scratch directory and **copy** `sync/` before any write. Never point these checks at personal data.

Only the owner-only [migration tool](../../../docs/migration.md) reads schema 1; the normal Tasks CLI does not. The static fixture is not a portable export or a proposed format.
