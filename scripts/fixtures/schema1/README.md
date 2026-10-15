# Schema 1 fixture

`sync/` is a TaskDB/Tasks v1 workspace produced by the existing `executeCommand` path. It contains four synthetic tasks: a P1 `@planning` parent, an `@planning` child depending on it, a completed uncategorized task, and a paused `@operations` task. The task/order files have valid v1 hashes. There is intentionally **no SQLite cache or `.tasks-local/`**: an implementation must rebuild local state from these files.

Use a new scratch directory and **copy** `sync/` before any write. Never point these checks at personal data.

```bash
pnpm build:backend
scratch="$(mktemp -d -t tasks-fixture-XXXXXX)"
mkdir -p "$scratch/primary"
cp -a scripts/fixtures/schema1/sync "$scratch/primary/sync"
TASKS_DATABASE_PATH="$scratch/primary/tasks.db" node dist/backend/tasks-cli.js list --json
# Expect four tasks with the described categories/statuses; clean up only $scratch afterward.
```

`scripts/taskdbConformance.test.mjs` now exercises disposable copies through the JSON-lines sidecar and `tasks-cli`: v1 read/write, stale and duplicate-key behavior, graph cycles, cache-loss rebuild, conflict-copy detection, and snapshot restore. `scripts/platformParity.test.mjs` covers the Android behaviors it actually supports, including P0/P4 and status transitions, and pins its partial-update and restore limitations. The static fixture is not a portable export or a proposed 2.0 format.
