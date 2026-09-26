# TaskDB behavior specification

This is the technology-independent description of Tasks as it grows into TaskDB. It is meant to let someone build a compatible client or implementation without adopting TypeScript, Tauri, SQLite, or the first-party interface. **TaskDB is a working name, not a package or on-disk rename.**

## Product contract

One person and their existing agents should be able to capture quickly, clarify, choose work, complete it, and understand what changed. The first-party client stays keyboard-first and mouse-complete. A command interface makes the same tasks available to scripts and other clients without direct database edits. Tasks live locally under an explicitly owned source; no hosted account or background AI is assumed.

A normal desktop/CLI view will combine tasks from configured sources. Each task retains an internal source reference so a write returns to its owner. A source may be a TaskDB v1 workspace or another writable task store. `@category` is the one initial project/scope filter across sources. The source can be inspected in task details; it does not need to clutter the list. See [model](model.md) and [commands](commands.md).

## How to read this spec

| Label | Meaning |
| --- | --- |
| **Current v1** | Documented or observed existing behavior. Keep it compatible while changing architecture. |
| **2.0 target** | Approved product direction that is **not yet implemented**. The v0 wire/adapter contract is not frozen until conformance tests pass. |
| **Platform limit** | A difference or unproven behavior that must not be advertised as conformance. |

The documents are not a declaration that every backend can already perform every operation. Before changing a behavioral claim, compare it with a fixture and update the relevant test. Do not import code-level conveniences into the contract merely because the current implementation exposes them.

- [Model](model.md): task state, classification, identity, source ownership, and combined views.
- [Commands](commands.md): CLI/sidecar boundary, errors, concurrency, adapters, and supported-operation policy.
- [Canonical v1 storage](storage-v1.md): inspectable files, local cache, recovery, and the formats that are *not* interchangeable.
- [Interaction](interaction.md): first-party home/list and focus rules; alternative clients may use another UI.
- [Pivot plan](../plans/taskdb-2.0-pivot.md): staging, exit gates, and non-goals. The existing [development guide](../docs/development.md), [canonical workspace guide](../docs/canonical-workspace.md), and [usage guide](../docs/usage-guide.md) remain implementation evidence until their details are reconciled here.

## Three reference journeys

1. **One personal workspace, current v1.** Capture `Prepare launch @planning #product` in the app or with `tasks-cli add`, edit it from the other surface, then complete it. The same canonical task file is the current state; the local SQLite cache can be rebuilt. The `@planning` category comes from the title, not a project table.
2. **Agent in a project, current v1 plus 2.0 target.** pi-tasks can use `tasks-cli` to update a category-scoped TaskDB workspace today. A project-local sq store is a *different authority*. In 2.0 a mounted sq source would appear beside TaskDB tasks while edits to its tasks go through the sq adapter, not into a shadow TaskDB copy. If both stores contain `@planning`, the ordinary category filter can show both.
3. **Writable external store, 2.0 target.** Mount a TaskNotes vault beside the personal workspace, inspect the combined All view, create a task explicitly in that source, and update it from the app or CLI. The adapter writes the external task in place, preserves unrelated fields, and rejects a detected stale edit from another agent. A cache may speed queries but is never an independently writable replica. TaskNotes is an example, not the chosen first pilot.

These journeys are acceptance stories, **not a claim that multi-source routing or TaskNotes writes exist today**. First prove source ownership and a usable write contract; only after the external pilot add a recoverable cross-source move. Android currently implements a single selected workspace via SAF and its own SQLite path; multi-source Android follows the desktop/CLI proof.

## Scope boundaries

Preserve current v1 files and the M1 recovery/native-validation gates. No automatic two-way mirror, cross-source dependency graph, team permissions, hosted sync, universal issue schema, or required third-party UI. The independent standardization question follows independent adoption, not this document's creation.
