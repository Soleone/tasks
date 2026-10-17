# Migration from schema 1

Schema 1 is the format of the original app. `workspace.migrate` converts a schema 1 folder into a new schema 2 folder once. It is the only place schema 1 is read.

## Before

| Rule | Then |
| --- | --- |
| `migrate.pause` | Pause sharing and other writers and keep an independent copy of the schema 1 folder |
| `migrate.source-valid` | The source has a valid schema 1 descriptor and task records, no unknown fields, no duplicate JSON keys and no unresolved conflict copies. Sibling order files and the order directory are optional. Present order records must have valid fields, hashes and unique IDs; only task records determine sibling membership. Plain files at the top that aren't JSON can't hold tasks and are left behind. Otherwise `MIGRATION_INVALID_SOURCE` with the path, ID, field and reason |
| `migrate.no-cache-source` | The old cache never fills in missing content |

## Mapping

| Schema 1 | Schema 2 |
| --- | --- |
| ID, status, priority, parent, dependencies | Kept exactly. Dependencies sorted |
| Title | Schema 1 marker recognition (no escape handling) removes `@category` and `#tag` spans; the rest is kept and trimmed |
| Category and tags from the title | Lowercase slugs, tags unique and sorted |
| Title as typed | `text`, trimmed, when current shorthand reads it to the same title, category and tags. Otherwise `null` |
| `descriptionMarkdown` | `description`, unchanged |
| `createdAt`, `updatedAt` | Kept as instants, even where `updatedAt` reflects a status change |
| `completedAt` (done) or `canceledAt` (canceled) | `closedAt`. Active tasks get `null`. Inconsistent closure data refuses |
| Sibling order | Keep saved sibling positions, discard references outside the sibling set and append missing siblings sorted by ID, including inactive tasks. With no saved order, sort siblings by ID. Assign `generateNKeysBetween(null, null, n)` per complete sibling set |
| `format`, `formatVersion`, `workspaceId`, `sync` | Dropped. They stay in the source copy |
| Cache versions, receipts, history, settings | Not migrated |

| Rule | Then |
| --- | --- |
| `migrate.time` | Unambiguous RFC 3339 times with `Z` or an explicit offset convert to UTC with milliseconds. Local times, `-00:00`, leap seconds, invalid dates and sub-millisecond precision refuse |
| `migrate.metadata-only-title` | A title that is only markers refuses |

## Running it

| Rule | Then |
| --- | --- |
| `migrate.destination` | The destination is absent or empty, not shared, and outside the source. The source is never written |
| `migrate.stage-verify` | The output is built, reread under schema 2 rules and compared (IDs, counts, links, sibling sequences, text, times, classification) before a completion report is produced |
| `migrate.incomplete` | An interrupted or failed run leaves the output marked incomplete. It is never offered for use or sharing |
| `migrate.source-change` | A source that changes during migration fails `MIGRATION_CONFLICT` |
| `migrate.no-switch` | Migration never switches the open workspace or enables sharing |

## After

| Rule | Then |
| --- | --- |
| `migrate.fresh-authority` | Opening the new folder starts with a fresh cache and context. No old receipts or versions carry over |
| `migrate.shared-once` | A shared workspace migrates once from one verified copy; share the result after every device can read schema 2 |
| `migrate.rollback` | Rolling back means opening the preserved schema 1 copy. Edits made after migration are not converted back |
