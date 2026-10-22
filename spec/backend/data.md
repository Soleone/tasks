# Data

A workspace is a folder. The folder is the whole collection: there is no workspace ID and no server.

```text
<root>/workspace.json        {"schemaVersion":2}
<root>/tasks/<id>.json       one file per task
<root>/attachments/<name>    one file per image, written once
```

Everything else (cache, receipts, undo history, journals, recovery copies) lives outside the folder and is never synced.

## Tasks home

The app and the CLI work in a Tasks home that the owner chooses. Its `sync/` folder is the workspace; the rest belongs to this device.

```text
<home>/settings.json         this device's preferences
<home>/sync/                 the workspace, the only folder a sync tool may see
<home>/local/                caches, writer lock, recovery files, undo records; never synced, not disposable
<home>/exports/              exports made on this device; never synced
<home>/.nomedia              Android only: keeps the gallery out of the home
```

| Rule | Then |
| --- | --- |
| `home.layout` | Everything Tasks keeps for a device is in its home. A root whose folder is named `sync` beside a `local/` folder keeps its writer lock and recovery files in that `local/`, so every spelling of the path and every cache shares them. Other roots (old folders being converted) keep theirs beside the selected cache |
| `home.create` | Only explicit setup creates a home, inside an existing parent. It refuses a folder holding anything but a home's own entries (including `exports/` and `.nomedia`), a task folder from before homes, and a home's own `sync/` or `local/`. Setup interrupted part way simply runs again |
| `home.refuse-unsafe` | A home can't be inside a Syncthing folder (`.stfolder` in the home or above it), inside another home, inside OneDrive, on a network share, or on Android outside shared storage. Opening repeats the Syncthing check, so adding the whole home to Syncthing stops writes |
| `home.missing` | A missing or unreachable home is reported with its path. Nothing is created in its place and it is never treated as a first launch |
| `home.no-media` | On Android, setting up or opening a home creates an empty `.nomedia` in it if missing, so the system gallery doesn't index attachments. It sits outside `sync/`, so it never syncs |
| `home.documents` | Preferences (`settings.json`) and client undo records (`local/undo.json`) are replaced durably: staged, flushed, renamed. A file the app can't read is kept beside the new one as `*.damaged-<time>.json` |

## Workspace file

| Rule | Then |
| --- | --- |
| `data.descriptor` | Writers create `workspace.json` as exactly `{"schemaVersion":2}` plus a newline, UTF-8, no BOM. Readers accept any legal formatting but require one integer `schemaVersion` equal to 2 |
| `data.schema-refuse` | Any other schema version is refused, never rewritten |
| `data.init-explicit` | Only `workspace.init` on an empty folder creates the workspace. Reading never initializes. Empty allows Syncthing's own markers, an empty `tasks` folder and the leftover of an interrupted init, so init after a crash simply runs again. A folder with task files but no descriptor is not empty |
| `data.mixed-format` | Old order files or old record fields inside a workspace are invalid |
| `data.transport-files` | Syncthing markers, ignore files and preserved conflict copies are allowed. They are not extra copies of the truth |
| `data.safe-entries` | Task entries are regular files inside the folder. Besides `tasks/`, the only expected subfolder is `attachments/`, created by the first attachment write. Symlink escapes, unexpected subfolders and unrecognized task file names are reported and preserved, never silently skipped |

## Task fields

Every task file has these 14 required fields and may have the optional fields below. A missing required field makes the file invalid (`INVALID_CANONICAL`).

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

### Optional fields

| Field | Value | Default |
| --- | --- | --- |
| `attachments` | File names in `attachments/`, unique, in the order they were added, at most 10 | `[]` |
| `due` | A calendar date, `YYYY-MM-DD`, with no time or zone | `null` |

| Rule | Then |
| --- | --- |
| `data.optional-fields` | A missing optional field means its default. Writers leave out a field at its default, so a task without attachments has no `attachments` key. Readers also accept the default written out |
| `data.unknown-fields` | A field this build doesn't know makes the file unreadable here, reported as written by a newer version of Tasks (`UNSUPPORTED_SCHEMA`) with the field name. The file is never rewritten |
| `data.schema-additive` | Adding an optional field doesn't change `schemaVersion`. A new version is only for changes an older build would misread |

> Why: optional fields let a new build read every existing file unchanged. Refusing unknown fields, instead of carrying them along, means an older device can't quietly drop what a newer one wrote.

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
| `data.attachment-name` | An attachment name is the UTC time it was added and 8 random lowercase hex digits: `YYYY-MM-DD-HHMMSS-xxxxxxxx.ext`, with `png`, `jpg`, `webp` or `gif`. Name order is time order |
| `data.attachment-file` | An attachment is a regular file of at most 10 MiB whose bytes match its extension's image format, checked when it is written and again when it is read. It never changes once written. Reading the workspace never lists or opens `attachments/`, and anything else in it is left alone |
| `data.attachment-missing` | A listed attachment whose file is absent doesn't make the task invalid or the observation incomplete. It may not have synced yet, or was removed on another device |
| `data.whole-graph` | A missing file, partial read or broken link makes the observation incomplete. Writes need a complete, valid graph |
