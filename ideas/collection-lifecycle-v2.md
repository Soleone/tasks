# TaskDB v2 collection lifecycle proposal

**Status:** Working choices from the 2026-09-30 walkthrough, not an accepted spec or implemented behavior. The [v1 storage contract](../spec/storage.md) and [current receive flow](../docs/syncthing.md) still govern existing data. [Task fields](task-model-v2.md), [ordering and file observation](syncthing-sync-ordering.md), and [domain mutations](task-behavior-v2.md) have separate owners.

## Collection and first join

- One selected directory is a collection. Its root manifest has `schemaVersion` but no collection/workspace ID. Task files do not repeat a collection ID. Clients must reject absent, malformed, unsupported, or mixed-version roots with existing records rather than bootstrap or rewrite them. Candidate creation bytes for the immutable manifest are UTF-8 `{"schemaVersion":2}\n` across all writers, avoiding a needless same-path conflict from different JSON formatting; reader tolerance and version rules still need acceptance.
- New task IDs should be lowercase UUIDv4 strings. V1 accepts other safe filename IDs (`[A-Za-z0-9_-]+`), so migration must preserve those existing IDs rather than inventing replacements; v2 import validation must also require the record ID to match its filename.
- Normal joining uses Syncthing's file transport, not a TaskDB merge wizard. Two valid v2 directories with **different task IDs** should converge to the union of their task files. Task IDs therefore need a collision-resistant generation rule. Syncthing must not be treated as a JSON or graph merge engine. Do not create or remove task files from an out-of-date local cache merely because a new directory is still arriving.
- Same-ID, identical-content records need no second task. For different content, Syncthing may preserve the losing version as a conflict copy. Normal sync must not convert that copy into a second TaskDB task or choose a winner silently; show a quiet issue indicator and preserve both versions. A modify-versus-delete conflict must not silently resurrect a deleted task.
- An optional `doctor` command can inspect incomplete records, conflict copies, and dangling or ambiguous references. For a same-ID conflict, its default proposal is **keep both**: preview a new ID for one copy, identify any links whose target is ambiguous, and request confirmation before writing. It may also let the user reconcile versions of one logical task. The doctor is an exception path, not a setup step for routine sync. Its exact command, retry/recovery behavior, and link-repair choices are still open.

## Deletion and recovery

