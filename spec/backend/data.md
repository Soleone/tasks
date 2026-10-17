# Data

A workspace is a folder. The folder is the whole collection: there is no workspace ID and no server.

```text
<root>/workspace.json        {"schemaVersion":2}
<root>/tasks/<id>.json       one file per task
```

Everything else (cache, receipts, undo history, journals, recovery copies) lives outside the folder and is never synced.

## Workspace file

| Rule | Then |
| --- | --- |
| `data.descriptor` | Writers create `workspace.json` as exactly `{"schemaVersion":2}` plus a newline, UTF-8, no BOM. Readers accept any legal formatting but require one integer `schemaVersion` equal to 2 |
| `data.schema-refuse` | Any other schema version is refused, never rewritten |
| `data.init-explicit` | Only `workspace.init` on an empty folder creates the workspace. Reading never initializes. Empty allows Syncthing's own markers, an empty `tasks` folder and the leftover of an interrupted init, so init after a crash simply runs again. A folder with task files but no descriptor is not empty |
| `data.mixed-format` | Old order files or old record fields inside a workspace are invalid |
| `data.transport-files` | Syncthing markers, ignore files and preserved conflict copies are allowed. They are not extra copies of the truth |
| `data.safe-entries` | Task entries are regular files inside the folder. Symlink escapes, unexpected subfolders and unrecognized task file names are reported and preserved, never silently skipped |

## Task fields

Every task file has exactly these 14 fields. Missing or extra fields make the file invalid (`INVALID_CANONICAL`); readers never fill in defaults.

| Field | Value |
| --- | --- |
| `id` | Matches the file name. New IDs are lowercase UUIDv4. Older IDs matching `[A-Za-z0-9_-]+` are accepted as they are |
| `title` | Non-empty, trimmed, at most 1,000 UTF-16 units. Stored literally, including text like `@alice` |
| `text` | The shorthand as typed (see [text input](commands.md#text-input)), trimmed, non-empty, at most 1,000 UTF-16 units, or `null`. Readers don't check that it matches `title`, `category` and `tags` |
| `description` | Markdown, at most 10,000 UTF-16 units. Line endings kept |
| `status` | `open`, `in_progress`, `paused`, `done`, `canceled` |
| `priority` | Integer 0 to 4 |
| `category` | A slug or `null` |
| `tags` | Unique slugs, sorted by bytes |
| `parentId` | An existing task ID or `null` |
| `dependencyIds` | Unique existing task IDs, sorted by bytes |
| `orderKey` | A valid order key (see [rules](rules.md#order)), at most 256 bytes |
| `createdAt`, `updatedAt` | Timestamps |
| `closedAt` | A timestamp when status is done or canceled, `null` otherwise |

```json
{"id":"a","title":"Call @alice","text":null,"description":"","status":"open","priority":2,"category":null,"tags":[],"parentId":null,"dependencyIds":[],"orderKey":"a0","createdAt":"2026-09-08T12:00:00.000Z","updatedAt":"2026-09-08T12:00:00.000Z","closedAt":null}
```

## Values

| Rule | Then |
| --- | --- |
| `data.json-strict` | Valid UTF-8, no BOM, no duplicate keys, no unpaired surrogate escapes, no comments or trailing commas. Property order and indentation are free |
| `data.utf16-length` | Length limits count characters above U+FFFF as two units |
| `data.trim` | Titles are trimmed of Unicode outer whitespace (U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). Inner spacing is kept |
| `data.slug` | A slug matches `^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$`. `null` category is different from a category named `uncategorized` |
| `data.no-labels` | There is no stored label for a slug. Descriptions never set category or tags |
| `data.timestamp` | UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0000 to 9999, real calendar dates (no February 30), no leap seconds, exactly three millisecond digits |
| `data.clock-free` | Timestamps don't have to increase. Time never decides a conflict |
| `data.graph` | Parent links and dependency links are each free of cycles, self-links and missing targets. Links to canceled tasks are valid |
| `data.blocked-by` | A task's blockers are its dependencies that aren't canceled. Done dependencies still block |
| `data.whole-graph` | A missing file, partial read or broken link makes the observation incomplete. Writes need a complete, valid graph |
