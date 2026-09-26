# Disposable canonical v1 fixture

`sync/` is a TaskDB/Tasks v1 workspace produced by the existing `executeCommand` path. It contains four synthetic tasks: a P1 `@planning` parent, an `@planning` child depending on it, a completed uncategorized task, and a paused `@operations` task. The task/order files have valid v1 hashes. There is intentionally **no SQLite cache or `.tasks-local/`**: an implementation must rebuild local state from these files.

Use a new scratch directory and **copy** `sync/` before any write. Never point these checks at personal data.

```bash
pnpm build:backend
scratch="$(mktemp -d -t tasks-fixture-XXXXXX)"
mkdir -p "$scratch/primary"
cp -a scripts/fixtures/taskdb-v1/sync "$scratch/primary/sync"
TASKS_DATABASE_PATH="$scratch/primary/tasks.db" node dist/backend/tasks-cli.js list --json
# Expect four tasks with the described categories/statuses; clean up only $scratch afterward.
```

`docs/taskdb-audit.md` records a separate scratch rebuild and JSON snapshot-restore proof. Stage 2 should turn those assertions into a black-box conformance test, including hash/ordering and old-client access. This fixture is not a portable export or a proposed 2.0 format.
