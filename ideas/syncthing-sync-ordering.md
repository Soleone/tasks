# Syncthing sync and ordering direction

**Status:** Working direction for the next format, not implemented behavior. The current v1 contract remains in the [specification](../spec/overview.md).

## Product constraints and goals

- One selected TaskDB directory per client. Devices replicate that directory with Syncthing; the product does not need to aggregate multiple workspaces.
- A directory is the task collection. A user may have separately used devices and later want to merge their tasks into one synced collection.
- Syncthing syncs files, not TaskDB operations or JSON structures. Concurrent edits to the same path can create conflict copies that are painful for ordinary users.
- Manual ordering is required. Avoid creating conflicts for common, compatible actions such as independently capturing different tasks while devices are offline.

## Collection lifecycle boundary

The [collection lifecycle proposal](collection-lifecycle-v2.md) owns the no-`workspaceId` direction, automatic first join of disjoint task files, ID collisions, physical deletion, and staged migration. This note owns the per-task ordering candidate and local file-observation rule, not the join workflow. Syncthing [describes a newly added folder as merging with remote files](https://docs.syncthing.net/users/faq.html), but same-path edits require conflict handling; automatic union is not yet proven for our format.

## Ordering

V1 stores each sibling sequence in one `order/<parent>.json` file. Creating a task prepends its ID to that list. If two devices create different tasks under the same parent before syncing, their task files have distinct paths but both rewrite the same order file. Syncthing cannot merge the JSON arrays, so it creates a conflict copy. Independent additions are often semantically mergeable, but concurrent reorders can disagree.

**Leading v2 candidate:** store a sparse fractional `orderKey` with each task instead of a whole sibling list. Inserting or moving one task usually changes only that task's key, avoiding dense-position rewrites and the shared order-file hotspot. Sort by the key with a deterministic task-ID tie-break. Use a variable-length string algorithm, not floating-point midpoints; specify bytewise comparison and concurrent-key behavior.

This should remove the common conflict where devices add different tasks to the same sibling list. It does not eliminate conflicts when both devices edit the same task. Fractional keys also do not guarantee that every pair of simultaneous reorder intentions can be preserved exactly. Do not adopt a plain linked list or an append-only event log unless the simpler candidate fails the required scenarios.

### Selected ordering proposal

The disposable model pins the [CC0 fractional-indexing 3.2.0 reference](https://registry.npmjs.org/fractional-indexing/-/fractional-indexing-3.2.0.tgz), using its default base-62 digits (`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`) and A–Z/a–z integer-length heads. This is a development-only dependency, not a production v2 engine or an accepted contract. Pin the version: newer upstream algorithms must not silently change interoperable key bytes.

- Generate a key with `generateKeyBetween(lower, upper)`, where `null` denotes the beginning/end and two supplied bounds must be strictly ascending. For a selected group, `generateNKeysBetween` allocates ascending keys in existing selected order after removing that group from the sibling sequence.
- Compare valid ASCII keys bytewise, shorter prefix first, then compare the exact task ID by the same rule. Never use locale-aware comparison or case folding; migrated v1 IDs may include uppercase characters.
- Reference vectors: empty collection → `a0`; before `a0` → `Zz`; after `a0` → `a1`; between `a0` and `a1` → `a0V`; two between `a0` and `a1` → `["a0G","a0V"]`.
- Proposed migration maps each validated v1 sibling sequence independently to `generateNKeysBetween(null, null, count)` and preserves IDs and sequence. This is a mapping candidate, not a tested full converter.
- Proposed key validation: an A–Z/a–z head, followed only by base-62 digits. Integer length is `90 - headCode + 2` for uppercase heads and `headCode - 97 + 2` for lowercase heads; reject shorter keys. The bare smallest integer (`A` plus 26 zeros) is reserved; a fractional suffix must not end in `0`. Keys are valid ASCII, with a proposed **256-byte maximum**. The generator alone is not a complete validator. The model also rejects record/filename ID mismatch and invalid UTF-8 rather than hashing replacement characters.
- Reject an allocation exceeding the key limit **before any write**, preserving the requested placement. Do not truncate keys, change to floats, or silently rekey the whole scope. An explicit, separately requested sibling-scope normalization can assign `generateNKeysBetween(null, null, count)` in current `(key, ID)` order, with preview, the same guards/journal, and no semantic reordering. Its public command and receipt/activity contract belong in the remaining command design. The model verifies valid keys of at most four bytes for 10,000 siblings; production performance and a normalization command are not implemented.

### Equal keys: rekey only the affected tied run

**Design/probe decision (2026-10-01):** keep deterministic fractional keys and an ID tie-break; use bounded, recoverable rekeying only when an explicit reorder needs a gap inside a tied run. This is the selected proposal for spec reconciliation, not yet an accepted or shipped v2 contract.

1. Observe the complete sibling scope, including canceled/hidden siblings, using validated files rather than a filtered UI list. Resolve selected tasks in their current sibling order, remove them, and find the exact requested insertion index. An unchanged final ID sequence is a no-op, even when keys are tied.
2. If the remaining neighbors have different keys (or the gap is at either end), allocate keys only for the selected group. Independent captures at the beginning still write only their own new task files.
3. If both neighbors have the same key, expand to the **maximal remaining run with that key**, not all siblings. Preserve the run's current ID-tie order while placing the selected group at the requested index. Allocate distinct keys for that combined run between its nearest outside neighbors. Only records whose keys actually change are written; outside neighbors are guards, never incidental writes. Preserve every non-order field, including content, relationships, timestamps, and unknown fields allowed by the eventual reader contract.
4. Under a cooperating local-writer lock, verify observed sibling membership and exact-byte baselines before staging one immutable, non-synced journal. It binds the local directory/scope and retains the intended order plus recoverable old/next bytes and scope guards. Before each replacement or recovery, verify the complete scope again. The disposable model retains all scope bytes for simplicity; this is not a production storage/performance prescription.
5. Recovery recognizes already-applied bytes and writes only unchanged preimages still awaiting replacement. A divergent file, deletion, arrival, malformed JSON, or invalid encoding stops recovery and preserves the journal and current files. Do not silently roll back already-written files or resurrect a missing task. A conflicting partial operation remains an explicit recovery issue, not a successful atomic reorder. Remote clients must tolerate the temporary partial-file state and must not normalize it during observation.
6. Keep local versions, receipts, activity, and undo separate from canonical keys. A changed logical move may leave a selected task's key bytes unchanged while changing its position through neighboring rekeys. The [command](protocol-v2.md) and [behavior](task-behavior-v2.md) proposals cover that selected task plus incidentally rewritten siblings, undo guards, and explicit cache-loss refusal. Receipts stay in SQLite; replay after losing them is not a supported guarantee. The model tests journal byte replay, not that command-level contract.

Concurrent offline repairs can overlap on a task file, preserve a conflict copy, and lose one placement intention. They can also produce fresh equal keys. This is expected file-level conflict behavior, not a sequence CRDT: preserve both versions, show the existing conflict issue, and require explicit semantic repair; do not run an automatic repair loop or promote copies to new IDs.

**Why not entropy-first allocation:** correct collision-resistant/jittered allocators can reduce equal keys, but finite randomness still needs a collision fallback and an exact encoding/comparison contract. Naively appending an ID to a generated key can escape a prefix upper bound (`a0` plus an `f...` suffix sorts after `a0V`). We have not disproved sophisticated unique-key schemes. The bounded-run repair is selected because it handles actual ties with the existing exact algorithm and limits routine writes; revisit entropy only if measured repair/conflict frequency warrants it. Plain tie-breaking alone and silently placing outside the requested gap are rejected.

## Canonical versus local sync state

- **Current direction:** omit the entire `sync` block from v2 canonical task files. Do not serialize `revision`, writer identity, `basedOnHash`, or `contentHash`.
- Keep each device's optimistic task version and last-observed canonical-file hash in local, non-synced state. Node currently stores canonical content hashes and file metadata in SQLite; v2 should store an exact-byte baseline hash. Android currently uses canonical `sync.revision` as its task version and checks the folder again before writing; replace that coupling with a local version plus per-file observed hash.
- On import, save a hash of each canonical file's exact bytes locally. Before replacing a file, reread it and compare with the saved hash. If it changed, refresh and reject the stale write instead of overwriting it. After a verified write, update the local baseline to the new file bytes. The write can still race with a sync arriving after the final read, so this does not replace Syncthing conflict preservation.
- A local file hash is for observation and stale-write protection, not a distributed revision or merge rule. Do not add a shared whole-workspace hash; it would create a frequently rewritten hotspot.
- Writer attribution may be added later only if a conflict-resolution feature has a concrete use for it. It is not needed for Syncthing transport or independent task additions.

## Promotion and implementation gates

- Extend the [collection lifecycle](collection-lifecycle-v2.md) transport evidence to application behavior; distinguish automatic union of distinct files from same-path conflict repair.
- Promote the selected key/rekey/limit rules only after command semantics and lifecycle rules are reconciled, versioned target contracts and black-box fixtures exist, and their acceptance gates pass. Finish full v1-to-v2 field migration/rollback proof; the existing fixture's sibling sequences have been mapped without changing other fields, not converted into valid v2 application output.
- Repeat the model's interrupted/stale/concurrent cases through real Node and Android writers, including fsync/process lifecycle, pending-state surfacing, receipts/undo, cache loss, and partial remote transfer. Same-ID semantic repair belongs in the [collection lifecycle proposal](collection-lifecycle-v2.md).
- No canonical writer attribution is needed for this ordering proposal. Local conflict UI attribution remains deferred until it has a concrete use.
- Keep the initial design short of a sequence CRDT or append-only operation log unless these tests show they are needed.

## Disposable candidate evidence (2026-09-30 to 2026-10-01)

[`scripts/taskdbV2Candidates.test.mjs`](../scripts/taskdbV2Candidates.test.mjs) exercises an isolated proposal model, never the production reader/writer. The model pins key vectors and ASCII/ID ordering, same-gap captures and moves, equal-key failure, sibling-sequence mapping, observed-byte hashing, and simulated journal/retry states. A thousand successive inserts into the same shrinking gap remain ordered but grow keys beyond 100 bytes; the selected proposal now caps canonical keys and refuses overflow before mutation. A no-op recovery recognizes already-written bytes; divergent or missing current bytes refuse recovery and preserve the local intent. These are model assertions, not process-kill, fsync/power-loss, SQLite receipt, Android, or platform conformance.

[`scripts/taskdbV2Transport.test.mjs`](../scripts/taskdbV2Transport.test.mjs) repeats real transport with two isolated Syncthing v1.29.5 instances, fresh homes/index databases, loopback-only peer/API ports, no discovery/relays/NAT/upgrades/reporting, and matching manifest bytes. It uses complete-shaped synthetic candidate task JSON and confirms both peers have indexed the common starting state before offline changes. There is still no v2 application reader.

| Case | Observed result |
| --- | --- |
| Both offline peers capture different IDs before a common task | Both files reach both roots with the same key; no shared order file and no conflict copy. Task-ID comparison yields the same display sequence. |
| Offline peers move different tasks into the same gap | Both changes survive with equal keys and no conflict copy. Only one task can end up immediately adjacent to the target; sorting is convergence, not preservation of both intentions. |
| Both offline peers change one task's file (reorder versus content/order edit) | One canonical file plus one propagated conflict copy preserves both exact byte versions. No automatic JSON merge. |
| Restart after the same-task conflict | Both peers retain the same two versions and one conflict copy; restart does not duplicate the task ID or repair the conflict. |
| External edit changes only JSON formatting before staging | The exact-byte SHA-256 baseline rejects it as stale despite equivalent parsed content. |
| Another editor writes after the final check but before rename | The model overwrites that unseen edit. Its journal contains only the previously observed and proposed bytes, not the racing version. |
| Two offline peers rekey overlapping tied runs | Each local requested gap is honored. On joining, the overlapping task's two key versions propagate as canonical plus conflict copy; five canonical IDs remain, not a duplicated task. A later restart retains all task/conflict bytes. |

[`scripts/taskdbV2Rekey.test.mjs`](../scripts/taskdbV2Rekey.test.mjs) adds exact tied-run vectors, selected-group and canceled-sibling cases, root/child validation, no-op/edge cases, 419 small-scope selection/placement combinations, malformed key/UTF-8 refusal, key-limit failure, v1 fixture sequence mapping, and every persisted partial-write prefix of a three-file repair. Reloading its local journal needs no cache; verified files are not replayed, and changed/deleted/new siblings stop recovery without rollback. These are deterministic model cut points, not killed-process or power-loss tests. The transport probe separately confirms actual Syncthing preservation after concurrent repairs.

**Selected writer-support boundary:** cooperating same-device writers must use the same lock/journal path; v2 clients must refresh imports and check byte baselines. Syncthing is a noncooperating file transport, not a JSON merge engine. Arbitrary editors and providers that can change bytes between the final read and replacement are supported only on a best-effort detection basis, never as lossless compare-and-swap. Such writers can destroy a version before either the client or Syncthing observes it. Preserve all observed/conflict versions and keep independent backups; do not advertise this as a guaranteed recovery of every racing edit. An atomic file replacement is not an atomic hash-preconditioned replacement, and the local journal cannot eliminate that gap. Doctor repair, partial-scan/deletion detection, and local-version behavior after cache loss remain separate unproven application obligations.

Repeat the local model with:

```bash
node --test scripts/taskdbV2Candidates.test.mjs scripts/taskdbV2Rekey.test.mjs
```

Transport is opt-in and otherwise reported as skipped by `pnpm test`. Supply an independently obtained v1.29.5 binary; the test creates and removes only its own temporary roots:

```bash
TASKDB_V2_SYNCTHING_BIN=/absolute/path/to/syncthing \
  node --test scripts/taskdbV2Transport.test.mjs
```

The transport test uses an internal `STMONITORED=yes` setting to run the worker directly, so stopping it waits for the actual process and database lock rather than just a monitor. This probe is pinned to v1.29.5; passing on WSL2 is not native Windows, Omarchy, Android SAF, cross-version, or independent-client acceptance.
