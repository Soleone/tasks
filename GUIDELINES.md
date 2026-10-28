# Guidelines

Defaults, not rigid rules.

- **Build for daily use.** Quick capture, clear next actions and keyboard-friendly flows beat a growing feature list. External agents come before a built-in assistant.
- **One command path.** UI and CLI share the same TypeScript rules and contracts. Tauri, Node and SQLite details stay at their boundaries.
- **Make clean cuts.** One current model and runtime. There is one user: remove superseded code instead of building compatibility facades or versioned paths.
- **Protect the user's work.** Explicit conflicts, safe retries, atomic changes and readable activity. Backup and restore are part of the feature.
- **Keep data open and local.** Task state lives in inspectable JSON files. The SQLite cache also holds receipts, history and undo authority, so rebuild it by re-reading the files, never by deleting it. No surprise network access and no direct agent database edits.
- **Calm and elegant everywhere.** The task list stays primary. Metadata sits on a quiet line; paths, versions and help appear on demand. Safety warnings stay clear at the point of use. This holds for every client from its first build, not as later polish.
- **Smallest real slice.** Add abstractions, caches or performance machinery when real use and measurement justify them.
- **Test what can break.** Data integrity, tricky rules, process boundaries and known bugs. Representative workflows over permutations; no tests just to give a spec rule a citation.
- **Validate the real product.** A browser check is not a native check. Say what stayed untested.
