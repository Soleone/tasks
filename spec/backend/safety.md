# Safety

Tasks never pretends a write succeeded or invents data to fill a gap. Reading never brings back a deleted file; an explicit [redo of an undone create](rules.md#redo) can restore its retained task. When something is uncertain, Tasks stops and keeps what it needs for a person to decide.

## Observing the folder

| Rule | Then |
| --- | --- |
| `observe.complete` | A read lists every task file, parses all of them and checks the whole graph. Anything less is incomplete and grants no write authority |
| `observe.bytes` | Change detection hashes the exact file bytes (SHA-256). A file whose identity, size, modified and change times all match the previous read keeps that read's hash; anything else, and any file changed within a few seconds of being read, is hashed again. Reformatting counts as a change |
| `observe.no-resurrect` | A file that disappears is gone from the cache too. Reading never recreates it |
| `observe.stale-view` | After an incomplete read, a client may show the last good view, clearly marked stale, but can't write from it |

## Writing

| Rule | Then |
| --- | --- |
| `write.lock` | Writers on one device share a lock for the folder. Syncthing and text editors don't, so a racing external edit can be overwritten; preserved conflict copies and backups cover that |
| `write.validate-first` | All effects are checked before the first file changes |
| `write.journal` | Before changing several files, the writer saves a pending record outside the folder with the old and new bytes, fixed IDs, keys and times. Creating or editing one task needs none: its rename is atomic |
| `write.guard` | Each replacement first checks the file and its sibling set are still as observed |
| `write.verify` | Final bytes and the graph are verified before the receipt is stored and success is returned |
| `write.copy-first` | Anything destructive copies the original outside the folder first |
| `write.no-distributed-atomicity` | Other devices may briefly see half of a multi-file change. Tasks makes no cross-device transaction promise |

## Creating a task

| Rule | Then |
| --- | --- |
| `create.stage-rename` | Create writes a hidden temp file in `tasks/`, rechecks the parent and destination, then renames it into place |
| `create.duplicate-window` | If the process dies after the rename but before the receipt is stored, retrying the same request can create a duplicate. This is accepted |
| `create.orphan-stage` | A leftover temp file is never adopted, resumed or deleted automatically |
| `create.unrelated-changes` | Unrelated edits during capture don't abort it |

## Editing a task

| Rule | Then |
| --- | --- |
| `edit.stage-rename` | An edit writes a hidden temp file in `tasks/`, checks that the folder is still exactly as observed, then renames it over the task file |
| `edit.receipt-window` | If the process dies after the rename but before the receipt is stored, the edit stays applied without a receipt or undo entry, and retrying the same request fails `STALE_TASK_VERSION`. This is accepted |

## Unfinished work

| Rule | Then |
| --- | --- |
| `recovery.pending` | While a pending record exists, ordinary commands fail `RECOVERY_PENDING`. `workspace.info` and doctor inspection still work |
| `recovery.explicit` | `workspace.recovery.resume` finishes the original plan. It never runs on its own |
| `recovery.exact` | Recovery skips files already at their new bytes and applies only to files still at their old bytes |
| `recovery.conflict` | New files, changed files, missing planned files or partial data stop recovery with `RECOVERY_CONFLICT`. It never rolls back another writer or invents a new plan |
| `recovery.retained` | Pending records and recovery copies stay until a person removes them. Nothing expires silently |

## The cache

| Rule | Then |
| --- | --- |
| `cache.outside` | The SQLite cache, receipts, history and journals live outside the folder |
| `cache.rebuildable` | Task data can always be rebuilt from the folder |
| `cache.loss` | Losing the cache loses receipts, undo history and write context. Old requests then fail `STALE_WRITE_CONTEXT`, and uncertain requests are reconciled by hand. No task data is lost |
| `cache.not-copied` | Backups and restores never copy the cache or its authority |
