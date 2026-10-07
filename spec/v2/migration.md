# V1 to v2 migration

**Status: accepted target; bounded implementation.** [Current support](../../docs/support.md). [Overview](overview.md). No live conversion, default upgrade or personal-data use is authorized by spec acceptance. A converter must pass these fixtures and fault/recovery proof on disposable roots first. A bounded Linux Node control now has [disposable command/recovery and explicit root/client rollback evidence](conformance.md#guarded-v1-migration-and-explicit-rollback); the full native/provider/rollout target remains unaccepted.

## Source

Pause writers/sharing. Preserve an independent complete v1 snapshot and optional cache backups. Selected source MUST have verified v1 descriptor, task/order hashes, exact filename IDs, complete field/graph/order inventory, no duplicate JSON members, unknown fields or unresolved conflict copies. Every task appears exactly once in its correct sibling sequence. Refuse incomplete order rather than inventing a cache-dependent fallback. SQLite is not a source for missing canonical content.

## Mapping

| V1 | V2 |
| --- | --- |
| task ID, status, priority, parent/dependency IDs | Preserve exact values/edges; sort dependency IDs only, not membership. |
| title | V1 token recognition (no new escape interpretation); remove only recognized metadata spans, outer-trim, preserve other spacing/code. Validate resulting literal title. |
| derived title category/tags | Lowercase canonical slug/null, unique byte-sorted tags. No case-label dictionary; original title spelling remains in source snapshot. |
| descriptionMarkdown | Same Markdown string as description, preserving line endings. |
| createdAt/updatedAt | Preserve instants; retain legacy updatedAt even when it means status change. Do not reconstruct an older edit time. |
| completedAt for done / canceledAt for canceled | Matching instant to closedAt; active status maps null. Inconsistent terminal data refuses conversion. |
| sibling sequences | Per scope `generateNKeysBetween(null,null,count)` using pinned ordering; preserve full sequence including inactive tasks. |
| task format/formatVersion/workspaceId/sync | Omit from target; originals remain in independent recovery snapshot. |
| root descriptor | Exact v2 descriptor bytes; no workspace ID and no old order files. |
| cache versions/receipts/history/settings/labels | Not task data or new write authority. Keep optional old artifacts separate. |

Conversion may accept unambiguous RFC 3339 UTC/explicit offsets whose instants are millisecond-representable within target year range. Normalize to exact UTC spelling; reject invalid calendar/time, unknown `-00:00` offset, leap second, ambiguous/local time and sub-millisecond instants instead of guessing/rounding. All canonical v2 timestamps thereafter follow model.

Metadata-only titles, unsafe/aliased IDs, missing order members, invalid time, unresolved graph/conflict or unsupported field cause `MIGRATION_INVALID_SOURCE` with affected path/ID/field/reason, no silent repair. `workspace.migrateV1` is a control command explicitly inspecting v1; ordinary protocol-2 task commands on that root still refuse `UNSUPPORTED_SCHEMA`.

## Stage

`workspace.migrateV1` with an absent/explicitly empty non-shared destination disjoint from the source tree previews or executes one verified inventory. Never write the selected v1 source, overwrite a destination, switch selection or enable sharing automatically. Nonempty destination fails `DESTINATION_NOT_EMPTY`; source/destination overlap fails `INVALID_ARGUMENT`. Persist fixed source fingerprints/mappings in local intent before target writes. Changes fail `MIGRATION_CONFLICT`, preserving source and incomplete stage; replay cannot generate a different inventory.

Build target in staging, reread via strict v2 validation, compare IDs/counts/edges/full sibling sequences/Markdown and mapped timestamp/classification values, then produce a completion report including source/destination, transformed IDs and recovery location. Failure/interruption leaves client on v1 and stage explicitly incomplete. Incomplete output MUST NOT be offered for selection/sharing. Verification and a completion report are the publication boundary, not existence of a half-written v2 manifest. A retained intent may resume only unchanged source/preimages or exact already-written target bytes.

A previously shared v1 collection migrates once from one verified snapshot; replicate its verified output after all clients support it. Independent collections stage separately while disconnected, then join valid v2 roots. Do not mix v1/v2 in one tree or let old clients write v2.

## Rollback

After verified staging, the user explicitly selects the v2 root with fresh local cache/context/tokens. Never port v1 receipt/version authority. Rollback explicitly selects the preserved v1 snapshot with its v1 client, restoring pre-migration state, NOT reverse-converting later v2 edits. Warn before rollback; retain the v2 root separately. Neither source nor target is silently overwritten.

The [v1 fixture](../../scripts/fixtures/taskdb-v1/README.md) maps to the committed full-field [golden root](../../scripts/fixtures/taskdb-v2/README.md). Cases `migrate-golden`, `migrate-title-only-tokens`, `migrate-legacy-escape`, `migrate-offset`, `migrate-invalid-time`, `migrate-order-missing`, `migrate-unknown-field`, `migrate-interrupted`, `migrate-source-change`, `migrate-destination`, `rollback` are normative expected outcomes. Corpus-integrity checks alone are not converter or rollback proof. A bounded [read-only converter component](../../src/backend/v2V1Conversion.ts) now matches that independent golden and checks source/mapping vectors; it returns bytes in memory without publication, migration-command receipts, selection or rollback. The separate [public migration control](../../src/backend/v2MigrationWriter.ts) now provides guarded publication/replay/recovery, and tests demonstrate explicit fresh-authority v2 selection and return to a preserved v1 folder with the real v1 CLI. Its local recovery artifact is a verified raw-byte archive, not a receipt ledger; completed originals remain independent of both roots. [Measured evidence](conformance.md#guarded-v1-migration-and-explicit-rollback) is separate from native/provider/rollout acceptance. No automatic selection, reverse conversion or personal-data migration is authorized.
