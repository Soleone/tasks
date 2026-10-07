# TaskDB specification

The root pages describe the **legacy defaults**: task model, storage, protocol, queries, mutations, CLI, sources and established UI. They are not the only implemented behavior. [Current support](../docs/support.md) distinguishes those defaults from the broad Linux replacement backend and bounded Windows native main client. Aspirational proposals belong in [`ideas/`](../ideas/), not here.

Resolve consequential behavior decisions and record accepted contracts **before implementing them**. Keep target requirements, supported commands/client integration and actual platform evidence separate; acceptance alone does not mean shipping, but incomplete platform acceptance does not mean no implementation exists. Record failure/retry behavior as well as success. The [current plan](../PLAN.md) owns promotion and cutover gates.

[Replacement contracts](v2/overview.md) have **bounded implementation** and a [declarative corpus/evidence record](v2/conformance.md), not full native acceptance. This temporary spec split ends at approved single-application cutover. Root legacy semantics and the legacy-default version table below are unchanged; no live root is implicitly upgraded.

This is a specification of Tasks, not a claim that the format is a universal standard. Independent writer/readers and conformance are required before claiming interoperability. Version and platform limits are stated where they matter. Automated evidence is mapped in [Conformance](conformance.md).

## Legacy-default system at a glance

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

## Legacy-default format versions

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
