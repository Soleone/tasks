# TaskDB v2 collection lifecycle proposal

**Status:** Selected rules promoted to the [accepted v2 target](../spec/v2/storage.md) on 2026-10-01, **not implemented**. This document preserves proposal reasoning, earlier reconciliation and bounded evidence; the versioned target is authoritative where details differ. Root [v1 specs](../spec/overview.md) remain shipped behavior. Promotion does not prove migration, doctor, receipts, native providers or interoperability.

## Root layout, encoding and identity

One selected directory is a collection, not a shared collection ID. The selected target is:

```text
<root>/workspace.json
<root>/tasks/<task-id>.json
```

No canonical order files, local cache, retry ledger, recovery journal, device ID, or repair receipt in this tree. Syncthing's own markers/versioning/ignore files and preserved conflict copies are transport artifacts, not additional TaskDB authorities. A nonempty legacy `order/` or legacy task fields in a schema-2 root are mixed-format errors, not silently ignored data.

All v2 writers create the immutable manifest with exact UTF-8 bytes `{"schemaVersion":2}\n`, no BOM. Readers accept legal JSON whitespace/property formatting but require exactly the one integer-valued `schemaVersion: 2` field. Reject duplicate JSON object keys, invalid encoding/surrogates, extra manifest fields, missing/malformed manifests with records, and unsupported versions before mutations. Task files follow the complete strict model, not a version inferred independently per task. Other-version task records, invalid/unrecognized task JSON names and partial JSON are reported and preserved; never silently turn them into an empty root or a partial writable projection.

Fresh normal task/doctor clone IDs are lowercase UUIDv4 strings (`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`) generated once and retained in the operation plan. Validate no existing canonical/conflict task with that ID before staging; a collision before writes may require a newly prepared plan, never change IDs during replay. Imported/migrated legacy IDs may use `[A-Za-z0-9_-]+`; preserve their exact case and filename spelling. Record ID must equal the filename stem. Reject case-insensitive filename aliases when they collide on a supported provider; do not rename or overwrite one to make a collection fit that filesystem. No deterministic repair-ID scheme is introduced.

Only explicit initialization may create a manifest/tasks directory, on an empty root (allowing empty tasks/transport markers). Reads never bootstrap. A missing root or unreadable provider is an error, not a deletion or fresh-workspace signal. Protocol/data negotiation and explicit init/migrate commands are owned by the [command proposal](protocol-v2.md).

## Collection and first join
- Normal joining uses Syncthing's file transport, not a TaskDB merge wizard. Two valid v2 directories with **different task IDs** should converge to the union of their task files. Task IDs therefore need a collision-resistant generation rule. Syncthing must not be treated as a JSON or graph merge engine. Do not create or remove task files from an out-of-date local cache merely because a new directory is still arriving.
- Same-ID, identical-content records need no second task. For different content, Syncthing may preserve the losing version as a conflict copy. Normal sync must not convert that copy into a second TaskDB task or choose a winner silently; show a quiet issue indicator and preserve both versions. A modify-versus-delete conflict must not silently resurrect a deleted task.
- Doctor inspects incomplete records, conflict copies, and dangling/ambiguous references. The initial repair contract supports explicit **keep both** and reviewed link repair, not an unrestricted JSON merge editor. For a same-ID conflict, preview a new ID for each retained alternate and ask about affected links before writing. Doctor is an exception path, not a setup step for routine sync. Reconciled plan/apply rules follow below.

## Repair coordination

**Operator decision (2026-10-01):** coordinate exceptional conflict repairs on one nominated device. Keep repair planning/IDs and retry state local; do not add a synced repair ledger or a deterministic cross-device clone-ID scheme merely to coordinate doctor.

Other clients can inspect issues but must not execute competing repair plans for that conflict. Finish the known initial sync, pause sharing/writers on participating devices, repair on the nominated device, then resume sharing and verify convergence before another repair. This is cooperating-user/client coordination, not a distributed lock: a noncooperating/disconnected second device can still perform an independent repair. Do not claim cross-device exactly-once repair. Routine disjoint-ID joining remains ordinary sync and does not require doctor or a nominated device.

### Doctor plan/apply and recovery

