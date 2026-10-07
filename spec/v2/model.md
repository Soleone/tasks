# V2 model

**Status: accepted target; bounded implementation.** [Current support](../../docs/support.md). [Overview](overview.md) defines acceptance and owners. Storage owns names/identity; protocol owns inputs; mutations owns effects; migration owns conversion.

## Fields

Every canonical task MUST contain exactly these 13 fields. Unknown or omitted fields fail `INVALID_CANONICAL`; null/empty values are explicit, not reader defaults. Readers MUST NOT parse classification from canonical titles or rewrite a normalized projection back to disk during observation.

| Field | Required value |
| --- | --- |
| `id` | Nonempty safe filename ID, exactly matching its canonical filename; [storage](storage.md#identity) owns UUID/legacy rules. |
| `title` | Nonempty, outer-trimmed Unicode string, at most 1,000 UTF-16 units, literal including marker-like text. |
| `description` | Markdown string, at most 10,000 UTF-16 units; line endings/content preserved. |
| `status` | `open`, `in_progress`, `paused`, `done`, `canceled`. |
| `priority` | Integer 0–4. |
| `category` | Canonical slug or null. |
| `tags` | Unique, ASCII-byte-sorted canonical slug array. |
| `parentId` | Safe existing task ID or null. |
| `dependencyIds` | Unique, byte-sorted safe existing task IDs. |
| `orderKey` | Valid key under [ordering](ordering.md#keys), at most 256 ASCII bytes. |
| `createdAt`, `updatedAt` | Canonical timestamps. |
| `closedAt` | Canonical timestamp exactly when status is done/canceled; null otherwise. |

```json
{"id":"a","title":"Call @alice","description":"","status":"open","priority":2,"category":null,"tags":[],"parentId":null,"dependencyIds":[],"orderKey":"a0","createdAt":"2026-09-08T12:00:00.000Z","updatedAt":"2026-09-08T12:00:00.000Z","closedAt":null}
```

`a` illustrates an accepted legacy ID, not normal new-ID generation. No `type`, per-task version, `format`, `workspaceId`, `descriptionMarkdown`, terminal timestamp aliases, `sync`, version/context or extension bag. Future fields require negotiated schema changes; a v2 reader MUST preserve/refuse unsupported data, not discard it.

## Text

JSON bytes MUST be valid UTF-8, without BOM, duplicate member names, non-finite decoded numbers or unpaired surrogate escapes. Syntax permits ordinary legal whitespace/property ordering. Serialization of task properties/indentation need not match byte-for-byte across clients; exact bytes still define stale-write guards. Comments/trailing commas are not JSON.

For size limits, each Unicode scalar above U+FFFF counts as two UTF-16 units, others as one. This preserves v1 limits without requiring JavaScript. Outer trim uses U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000, U+FEFF. Commands trim title edges; canonical files MUST already satisfy the rule. Internal literal spacing and descriptions MUST NOT be collapsed.

## Classification

A slug matches `^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$`: ASCII letter first, word character last, internal hyphens/underscores allowed. Canonical slugs are lowercase, without markers. Input normalization lowercases ASCII, deduplicates/sorts tags; canonical readers validate rather than normalize files. Category null is distinct from a literal slug `uncategorized`. No display-label dictionary is canonical; descriptions never supply classification. [Protocol](protocol.md#inputs) owns shorthand and partial-update semantics.

## Timestamps

Valid proleptic-Gregorian UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0000–9999, actual month/day, hours 00–23, minutes/seconds 00–59, exactly three millisecond digits; no leap-second spelling. Reject February 30 even if a library normalizes it. Device clock reversal is permitted: there is no requirement that fields numerically increase or updated/closed follow created. Time is neither merge winner nor optimistic authority. [Mutations](mutations.md#time) defines field changes; [migration](migration.md#mapping) alone permits recognized legacy time normalization.

## Graph

IDs are case-sensitive and collection-local. Parent and dependency graphs separately MUST be acyclic, with no self-links/missing targets. Existing canceled links are valid and removable; new choices are restricted by mutations. A task's `blockedByIds` projection includes every dependency whose status is NOT canceled, including done; canonical `dependencyIds` retain canceled links.

Partial transport/missing graph data is a reported incomplete observation, not authorization to rewrite/repair. Doctor MAY plan explicit link repair under [storage](storage.md#doctor). Check the complete prospective graph before any ordinary batch/undo/repair write.

Normative cases: `record-literal`, `record-unknown`, `record-missing`, `record-terminal`, `record-invalid-date`, `record-clock-backward`, `record-utf8`, `record-surrogate`, `record-duplicate`, `title-limit`, `title-over-limit`, `graph-missing`, `graph-parent-cycle`, `graph-dependency-cycle`, in the [corpus](../../scripts/fixtures/taskdb-v2/README.md).