- Cancellation remains a task state. Permanent purge removes the canceled task file instead of writing a canonical tombstone. Keep the v1 distinction between `task.delete` (cancel alias) and `task.purgeCanceled` (physical removal) unless a later command proposal changes it.
- Compute the proposed purge set and reject without writing if **any surviving task** still has a `parentId` or `dependencyIds` entry pointing to a purged task. Report the affected tasks, their statuses, and the needed reparent/unlink action. Related work should be completed or canceled first, but a terminal status alone does **not** remove its links. For example, a canceled parent and its canceled child can both be purged when neither is referenced by a survivor; a done child must be reparented before its canceled parent can be purged. A blocked bulk purge must not partly succeed. Local multi-file deletion needs a recovery journal, and remote clients must tolerate the temporary intermediate state while files sync. A future doctor flow may preview relationship repairs but may not silently do them during sync.
- A missing task file means the task is absent from the canonical collection; a client must not resurrect it from a stale cache. A missing manifest, incomplete scan, or unreadable folder is an error, not a license to delete cached tasks or rewrite the root. Without tombstones, the remaining files cannot say whether a deletion was intended or accidental. App-initiated purge needs a local, non-synced recovery copy and a tested restore path; independent backups are still required for external deletion or local storage loss. [Syncthing file versioning](https://docs.syncthing.net/users/versioning.html) can help with remote replacements/deletions but does not archive a local edit on the writing device.

## V1 migration

- Never convert a live v1 Syncthing folder in place. Pause writers and sharing, preserve an independent recovery point, and convert a v1 snapshot into a **new, non-shared staging directory**. Validate every record, count, relationship, timestamp, order, and unresolved conflict before selecting the v2 directory. Failure leaves the original v1 root and client selection unchanged. Rollback selects the preserved v1 root; this is not an implicit v2-to-v1 converter.
- For a previously shared v1 collection, convert one verified source and let its v2 output replicate after all participating clients are ready. For independently used v1 collections, convert each separately while disconnected, then join the valid v2 roots. Never sync v1 and v2 files into one root or let an older client write a v2 root; clients must fail closed on unsupported versions. Exact field/order transformations belong to the model and ordering contracts before migration is accepted.

## Working outcome examples

These are proposed client outcomes, **not** yet conformance claims:

| Starting condition | Intended outcome |
| --- | --- |
| Device A has task `a`, device B has task `b` | Ordinary Syncthing join yields both tasks without a TaskDB merge action. |
| Both have the same ID and same file bytes | One task, no duplicate. |
| Both have the same ID but different content | Preserve the canonical file and conflict copy; do not create a second task during sync. Show a quiet issue indicator; `doctor` defaults to a previewed keep-both repair. |
| Same ID differs and a child or dependent points to it | Preserve both versions and the original links; `doctor` asks which version each ambiguous link meant before applying repair. |
| A purges a canceled parent and canceled child together; neither is referenced by survivors | The closed subgraph may be deleted with a local recovery journal. |
| A purges a canceled parent but its done child remains | Reject with the child's ID and an instruction to reparent it; `done` alone leaves `parentId` intact. |
| One peer deletes a file while the other edits it offline | Let Syncthing resolve the file race, retain any conflict copy and recovery point, and do not infer that deletion or editing always wins. |
| A staged v1-to-v2 conversion fails before selection switches | Continue using the unchanged v1 root; never expose the incomplete stage to Syncthing. |

## Disposable transport evidence (2026-09-30)

An Ubuntu Syncthing v1.29.5 package was extracted under `/tmp` without system installation. Each test used two isolated local send/receive instances with separate homes and index databases, matching folder IDs, loopback-only peer/API ports, no discovery/relays, and the same exact manifest bytes (`{"schemaVersion":2}\n`). The task JSON files were **synthetic transport inputs**, not v2 application output.

| Case | Observed result |
| --- | --- |
| Each peer starts with one distinct task file | Both peers held both files after initial sync (within 8 seconds). |
| Both peers start with the same task ID and identical bytes | One task file on each peer, no conflict copy. |
| Both peers start with the same task ID and different contents | Syncthing propagated a `*.sync-conflict-*.json` copy; both contents were present on both peers. It did not create a second TaskDB task ID. |
| After a common sync, one offline peer deletes a file while the other edits it | The edit won this trial; the canonical file remained on both peers. No conflict copy was observed. Do not assume deletion always wins. |
| One offline peer deletes a file without a concurrent edit | The file disappeared on both peers (within 3 seconds of restart). |

A copy of the canonical root made outside the share before the plain-delete test restored the prior files byte-for-byte into a separate directory. That checks manual file recovery only, not an app restore flow. Syncthing's [conflict rules](https://docs.syncthing.net/users/syncing.html) explain why results can differ for a modify-versus-delete race. These runs establish one WSL2 transport behavior, not cross-version/platform acceptance, partial-transfer detection, or semantic graph repair.

A separate disposable check made the current Node `tasks-cli list --json` reject a simplified v2 manifest (`{"schemaVersion":2}`) with `INVALID_CANONICAL` (exit 1), leaving canonical file hashes unchanged. This checks current v1 Node refusal only, not Android or the migration procedure.

## Gate before promotion to `spec/v2/`

Settle the exact manifest bytes, task-ID syntax, doctor repair and retry rules (including ambiguous links), file disappearance and purge rules, and staged migration/rollback contract. Write black-box fixtures for disjoint union, identical and divergent IDs, edit-versus-delete, referenced purges, partial imports, and interrupted conversion. The transport probe above informs these fixtures, but it is not application conformance. Only then promote an **accepted target** contract to `spec/v2/`, before writing production v2 code.

## Conformance after promotion, before claiming v2 ships

1. Implement the accepted v2 file reader/writer and repeat first-join tests using valid complete task records, including interrupted transfers, restarts, and supported file providers.
2. Exercise an isolated conflict and `doctor` keep-both repair twice and after local cache loss: no lost content or replayed duplicate. Exercise referenced conflicts and modify-versus-delete cases: originals and links remain recoverable and the doctor reports ambiguity without an unwanted resurrection.
3. Delete a canceled leaf through the app; verify propagation without cache resurrection. Reject referenced/bulk purges without partial writes. Repeat with an interrupted scan, missing manifest, offline peer, and app-level restore from a recovery copy.
4. Crash conversion at each staging step; validate that v1 remains usable. Reject mixed/unsupported roots on Node and Android, round-trip the v1 fixture through a v2 stage, and prove rollback and relationship/order preservation.

Open design work: exact manifest encoding and task-ID syntax, idempotent doctor repair (including links that arrive later during sync), missing-file detection on SAF/partial transfers, recovery-copy retention, and field/order migration. Until those cases are exercised, automatic union is a transport observation, not an application safety or interoperability claim.