1. Inspect without changes. Identify an issue by relative canonical/conflict paths, logical task ID and exact-byte fingerprints, not a disposable SQLite row number. Unknown/partial formats are inspectable issues, never auto-imported as valid tasks. The initial repair target does not rewrite a missing/unsupported manifest; restore/select a verified root rather than invent its identity.
2. Explicit plan creation allocates fixed clone IDs and records selected source versions, expected original bytes, complete observed graph/scope, link choices, and output keys. Keep-both defaults to retaining the current canonical version under its existing ID and cloning the alternate, but the user can choose which version retains that ID before confirmation. Preserve source content/timestamps when copying versions, not a fabricated new capture time.
3. Every observed surviving parent/dependency reference to a split ID requires an explicit original/clone target choice. Terminal status does not remove ambiguity. Missing choices fail `AMBIGUOUS_LINK`. For a dangling-reference plan, require explicit unlink or reparent targets; no implicit repair. Relationship changes are real edits under the behavior timestamp rules. Validate the complete prospective graph and keys before staging.
4. Present the full proposal, including touched records, clone IDs, links, copy disposition and recovery location. Applying the reviewed plan requires its ID, a stable request key/context, confirmation through the caller, and unchanged observed bytes/graph. Stale inputs fail `STALE_REPAIR_PLAN`; preparing a new plan is a separate action, not an automatic retry with a new clone ID. A plan that has not begun application may live in SQLite; a writing plan's fixed IDs/bytes must be in the bounded local pending journal before canonical changes.
5. Preserve verified raw original/canonical/conflict bytes and the plan in a local, non-synced recovery copy **before** changes. Write/verify the new clone and explicitly chosen canonical/link updates under guarded recovery. Never convert an old edit-versus-delete copy into a live task merely because it exists; restoring it is a separately confirmed intent.
6. Only after verifying all planned output files and recovery copies may the explicitly selected source conflict copies be removed from the shared tree, under their original-byte guards. This disposition is previewed; copies move into retained local recovery, not silent destruction. A crash before cleanup leaves an inspectable conflict and retained fixed plan; recovery must finish/stop that plan rather than clone again. Divergence or partial-byte writes stop with a recovery issue and preserve all available versions.
7. With the same cache/context, plan/apply retries return their receipt and never regenerate clone IDs or repeat link rewrites. After cache loss, old contexts/plans fail closed; a retained pending journal can be explicitly recovered with its original IDs, not by blindly reissuing keep-both. After completed cleanup, canonical files alone do not prove historical request identity. Reintroduced copies or another device's independent repair require new explicit review, not a global exactly-once promise.

Local repair history can flag later-arriving, previously unreviewed references to a split original ID. Preserve those links and report them for review; never silently redirect them. Other devices, or a device that lost that local history, cannot infer the same historical ambiguity from the minimal canonical graph. Exact ID references remain as received. This limitation is deliberate, not an unimplemented synced receipt feature.

Doctor repair is not generic undo. Restore/reconcile from its recovery copy through a separately confirmed, guarded operation or a new verified root. The [command proposal](protocol-v2.md) owns public command/context/receipt/error shapes. These are selected design rules, not implementation/conformance claims.

## Deletion and recovery

