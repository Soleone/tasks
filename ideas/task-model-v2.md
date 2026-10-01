# TaskDB v2 data model proposal

**Status:** Reconciled working proposal, not accepted or implemented. Root [spec/model.md](../spec/model.md) remains the v1 authority. [Behavior](task-behavior-v2.md) owns mutations/timestamps, [commands](protocol-v2.md) owns inputs/projections/retries, [collection lifecycle](collection-lifecycle-v2.md) owns file identity/validation/migration procedure, and [ordering](syncthing-sync-ordering.md) owns exact keys and observation rules. Promote a versioned target with fixtures before production changes.

## Manifest and canonical task

The selected directory is the collection boundary. Its target manifest is `{ "schemaVersion": 2 }`; no `format`, `workspaceId`, or collection ID. Exact encoding and root negotiation are owned by lifecycle. Schema 2 is the selected target number, not an approved change to live v1 data or SQLite's unrelated schema version.

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "title": "Review release",
  "description": "",
  "status": "open",
  "priority": 2,
  "category": "planning",
  "tags": ["product"],
  "parentId": null,
  "dependencyIds": [],
  "orderKey": "a0",
  "createdAt": "2026-09-08T20:51:04.113Z",
  "updatedAt": "2026-09-08T20:51:04.113Z",
  "closedAt": null
}
```

All listed fields are required in a canonical file, even empty strings, arrays, and `null`s. No implicit reader defaults. Reject unknown fields, including legacy `format`, `formatVersion`, `workspaceId`, `descriptionMarkdown`, lifecycle timestamp aliases, and `sync`; do not silently discard them on write. Future extensions require a negotiated schema change, not a reserved metadata framework. The filename establishes the record's role, so no `type` or per-task schema version is needed.

| Field | Selected meaning/validation |
| --- | --- |
| `id` | Matches filename exactly. New-ID and legacy-ID rules are owned by lifecycle. |
| `title` | Literal nonempty Unicode text, at most 1,000 UTF-16 code units after outer whitespace trimming. No classification parsing on read. |
| `description` | Markdown string, at most 10,000 UTF-16 code units; empty by default at creation. Replaces `descriptionMarkdown`. Preserve its content and line endings. |
| `status` | `open`, `in_progress`, `paused`, `done`, or `canceled`. |
| `priority` | Integer 0–4; creation defaults to 2. |
| `category` | One canonical lowercase slug or `null`. |
| `tags` | Canonical lowercase slugs, unique and sorted by ASCII byte order. |
| `parentId` | Another ID in the same collection or `null`; no self-parent or parent cycles. |
| `dependencyIds` | Same-collection IDs, unique and sorted by byte order; no self-link or dependency cycles. Missing-target handling during transport is owned by lifecycle. |
| `orderKey` | The selected fractional-key grammar, comparator, and 256-byte limit in the ordering proposal. |
| `createdAt` | Creation instant; ordinary edits never change it. |
| `updatedAt` | Last non-lifecycle edit under the behavior rules, with the explicit migration exception below. |
| `closedAt` | Non-null exactly for `done`/`canceled`; the current closure instant, not a history of prior closures. |

String limits intentionally retain v1's UTF-16 counting: a Unicode scalar above U+FFFF counts as two units, otherwise one. This is a portable counting rule, not a requirement to implement in JavaScript. Reject invalid UTF-8 and unpaired surrogate escapes instead of replacing text. Canonical titles must already be nonempty and outer-trimmed; commands trim outer whitespace but preserve internal literal text. Use the ECMAScript `String.trim` whitespace set (U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000, U+FEFF) so other clients can reproduce it.

Canonical timestamps use valid proleptic-Gregorian UTC `YYYY-MM-DDTHH:mm:ss.sssZ` instants, not merely a matching regex: four-digit year 0000–9999, valid month/day, hours 00–23, minutes/seconds 00–59, and exactly three millisecond digits; no leap-second spelling. Explicit conversion from a recognized legacy artifact may normalize an unambiguous RFC 3339 timestamp with an explicit UTC/offset and millisecond-representable instant; malformed/ambiguous, unknown-offset (`-00:00`), leap-second or sub-millisecond values fail rather than guessing/rounding. Canonical readers validate this spelling, never normalize files implicitly. No ordering constraint between timestamps is imposed, because device clocks can move backward. Timestamps are never merge winners or optimistic tokens.

## Classification and literal titles

**Operator decision (2026-10-01):** JSON `title` is literal. A separate `text` command input supports inline `@category`/`#tags`. Recognized shorthand metadata is removed before storage. A literal title `Call @alice` with `category: null` stays exactly that task text; import, query, and edit must not turn `alice` into a category.

