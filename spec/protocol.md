# Command protocol

## Shared path

The desktop UI reaches the Node backend through the Tauri sidecar. `tasks-cli` converts shell arguments into the same `executeCommand` path. The development HTTP bridge is local-only and also calls that path. Android has its own command engine and does not execute this Node protocol implementation.

The sidecar reads and writes one JSON object per line. A request has this shape:

```json
{
  "version": 1,
  "requestId": "request-123",
  "command": "task.update",
  "args": {"id": "task-id", "expectedVersion": 4, "title": "Review release"},
  "actor": {"kind": "agent", "label": "release-agent"},
  "idempotencyKey": "stable-retry-key"
}
```

`actor` may be omitted by a legacy client; the parser supplies `{kind:"agent",label:"cli"}`. `kind` is `human`, `agent`, or `system`, and `label` is nonempty. `requestId` correlates a response and is not an idempotency key. Optional `readOnly` and `dryRun` flags request a non-persisting preview where the command supports one.

Success returns the same protocol `version` and `requestId`, `ok: true`, and a command-specific `result`. Failure returns `ok: false` and an `error` with a stable `code` and a human-readable `message`. Clients should branch on `code`.

## Write safety

Task mutations use idempotency keys. Repeating the same successful request with the same key returns its recorded result; reusing a key with different request content fails with `IDEMPOTENCY_KEY_REUSED`. Existing-task edits require the current `expectedVersion`; a stale token fails with `STALE_TASK_VERSION`. Re-read and resolve the conflict rather than retrying with a fresh key or stale version.

Versions, activity, and receipts are local cache state, not canonical task-file fields. Rebuild or restore can invalidate old versions. Workspace locks serialize cooperating Node clients but do not prevent edits by unrelated programs that bypass the lock.

## Command catalog

The command names accepted by protocol v1 are implemented in `src/backend/protocol.ts`. Their current query behavior is in [Queries](queries.md); current writes and workspace operations are in [Mutations](mutations.md). The friendly CLI exposes only a subset and maps them to these same commands; see [CLI](cli.md).

A few current errors include `INVALID_REQUEST`, `UNSUPPORTED_VERSION`, `UNKNOWN_COMMAND`, `INVALID_ARGUMENT`, `TASK_NOT_FOUND`, `EXPECTED_VERSION_REQUIRED`, `STALE_TASK_VERSION`, `IDEMPOTENCY_REQUIRED`, and `IDEMPOTENCY_KEY_REUSED`. Registry-specific errors and behavior are documented in [Sources](sources.md). Android has additional platform-specific unsupported-command errors.
