# TaskDB specification

The root pages in this folder describe behavior implemented in this repository today: the v1 task model, storage, protocol, queries, mutations, CLI, sources, and first-party UI. They are the current-state reference. Aspirational proposals belong in [`ideas/`](../ideas/), not here.

For spec-driven work, first resolve a proposal in `ideas/`, then add the accepted next-version contract under `spec/v2/` **before implementing it**. Mark each such page `accepted target, not implemented` until its black-box fixtures and platform evidence pass; do not fold target behavior into the root v1 pages or imply that acceptance means it ships. Record version negotiation, compatibility and failure behavior as well as the success case. The [current plan](../PLAN.md) lists the promotion gates. The [ideas overview](../ideas/overview.md) maps proposal topics to the corresponding current contracts; create only the v2 spec pages needed for an accepted change.

The accepted next-version contract is now under [spec/v2/](v2/overview.md), with a [declarative corpus and evidence matrix](v2/conformance.md). Those pages are **accepted target, not implemented**; root v1 semantics and current version table below are unchanged.

This is a specification of Tasks, not a claim that the format is a universal standard. Independent writer/readers and conformance are required before claiming interoperability. Version and platform limits are stated where they matter. Automated evidence is mapped in [Conformance](conformance.md).

## System at a glance

```text
First-party UI ── typed bridge ── Tauri sidecar ──┐
Standalone tasks-cli ──────────────────────────────┼─ executeCommand
Local web development bridge ─────────────────────┘      │
                                                  command + storage layer
                                                   ├─ canonical JSON files
                                                   └─ local SQLite cache

Android UI ── Android command engine ── private SQLite
                         └─ optional SAF canonical JSON folder
```

The first-party UI, CLI, JSON-lines sidecar, and development bridge share the Node command path. Android has a separate command and storage implementation, with documented capability differences.

The Node command path normally opens one TaskDB v1 workspace. An opt-in `TASKS_SOURCE_REGISTRY_PATH` enables a limited controller for multiple TaskDB v1 roots in the Node CLI and JSON-lines backend. It does not enable multi-source UI or Android behavior. See [Sources](sources.md).

## Current format versions

| Area | Current version | Meaning |
| --- | --- | --- |
| Canonical workspace, task, and order JSON | `formatVersion: 1` | Durable current task state and workspace identity. |
| Local SQLite cache | schema version 6 | Rebuildable query/storage cache plus local history and recovery data. |
| JSON-lines command protocol | `version: 1` | Request and response transport, not a task-file format. |
| Workspace cache snapshot | `formatVersion: 1` | Snapshot of task state, classifications, relations, activity, and receipts; not the full database or canonical sync folder. |
| Portable task export | `tasks.tasks-export`, version 2 | Readable task projection; not a replacement for canonical files. |

## Specification map

- [Task model](model.md): canonical task fields, API projection, identity, classification, and relationships.
- [Storage and architecture](storage.md): canonical files, SQLite cache, recovery, conflicts, and exports.
- [Protocol](protocol.md): JSON-lines envelope, actors, versions, retries, and response errors.
- [Queries](queries.md): current query commands and filters.
- [Mutations](mutations.md): current task writes and workspace/settings operations.
- [CLI](cli.md): friendly commands mapped to the shared command path.
- [Sources](sources.md): current opt-in TaskDB source registry behavior and limits.
- [UI overview](ui/overview.md): first-party interaction contract, with focused [home-list](ui/home-list.md) and [capture/edit](ui/capture-edit.md) specifications.
- [Conformance](conformance.md): tests and platform evidence for these claims.

User setup and keyboard help live in the [usage guide](../docs/usage-guide.md). Development, packaging, and validation instructions live in [Development and validation](../docs/development.md). The [canonical workspace guide](../docs/canonical-workspace.md) provides operational recovery instructions.
