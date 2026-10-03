# V2 storage and recovery

**Status: accepted target, not implemented.** [Overview](overview.md). This page owns collection/files, observation, journals, destructive recovery and doctor. Model/protocol/migration have separate owners.

## Root

```text
<root>/workspace.json
<root>/tasks/<id>.json
```

The selected directory/provider handle IS the collection. No workspace/collection ID. Writers MUST create the immutable descriptor with exact UTF-8 bytes `{"schemaVersion":2}\n`, no BOM. Readers accept legal JSON formatting but require exactly one integer-valued schemaVersion equal to 2. Unsupported versions are refused, not rewritten. Duplicate keys/extra descriptor fields/malformed records are invalid canonical data. Nonempty legacy order files or legacy record fields in a v2 tree are mixed-format errors.

Only explicit `workspace.init` on an empty selected existing directory may create the descriptor/tasks directory. Empty tasks directory and transport markers are permitted. Existing records, versioned data or unrelated non-transport content MUST NOT be overwritten/reinterpreted as a fresh collection. Reads never initialize. Missing/unreadable root or descriptor with records is not an empty workspace.

Local SQLite/WAL/history/receipts/journals/recovery copies MUST live outside the synced tree. Syncthing markers/versioning/ignore files and preserved conflict copies are transport artifacts, not additional canonical task authorities. Task entries MUST be regular documents inside the bound tree. Refuse symlink/reparse escapes, unexpected subdirectories or foreign provider handles before reading their content; a selected root itself may be resolved explicitly to its authorized physical directory. Unrecognized task JSON names or invalid/partial files MUST be reported/preserved; do not build a partial writable projection by ignoring them. Conflicts at the descriptor with incompatible schemas require inspection/restore of a verified root, not arbitrary new-manifest repair.

