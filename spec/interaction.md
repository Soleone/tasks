# First-party interaction contract

This describes the Tasks/TaskDB **reference client**, not a required UI for every command client. The complete current key map, toolbar and focus behavior are in the [usage guide](../docs/usage-guide.md); update both when a verified behavior changes.

## Current v1 home screen

- The saved-task list is the home screen. On first successful load, focus the list surface; if tasks exist, the listbox has the first visible task active. An empty workspace focuses the list shell, not a New task button. A load error focuses Retry. Refresh must not steal focus from an editor or dialog.
- Capture with `C`; `Enter` edits the active row; status, priority, filter and sort actions have documented shortcuts. The list is one focus stop with arrow-key navigation. `Tab` does not traverse every row.
- Every keyboard action also needs a complete mouse path, accessible labels and a visible focus state. Secondary actions use quiet controls, menus and details rather than a row of buttons on each task. Creating focuses the title editor; closing it returns to the list.
- Filters include category, status, priority, tags, unblocked and search. Status `Active` means open/in progress; inactive includes paused/done/canceled. Manual sibling order and hierarchy context obey the restrictions in the usage guide. Category is currently a single-select `@category` from title text. The current v1 backend does **not** have a separate Uncategorized filter.
- CLI or agent changes become visible on home refresh without restarting the UI, while focus and unsaved editor text survive. See `src/components/TaskList.tsx`, `src/navigation.ts` and `scripts/check-ui.mjs` for current implementation evidence.

## 2.0 combined view

The default desktop home remains **one list**, even when tasks come from several configured locations. Do not force users to switch workspaces for ordinary capture and review. Category choices across sources are:

- **All:** no category constraint; an independent status/search filter may still apply.
- **`@category`:** only matching slug, no automatic inclusion of uncategorized tasks.
- **Uncategorized:** tasks with no category, regardless of source. This is a virtual choice, not literal `@uncategorized` task text.

Keep the main list calm: do **not** add a source badge to every task or a source selector in the default toolbar. A task's origin and writable destination are available in its **details**; capture uses a configured default and can be overridden from details. Existing-task edits return to origin. If real use shows a need, add a source filter or dedicated Sources view later, not as an unavoidable second taxonomy. If a selected source cannot perform a requested advanced operation, show a useful error or disabled affordance rather than silently succeeding.

Moving a task to another source is a separate, recoverable transfer added after a writable adapter pilot. Until it exists, details may show origin but must not offer a source change that falsely implies a move. Once available, show any data loss before confirming, retain the original until the destination is verified, and make partial failure visible.

Preserve the first-load, list focus, editor focus, mouse parity, and refresh invariants while aggregating results. Verify both keyboard and mouse paths on real desktop webviews; a browser dev preview alone does not validate Tauri. Android keeps its existing single-workspace flow through the initial desktop/CLI 2.0 release and gains multi-source UX only after separate native design and proof.
