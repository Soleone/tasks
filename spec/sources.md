# Sources and source-scoped references

**Legacy default (implemented; removed at `dvs`).** No replacement source-registry contract; see the [front door](overview.md).

This document records the source behavior currently implemented by the Node backend. It is an opt-in extension to the single-workspace path, not a replacement for canonical v1 task files.

## Default mode

With `TASKS_SOURCE_REGISTRY_PATH` unset or empty, Node commands use the normal single workspace. Existing task IDs and requests remain valid. `source.list` returns an empty `sources` array. Other requests containing `ref`, `sourceKey`, or `sourceKeys` fail with `SOURCE_REGISTRY_REQUIRED`. Android remains single-workspace and does not use the Node source registry.

## Registry mode

Set `TASKS_SOURCE_REGISTRY_PATH` to a local JSON file. The current registry accepts 1–32 TaskDB v1 sources:

```json
{
  "format": "tasks.source-registry",
  "formatVersion": 1,
  "defaultSourceKey": "personal",
  "sources": [
    {"key":"personal","label":"Personal","databasePath":"./personal/tasks.db","syncRoot":"./personal/sync"}
  ]
}
```

Paths resolve relative to the registry file. `syncRoot` is optional and defaults to `sync/` beside that source's database. Keys are 1–128 characters, start with an ASCII letter or digit, and otherwise use letters, digits, `.`, `_`, or `-`. `defaultSourceKey` is optional and, when set, must identify a registered source. Repeated database paths or roots fail during registry loading; distinct roots with the same workspace identity fail when mounted.

## Task identity and routing

Inside one canonical workspace, identity remains `workspaceId + id`. In combined Node query results, `TaskRecord` may include `ref: {sourceKey, taskId}` so a client can route a later operation. The ref and registry key are controller metadata; neither is written into canonical task files.

The current controller aggregates `task.list`, `category.list`, `tag.list`, `workspace.info`, and `workspace.sync`. `source.list` reports each source's key, label, and task capabilities: list/get/create/update/start/pause/complete/reopen/cancel/parent/dependencies are true; combined TaskRef `reorder` is false. A combined `task.list` filters each selected source, merges results, and paginates the merged list. Its limit is 1–100 (default 50), offset is nonnegative (default 0), and an explicit nonempty `sourceKeys` array selects sources. Created/updated/priority sorts use source key and task ID as stable tie-breakers; manual sort keeps each source's sibling-tree order and groups sources by key. New tasks go to `defaultSourceKey` unless an explicit `sourceKey` is supplied. Targeted get/update/status/delete/move/dependency operations can use a ref or an explicit CLI `--source-key`. A write that cannot identify its source in a multi-source registry fails rather than guessing (`SOURCE_REQUIRED`); an unknown key fails with `SOURCE_NOT_FOUND`.

Parent, dependency, and manual-order relationships stay within one source. Cross-source moves are not implemented. `task.reorder` can still run against one source using source-local IDs, but the combined controller does not accept TaskRefs for reorder. Registry-wide task queries, categories, tags, workspace info, and sync aggregate; other commands are routed to one source only when a `sourceKey` is explicit or the registry has a single source. Otherwise they fail with `CAPABILITY_UNSUPPORTED`. The first-party UI is not source-ref-aware. The implementation accepts only TaskDB v1 roots, not TaskNotes, `sq`, or other external systems.

## Current entry points and limits

| Surface | Registry support |
| --- | --- |
| Node JSON-lines sidecar | Yes, through `TASKS_SOURCE_REGISTRY_PATH`. |
| `tasks-cli` | Yes, through the same variable; `sources` lists mounts and `--source-key` selects a source. |
| Local development bridge | Calls the Node command path, but the first-party UI is not source-ref-aware. Do not enable the registry for normal UI use. |
| Tauri desktop UI | Single-workspace behavior only. |
| Android | Separate single-workspace engine; no registry support. |

The broader multi-source v0 contract is a retired proposal (see git history at `fab9256:ideas/multi-source-v0-contract.md`). Only behavior implemented and exercised here is part of this current-state spec.
