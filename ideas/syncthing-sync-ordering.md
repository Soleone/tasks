# Syncthing sync and ordering direction

**Status:** Working direction for the next format, not implemented behavior. The current v1 contract remains in the [specification](../spec/overview.md).

## Product constraints and goals

- One selected TaskDB directory per client. Devices replicate that directory with Syncthing; the product does not need to aggregate multiple workspaces.
- A directory is the task collection. A user may have separately used devices and later want to merge their tasks into one synced collection.
- Syncthing syncs files, not TaskDB operations or JSON structures. Concurrent edits to the same path can create conflict copies that are painful for ordinary users.
- Manual ordering is required. Avoid creating conflicts for common, compatible actions such as independently capturing different tasks while devices are offline.

## Workspace identity

The current v1 `workspaceId` labels a dataset, but Syncthing does not require it. The current receive/adopt flow responds to a different ID by backing up and clearing the receiving canonical directory before adopting the incoming files. That destructive policy is an application choice, not a requirement of the ID.

**Current recommendation:** omit `workspaceId` from v2 and treat the selected directory as the collection. Keep a small root manifest with one `schemaVersion`; omit the redundant `format` discriminator. If identity is retained, a mismatch must not imply deleting local tasks; a merge path is needed. Merging two directories still needs same-task conflict handling and an ordering policy.

## Ordering

V1 stores each sibling sequence in one `order/<parent>.json` file. Creating a task prepends its ID to that list. If two devices create different tasks under the same parent before syncing, their task files have distinct paths but both rewrite the same order file. Syncthing cannot merge the JSON arrays, so it creates a conflict copy. Independent additions are often semantically mergeable, but concurrent reorders can disagree.

**Leading v2 candidate:** store a sparse fractional `orderKey` with each task instead of a whole sibling list. Inserting or moving one task usually changes only that task's key, avoiding dense-position rewrites and the shared order-file hotspot. Sort by the key with a deterministic task-ID tie-break. Use a variable-length string algorithm, not floating-point midpoints; specify bytewise comparison and concurrent-key behavior.

This should remove the common conflict where devices add different tasks to the same sibling list. It does not eliminate conflicts when both devices edit the same task. Fractional keys also do not guarantee that every pair of simultaneous reorder intentions can be preserved exactly. Do not adopt a plain linked list or an append-only event log unless the simpler candidate fails the required scenarios.

## Canonical versus local sync state

- **Current direction:** omit the entire `sync` block from v2 canonical task files. Do not serialize `revision`, writer identity, `basedOnHash`, or `contentHash`.
- Keep each device's optimistic task version and last-observed canonical-file hash in local, non-synced state. Node currently stores canonical content hashes and file metadata in SQLite; v2 should store an exact-byte baseline hash. Android currently uses canonical `sync.revision` as its task version and checks the folder again before writing; replace that coupling with a local version plus per-file observed hash.
- On import, save a hash of each canonical file's exact bytes locally. Before replacing a file, reread it and compare with the saved hash. If it changed, refresh and reject the stale write instead of overwriting it. After a verified write, update the local baseline to the new file bytes. The write can still race with a sync arriving after the final read, so this does not replace Syncthing conflict preservation.
- A local file hash is for observation and stale-write protection, not a distributed revision or merge rule. Do not add a shared whole-workspace hash; it would create a frequently rewritten hotspot.
- Writer attribution may be added later only if a conflict-resolution feature has a concrete use for it. It is not needed for Syncthing transport or independent task additions.

## Still to decide and validate

- Confirm removal of `workspaceId` and define how first-time merging of independently used devices selects the resulting collection.
- Choose and test the exact fractional-key algorithm, tie-break, comparison rules, and migration from v1 order files.
- Define automatic handling for independent additions, incompatible reorders, and same-task conflict copies. Keep losing data recoverable.
- Decide whether any writer attribution is needed in local conflict UI. It is not part of the v2 canonical task record.
- Keep the initial design short of a sequence CRDT or append-only operation log unless these tests show they are needed.