The [bounded Linux capture journal](conformance.md#recoverable-capture-and-status) fixes one creation ID/time/key and directory/scope bytes. Initial local progress precedes immutable pending publication; publication start precedes the no-clobber task link. Lost progress or an absent target after that marker is uncertain and requires preserved inspection, never guessed pre-publication or task resurrection. Complete stage-write-before-binding remains recoverable under the initialized progress record. Completed request receipts remain SQLite-only.

The [bounded Linux lifecycle implementation](conformance.md#explicit-initialization-and-retained-cache-rebuild) now exercises explicit init, no-clobber descriptor publication and guarded recovery on disposable filesystem roots. Unbound directory creation/unpublished progress requires preserved inspection; this does not establish the complete storage/native/provider profile.

## Identity

Normal capture and doctor clones MUST generate lowercase UUIDv4 (`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`), once per intended operation. No caller ID through create. Readers/importers accept legacy `[A-Za-z0-9_-]+`, preserving case and exact filename stem. Reject record/stem mismatch and provider filename aliases; do not overwrite/rename a case collision. Planned clone IDs cannot collide with observed canonical/conflict IDs. A prewrite collision requires a new explicit plan; replay cannot silently allocate a replacement ID.

## Observation

Validate root binding/manifest, successful complete enumeration, valid file bytes and the full graph. Recheck command-relevant membership and exact bytes under the cooperating local-writer lock. Size/mtime alone is not a baseline; hash exact observed bytes (SHA-256), never replacement-decoded or reserialized JSON. Formatting-only changes are stale too. A successful complete scan may remove absent records from the query cache, never recreate their files.

Permission failures, truncated listings, partial JSON/encoding, missing manifest, graph holes/cycles or changed binding are incomplete observations. Retain a clearly stale last-good inspection view if useful, not fresh mutation authority. Repeated stable enumeration does not prove remote transfer completion or a distributed snapshot. Ordinary mutation requires a complete valid graph; explicit doctor may plan reviewed dangling-link repair.

Cooperating same-device writers MUST share the lock/journal domain for the selected physical root. Syncthing/arbitrary editors are noncooperating. Final-read plus atomic replacement is NOT hash-conditioned CAS: an unseen racing edit can be overwritten before it is archived or synced. Preserve observed/conflict versions, warn about best-effort external-writer limits, and use independent backups. No lossless-CAS or CRDT claim.

## Journal

Before the first file change persist one immutable, non-synced pending intent: root binding, affected scopes/membership/byte guards, request/actor identity, fixed intended IDs/keys/times, old and next bytes, intended absence for deletion and progress/outcome evidence. Implementations may compact guards; they cannot discard the information needed for safe replay.

Validate all effects before writes, then verify scope/baselines before every replacement/deletion. Persist recovery/archive copies before destructive changes. Verify final bytes/graph before committing local receipt/activity/versions and emitting success. No distributed atomicity is promised; receivers may temporarily report an incomplete graph.

Ordinary queries/writes MUST report `RECOVERY_PENDING` rather than present unfinished work as successful. Info/doctor inspection remain available. Explicit recovery recognizes exact already-applied bytes/absence, applies only unchanged preimages, and retains the original plan IDs. New membership, divergence, missing planned-to-exist files, malformed/partial data or wrong binding stops with `RECOVERY_CONFLICT`. Never roll back another writer, recreate an unexplained missing file, or replace a divergence with freshly invented intent. A journal-authored planned deletion may be recognized as already applied; unrelated disappearance is not one.

With retained cache/context, recovery can commit the original receipt. Cache loss requires fresh local authority and explicit journal recovery/manual reconciliation; it does not revalidate an old request/context. Generic previews never resume pending writes. Providers lacking required enumeration/guarded replace/verify capabilities MUST withhold the corresponding writable command; partial-byte outcomes require explicit preserved recovery, not claimed Node parity.

Retain unresolved journals and destructive recovery copies until explicit user removal, with loss warnings. Do not silently expire them. Completed pending intent may be retired only after a durable local outcome/receipt; it is not a separate ledger of every completed request. Removing receipts/history invalidates context under protocol. Local artifacts do not survive all storage loss; backups remain necessary.

## Archives

Archive copies a validated schema-2 canonical tree and known raw conflict originals, never cache/receipts/history. Restore validates that artifact into a new root, never imports a legacy SQLite snapshot or silently changes selection. Source bytes MUST stay unchanged. Destinations must be caller-authorized, absent/empty and disjoint from source after actual path/provider resolution; overlap fails `INVALID_ARGUMENT`, occupied output `DESTINATION_NOT_EMPTY`. Guard source inventory/bytes, retain local copy intent, verify the staged output and completion report before offering it as usable. Interruption leaves an explicitly incomplete stage, not a valid restore. Adoption creates fresh local authority under protocol. These artifacts are independent recovery copies, not shared operational ledgers.

## Purge

`task.delete` is cancellation. `task.purgeCanceled` proposes the complete canceled set. If ANY surviving task's parent or dependency points into that set, fail `PURGE_REFERENCED` with survivor/target/field details before writes. Done status does not unlink a surviving child. Closed linked subgraphs may be purged together if no survivor references them. Do not automatically reparent/unlink. Empty set is a receipt-only no-op. Guard the full graph, preserve a local recovery copy, and journal the batch. No canonical tombstones. A missing file is absence, not proof of intended vs accidental deletion; observation MUST NOT resurrect it.

## Doctor

Routine disjoint-ID joining is ordinary file union. Identical bytes at the same ID are one task. Divergent versions/conflict copies remain explicit issues, not automatic clones/JSON merge winners. Edit-versus-delete outcomes depend on transport; inspecting an old copy must never resurrect it automatically.

Nominate one repair device. Complete the known sync, pause participating sharing/writers, inspect/plan/apply there, resume sharing and verify convergence before another repair. Other devices may inspect, not compete. This is cooperating-user coordination, not a distributed lock or cross-device exactly-once claim.

1. Inspection returns immutable version references based on relative paths/task ID/exact-byte fingerprints, plus incoming links/issues. Invalid data is inspectable but not a validated repair source.
2. Explicit local planning chooses which valid version retains the original ID, fixed clone IDs for each alternate, output keys and complete graph/scope guards. Copy source content/time unchanged except chosen links/ID; retain each chosen version's valid source key unless an explicit reparent edit requires first-in-new-scope allocation. Equal clone keys remain legal; no implicit whole-scope rekey. Every observed surviving reference to a split ID, including references originating in copied versions, requires an explicit target-version choice. Missing choices fail `AMBIGUOUS_LINK`. Dangling repairs require explicit unlink/reparent edits. Validate the full prospective graph.
3. Plan creation may persist in SQLite; before application copy fixed plan/bytes to pending journal and preserve raw originals in verified non-synced recovery. Applying the reviewed plan ID is explicit confirmation. Changed source/link/scope fails `STALE_REPAIR_PLAN`, no new IDs or partial preflight changes.
4. Write/verify clones, chosen canonical and explicit relationship edits. Real link changes advance edit time; copying a version preserves source times. Only AFTER all planned outputs and recovery copies verify may explicitly selected conflict copies be removed under byte guards. Their local recovery bytes remain available. Cleanup disposition MUST appear in the plan.
5. Restart/same-key retry with retained state uses the same receipt/IDs. Crash before cleanup leaves the fixed intent, not permission for a second clone. Divergence stops recovery. Cache loss rejects old context/plan; retained journals can be explicitly recovered, not blindly reissued.

Local repair history can flag later, previously unreviewed references to a split ID. Preserve/report these links; never silently redirect. Other devices or lost local history cannot infer historical ambiguity from the minimal graph. Independently repaired/reintroduced versions need explicit review. Doctor is not generic undo or an unrestricted merge editor; use reviewed restore/reconcile from its recovery copy or a new verified root.

Normative cases: `root-empty`, `root-missing-manifest`, `root-mixed`, `root-unsupported`, `root-alias`, `root-escape`, `join-disjoint`, `join-identical`, `join-conflict`, `edit-delete`, `purge-referenced`, `purge-closed-subgraph`, `scan-partial`, `recover-prefix`, `recover-divergence`, `doctor-ambiguous`, `doctor-replay`, `doctor-stale`, `doctor-cache-loss`, `doctor-late-link`, `doctor-cleanup`, `preview-pending`, `archive-restore`, `destination-overlap`.
