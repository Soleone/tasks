# Commands and adapter boundary

## Current v1 executable path

```text
Desktop UI -> Tauri bridge -> long-lived JSON-lines sidecar -> executeCommand
Agent/shell -> tasks-cli argument parser ------------------> executeCommand
                                                -> workspace lock
                                                -> canonical reconciliation
                                                -> task commands + local cache
```

The existing CLI is an executable entry point, **not** a second implementation of task rules. `src/backend/cli.ts` serves one JSON request and response per line over stdio, correlating `requestId`. `src/backend/tasks-cli.ts` turns shell arguments into the same commands; `--json` prints a result object on success and `{ok:false,error}` on failure, whereas the sidecar uses a versioned response envelope. No HTTP listener is part of the packaged command path. The local web bridge in development is not a public network API. See `src/backend/commands.ts` and [development](../docs/development.md).

A version 1 JSON-lines request has a protocol version, request ID, command, argument object, actor (`human`, `agent`, or `system` with a label), and optional idempotency key, `readOnly` or `dryRun` flags. It does **not** have a source selector today. Illustrative existing update request:

```json
{"version":1,"requestId":"example-update-1","command":"task.update","args":{"id":"task-id","expectedVersion":3,"title":"Review launch @planning"},"actor":{"kind":"agent","label":"planning-agent"},"idempotencyKey":"example-update-key-1"}
```

The response has the same version/request ID, `ok: true` with a result or `ok: false` with `{code,message}`. `src/backend/protocol.ts` parses the envelope; command-specific validation lives partly in task execution. `tasks-cli --help` documents actual shell verbs and flags. The CLI currently resolves a single database through `--database`, then `TASKS_DATABASE_PATH`, then OS app data; the canonical root defaults to `sync/` beside it unless `TASKS_SYNC_ROOT` overrides it.

## Current v1 write guarantees and limits

- Mutations require a stable `idempotencyKey`. Repeating a successful request with the same key and payload replays its stored result; reusing it for a different payload fails with `IDEMPOTENCY_KEY_REUSED`. After an uncertain sidecar/process result, retry with the **same** key rather than issuing a new write.
- Editing an existing task requires `expectedVersion`. A changed task rejects the edit with `STALE_TASK_VERSION`; re-read and resolve the change. `tasks-cli` normally fetches the version before a versioned write, or accepts `--expected-version` from an agent. A read followed by a write can still race and is not an unconditional success guarantee.
- `readOnly` or `dryRun` previews a mutation without committing the requested task edit. Real no-op transitions leave the task version unchanged; they may still record an idempotency receipt. A `task.delete` command cancels rather than permanently erasing the task; `task.purgeCanceled` is explicit permanent cleanup.
- `task.list` is bounded to 1–100 results per page in the Node implementation (default 50). Status, priority, category, tags, search, unblocked, sorting and ancestor context are supported. This currently queries **one** workspace; a missing category argument means no category constraint, not Uncategorized.
- Workspace locking serializes cooperating Node processes against one database path. Android uses its own command engine and SAF staging; its supported commands and recovery guarantees differ. Native files edited concurrently outside a cooperating lock require their own conflict handling.

Tests, not this summary, settle edge cases before the v0 multi-source contract is frozen. Relevant code: `src/backend/{protocol,commands,tasks,taskQueries,tasks-cli,cli,canonicalWorkspace}.ts`, `src/platform/androidBackendEngine.ts` and `scripts/platformParity.test.mjs`.

## 2.0 target: one controller, writable sources

A controller accepts a command/query, consults local source configuration, and returns a normalized projection with an unambiguous source-scoped reference. Combined list queries read from configured sources and merge/filter bounded results. A mutation on an existing task resolves its origin and makes **one authoritative write** via its adapter. Capture uses a configured default source unless explicitly overridden in task details or a CLI selector. No registry means current v1 single-workspace behavior. The exact selector, projection, pagination, version negotiation and registry format remain Stage 2 decisions; do not mistake the example v1 JSON above for the new wire contract.

The v1 workspace implementation is the first adapter; preserve its locking, cache rebuild and canonical write path. An external adapter is not complete unless it can **list, get, create, update, complete and reopen** in the chosen store or report a specifically agreed semantic mapping. If it cannot meet a useful write flow, do not mount it as a normal task source. Optional hierarchy, dependencies, reorder, undo, export and activity are explicit capabilities: unsupported requests fail with a stable error, never a successful no-op or a lossy implicit projection. Keep `done` and `canceled` distinct unless a particular external mapping documents loss and the user consents to it.

Every adapter must state who owns the data, its source ID, task ID mapping, field round-trip rules, expected-version/freshness semantics, retry behavior and cache invalidation. A TaskNotes or sq adapter writes **to that authority**, not into a TaskDB copy. Multiple agents may update the same source: detect stale reads and avoid silent overwrites to the extent supported by its native write mechanism. For a noncooperating file editor with no atomic compare-and-swap, document and test the race that cannot be prevented rather than claiming that an mtime check is sufficient.

A cross-source move is a separate later command with field-loss preview, destination create/verify, origin removal and recoverable retry. It is not implemented by changing the source reference in a cached result. The status of a partial transfer must be visible, since two stores cannot commit together.
