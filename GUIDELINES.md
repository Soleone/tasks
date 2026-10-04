# Guidelines

Defaults, not rigid rules. Keep milestone-specific detail in [PLAN.md](PLAN.md).

- **Build for daily use.** Favor quick capture, clear next actions, and keyboard-friendly flows over a growing feature list. External agents come before a built-in assistant.
- **Share one command path.** UI and CLI use the same TypeScript rules and contracts. Keep Tauri, Node, and SQLite details at their boundaries.
- **Make clean cuts.** Aim for one current model and runtime, not permanent versioned application paths. There is one existing user: isolate one-time legacy conversion, preserve backups, and remove superseded code rather than build compatibility facades.
- **Protect the user's work.** Prefer explicit conflicts, safe retries, atomic changes, and readable activity. Backup and tested restore are part of the feature.
- **Keep data open and local.** Canonical task state lives in inspectable JSON files; SQLite is a rebuildable local cache. Markdown remains content. Maintain useful exports and avoid surprise network access or direct agent database edits.
- **Use a coherent UI foundation.** Stick with shadcn's Base UI foundation and semantic tokens. Application code consumes the higher-level wrappers in `src/components/ui`; direct Base UI imports belong only inside those wrappers. Clear focus, readable density, and useful error states matter more than decoration.
- **Keep density calm.** Put useful classification metadata in a quiet footer or data line, keep the main surface focused, and avoid adding noise just to avoid a scroll.
- **Build the smallest real slice.** Prefer straightforward modules and concrete queries. Add abstractions, caches, or performance machinery when real use and measurement justify them.
- **Validate the whole product.** Test persistence and process boundaries, including the bundled runtime and actual Windows/Linux webviews. Report what remains untested and update the plan when decisions change.