- Cancellation remains a task state. Permanent purge removes the canceled task file instead of writing a canonical tombstone. Keep the v1 distinction between `task.delete` (cancel alias) and `task.purgeCanceled` (physical removal) unless a later command proposal changes it.
- Compute the proposed purge set and reject without writing if **any surviving task** still has a `parentId` or `dependencyIds` entry pointing to a purged task. Report the affected tasks, their statuses, and the needed reparent/unlink action. Related work should be completed or canceled first, but a terminal status alone does **not** remove its links. For example, a canceled parent and its canceled child can both be purged when neither is referenced by a survivor; a done child must be reparented before its canceled parent can be purged. A blocked bulk purge must not partly succeed. Local multi-file deletion needs a recovery journal, and remote clients must tolerate the temporary intermediate state while files sync. A future doctor flow may preview relationship repairs but may not silently do them during sync.
- A missing task file means the task is absent from the canonical collection; a client must not resurrect it from a stale cache. A missing manifest, incomplete scan, or unreadable folder is an error, not a license to delete cached tasks or rewrite the root. Without tombstones, the remaining files cannot say whether a deletion was intended or accidental. App-initiated purge needs a local, non-synced recovery copy and a tested restore path; independent backups are still required for external deletion or local storage loss. [Syncthing file versioning](https://docs.syncthing.net/users/versioning.html) can help with remote replacements/deletions but does not archive a local edit on the writing device.

## Observation, missing files and local recovery retention

A scan must retain the selected root/provider binding, successfully read the manifest and enumerate/read all candidate files, and recheck membership/observed bytes relevant to its command. Permission failures, truncated listings, malformed/partially written records, missing manifests, or changed binding are not complete snapshots. Repeated stable enumeration is a local check, not proof that a remote Syncthing transfer has finished. Do not promise a distributed snapshot or resurrect absent files from cache.

Missing targets/cycles/temporary partial batches are reported as graph/recovery issues. A client may retain a clearly stale last-good view for inspection; it must not present that cache as fresh write authority or silently reparent/unlink. Ordinary writes require a valid observed prospective graph. Explicit doctor link-repair plans may fix reported dangling references after full review and guards. Valid disjoint captures can still join normally; no shared workspace hash or file-count manifest is added.

Recovery journals/copies live outside the synced root, protected as user data. Retain active/conflicting pending journals and destructive-operation recovery copies until explicit user removal; no automatic time-based expiry in this target. Cleanup must warn what replay/restore/history evidence is lost and must not remove unresolved intent. Cache-only receipt deletion invalidates the local write context. External deletions/storage loss still require independent backups; these local artifacts are not a replicated safety net.

Providers unable to enumerate/read/replace/verify under the required guards must report an explicit capability/recovery limitation, not synthesize an empty root or claim Node parity. Node atomic replacement and SAF partial-byte outcomes need separate implementation evidence.

## V1 migration

- Never convert a live v1 Syncthing folder in place. Pause writers and sharing, preserve an independent recovery point, and convert a v1 snapshot into a **new, non-shared staging directory**. Validate every record, count, relationship, timestamp, order, and unresolved conflict before selecting the v2 directory. Failure leaves the original v1 root and client selection unchanged. Rollback selects the preserved v1 root; this is not an implicit v2-to-v1 converter.
- For a previously shared v1 collection, convert one verified source and let its v2 output replicate after all participating clients are ready. For independently used v1 collections, convert each separately while disconnected, then join the valid v2 roots. Never sync v1 and v2 files into one root or let an older client write a v2 root; clients must fail closed on unsupported versions. Exact field/order transformations are selected in the [model](task-model-v2.md) and [ordering](syncthing-sync-ordering.md) proposals; they still require normative fixtures and actual conversion proof.

### Staging completion and rollback

`workspace.migrateV1` previews the verified source inventory and all field/order transformations, then executes only into an absent or explicitly empty, non-shared destination. Require a complete v1 manifest/record/hash/graph/order snapshot, matching filename IDs, no duplicate JSON members, no unresolved conflict copies, and no unsupported fields; no fallback for missing order members. Preserve source and optional cache backups independently, but do not depend on a live SQLite cache to invent task data.

Write target data in staging, reread it using the strict v2 validator, compare source/target IDs, count, graph, sibling sequences, Markdown and timestamp mappings, and produce an explicit completion report. Failure or interruption never switches selection; mark/report an incomplete stage and preserve it for explicit cleanup/resume, never publish it as a usable synced root. A retained migration plan binds source fingerprints and fixed target mappings. Retry uses that plan and verifies already-written target bytes; a changed source/target fails rather than silently overwrite or restart from a different inventory.

After verification, the caller explicitly selects the new v2 root and starts fresh local tokens/cache state. Do not copy v1 receipt/version authority into that selection. Rollback explicitly selects the preserved v1 root and reopens it with the v1 client; it restores the pre-migration snapshot, **not** v2 edits performed afterward. Warn about that distinction before rollback. Preserve the v2 root separately; no implicit reverse converter or overwrite of either root. Previously shared sources migrate once and then replicate that verified output after all clients are ready; independently used sources stage separately before joining, as above.

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

Promote these selected manifest/ID/doctor/observation/purge/migration rules together with reconciled model/command contracts. First write black-box fixtures for disjoint union, identical and divergent IDs, edit-versus-delete, referenced purges, partial imports, stale/cache-lost doctor plans, late links, source/target conversion failures, and interrupted conversion. The transport probe above informs these fixtures, but it is not application conformance. Only then promote an **accepted target** contract to `spec/v2/`, before writing production v2 code.

## Conformance after promotion, before claiming v2 ships

1. Implement the accepted v2 file reader/writer and repeat first-join tests using valid complete task records, including interrupted transfers, restarts, and supported file providers.
2. Exercise an isolated conflict and `doctor` keep-both repair twice with retained cache/context: replay creates no duplicate. After cache loss, prove old context/plan refusal and explicit retained-journal recovery or manual reconciliation, not guaranteed receipt replay. Exercise referenced conflicts and modify-versus-delete cases: originals and links remain recoverable and doctor reports ambiguity without unwanted resurrection.
3. Delete a canceled leaf through the app; verify propagation without cache resurrection. Reject referenced/bulk purges without partial writes. Repeat with an interrupted scan, missing manifest, offline peer, and app-level restore from a recovery copy.
4. Crash conversion at each staging step; validate that v1 remains usable. Reject mixed/unsupported roots on Node and Android, round-trip the v1 fixture through a v2 stage, and prove rollback and relationship/order preservation.

Remaining promotion/implementation obligations: turn these choices into accepted target specs and fixtures; prove nominated-device doctor/link repair and conflict-copy cleanup, incomplete-scan/SAF and partial-file refusal, retained recovery copies, cache-lost context handling, complete field migration and rollback on real writers. Until those cases are exercised, automatic union is transport evidence, not an application safety or interoperability claim.