A canonical slug matches `^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$`: ASCII letter first, word character last, internal hyphens/underscores permitted. This matches the slugs produced by the v1 token grammar, including its trailing-hyphen boundary behavior. No `@`/`#` prefix is stored in category/tags. Commands normalize ASCII uppercase to lowercase, deduplicate tags, and sort them; canonical readers validate the already-normalized values without rewriting files. Multiple distinct shorthand categories fail, not “last wins.”

No canonical display-label dictionary. Category/tag API values are those slugs; case-only legacy labels are not portable task data in v2. Original v1 files and optional old snapshots preserve their prior display information. A UI may present local labels, but they cannot change canonical classification or filtering semantics.

The command proposal owns shorthand scanning/escaping and the distinction between literal partial updates and full shorthand replacement. Descriptions never supply classification. Category `null` and empty tags mean absent classification; `uncategorized` is not an invented persisted category. An actual explicit slug named `uncategorized` remains an ordinary category, distinct from null.

## Excluded from canonical files

No optimistic version, write context, receipt, operation/undo record, activity history, dense sibling position, source ref, device/writer identity, `sync` block, observed hash, or shared workspace hash. SQLite and bounded local recovery artifacts are non-synced. Cache-only receipts and their loss limitations are owned by the command proposal. There is no new synced retry or repair ledger.

## Exact v1 field mapping

Use only a verified v1 canonical snapshot; the lifecycle proposal owns staging, rollback, and sharing. This table is a selected transformation, not an implemented converter.

| V1 input | V2 target |
| --- | --- |
| `id`, status, priority, parent and dependency IDs | Preserve IDs/values and graph edges; sort dependency IDs without changing membership. |
| `title` | Use **v1 token recognition**, including its code/boundary rules; remove only recognized metadata spans and trim outer whitespace, preserving other text/code/internal spacing. Apply v2 title validation. Do not use v2 escapes retroactively or the copy helper's broad whitespace collapse. |
| Derived title category/tags | Store lowercase slug/null and sorted unique slug array. No marker tokens or display labels in classification fields. |
| `descriptionMarkdown` | `description`, same Markdown string. |
| `createdAt` | Same instant in the selected UTC spelling. |
| `updatedAt` | Preserve the v1 instant; it may represent a status transition rather than a content edit. Earlier edit time is not reconstructable from canonical files. The new meaning applies to subsequent v2 edits, not invented historical data. |
| `completedAt` for done / `canceledAt` for canceled | `closedAt` from the matching field; active statuses map to null. Inconsistent/missing terminal data fails conversion. |
| Complete v1 sibling order | Allocate keys independently per validated scope using the ordering proposal. Preserve sequence, including inactive tasks. |
| `format`, `formatVersion`, `workspaceId`, `sync` | Remove from target task records; retain original bytes in the independent v1 recovery snapshot. |
| Cache versions, labels, activity, receipts, undo, settings | Not canonical v2 task fields. Do not invent them from JSON or reuse them as fresh v2 write authority. Preserve optional old cache backups separately. |

If removing metadata leaves a token-only title empty, a timestamp is invalid, an ID/path is unsafe, an order file is incomplete, a conflict is unresolved, or a field cannot be mapped without loss, report the affected task(s) and fail staging. No invented title/time/ID, silent fallback order, or automatic graph repair. Optional pre-conversion fixes require a separate explicit action against the preserved source or a reviewed conversion plan, never an unnoticed transformation.

## Compatibility examples and fixture obligations

| Case | Expected target outcome |
| --- | --- |
| Literal title `Call @alice`, category null | Read back literally, no classification. |
| Title-only partial update of an already classified task | Classification survives; command rules apply. |
| Legacy `Review @Work #TODO` | Title `Review`, category `work`, tags `["todo"]`; original spelling remains in the v1 snapshot. |
| Legacy token-only `@Work #TODO` | Conversion refuses an empty target title. |
| Legacy `\\@Work` | Apply v1 recognition, not the new shorthand escape rule; preview the transformation and preserve original bytes. |
| Legacy done at time C, updated at the same closure time | Preserve C in both mapped fields; do not fabricate a previous edit timestamp. |
| Unknown `sync` or other unrecognized field in a schema-2 task | Reject as invalid canonical data; do not rewrite or import a partial projection. |

Before promotion, give these mappings normative fixtures alongside shorthand, Unicode/length, timestamp, graph, and ordering failures. Full migration/rollback, root negotiation, and platform conformance remain separate gates; the existing sibling-sequence model is not full conversion evidence.
