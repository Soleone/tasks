# Usage and interaction guide

This is the user-facing guide to the established first-party UI. The concise interaction contract lives in the [UI specification](../spec/ui/overview.md), with detailed home-list and capture/edit behavior in adjacent spec files. [Current support](support.md) distinguishes the legacy defaults from the selected replacement client; the established design remains the baseline, but not every workflow is connected there.

Tasks is a keyboard-first, not keyboard-only, app. The saved-task list is the home screen and the primary place to begin work. Every action must also have a mouse-accessible path in the UI, such as a button, menu item, inline control, or compact icon toolbar with an accessible label and tooltip. Mouse controls remain secondary, but they must be complete when a pointer is easier or keyboard access is unavailable.

Keep the interface minimal, sleek, and calm. Prefer small icon toolbars, progressive disclosure, and existing surfaces over large duplicate controls or dashboard clutter. A keyboard shortcut alone is not enough, and a mouse affordance should not require adding a noisy control to every row.

## Home-screen contract

- The first load opens with no dialog and moves focus to the task-list surface.
- When tasks exist, focus is on the `listbox`; the first visible task is the active row. Pressing `Enter` or clicking a task opens its inline editor and focuses the title field.
- An empty workspace focuses the `Saved tasks` list shell. From there, `C` opens capture.
- A filtered empty workspace keeps a focusable task-list shell at roughly one task-row width and height, shows “No tasks match the current filters,” and offers a mouse-accessible Clear filters action. Clear filters is not a Tab destination because Escape resets filters from the list.
- A load error focuses `Retry` until the first successful load can focus the list.
- Loading or refreshing tasks must not steal focus from the current task, an open editor, or another dialog.
- `New task` is a backup action beside the list for mouse discovery and use. It is not the launch focus or a tab stop; `C` or the command palette opens the inline editor from the keyboard.

The list uses a single focus stop. Arrow keys move the active row and do not add a tab stop for every task. The active row is exposed through `aria-activedescendant`; the list is multi-selectable and exposes selected rows through `aria-selected`. Parent options describe whether children are expanded or collapsed through `aria-describedby`, not unsupported `aria-expanded`. Status/category/disclosure glyphs are pointer shortcuts within the option, not nested button widgets or additional Tab stops; the corresponding keyboard actions remain on the list and toolbar.

## Filter toolbar

One compact row above the list, in three groups in this order:

```text
[ Category ] [ Status ] [ Priority ] [ Tags ] [ Unblocked ] [ Search ] [ Created Updated Manual Reverse ] [ Details Move ]
```

Unblocked is an existing extension after the plan's five dimensions. Each button shows its active value through its pressed state, label, and tooltip. A single muted line directly below the toolbar reports the filtered count and active qualifiers, such as “12 active tasks”. It never includes the sort state. Omit filler like “Showing” and truncate rather than wrap. Each active qualifier in this line, including the category pill, is a mouse-only control that clears only that filter dimension back to its default. Every keyboard action below has a mouse path through its menu or dialog. Move controls remain mouse-only; the popover is closed by default and opens below the toolbar without reflowing the page.

`F` moves focus to the whole filter button group and `S` moves focus to the whole sort button group. The focused group has a visible focus ring and owns its keyboard shortcuts until an option is chosen, the same focus key is pressed again, or `Escape` returns focus to the task list. These are explicit focus modes with no timeout. Category, tag, and search dialogs opened from a toolbar mode return focus to the task list when they close.

- Status: Active means open or in progress. Inactive means paused, done, or canceled. The `canceled` spelling stays canonical.
- Priority: Highest through lowest. Every task defaults to P2. Task rows show the priority as a colored dot with an accessible label and tooltip; filters and the editor keep the text labels.
- Category: the `@category` grouping. Single-select. The picker omits categories used only by canceled tasks.
- Tags: `#tags` multi-select with AND semantics. In the picker, `Space` toggles the highlighted tag; `Enter` selects it first when none are selected, then closes; a `Clear tags` row empties the filter. Tags used only by canceled tasks are omitted.
- Relationships: canceled tasks cannot be chosen as new parents or blockers, and a new child cannot be created under a canceled parent. Existing parent and dependency links remain available for removal. A canceled dependency does not count as a blocker for the Unblocked filter.
- Search: titles and descriptions. The query stays applied after the dialog closes.
- Sort: Created or Updated date, Priority, Manual order, and newest or oldest direction for date sorts. Priority defaults to highest first and can be reversed to lowest first. Created/newest is the default. Manual order is a persistent sibling order shared by the UI, CLI, and agents; reverse is unavailable for it. The reverse toggle exposes its direction through its pressed state. The field icons mirror the time footer: clock-3 is created, rotate-ccw-clock is updated, and list-ordered is manual.
- View: Details toggles optional task descriptions and the per-task time footer together. Off by default; a display preference, not a filter, so `Escape` never clears it. Active blocked-by context remains visible either way. Move opens the mouse-only controls for the selected task group in a popover below the toolbar; it is closed by default.
- Hierarchy: Status and other filters do not sever parent links. When a matching child belongs to an excluded ancestor, the ancestor appears as a muted explanatory row, does not count toward the filtered total, and remains expandable.
- Manual ordering: Every sibling scope has a dense persistent order. New tasks and tasks moved under a new parent enter first. Root moves carry their descendants; child moves stay inside the current parent. Canceled and reopened tasks keep their position. Shift selection and reordering stay within one visible sibling scope. Manual ordering is unavailable while a context-only ancestor is active.

## Task details

Descriptions and timestamps are hidden unless Details is on (`V`). One quiet final row in the full task view: the updated date leads when it falls on another day, followed by the created date; otherwise only the created date appears. Each timestamp is labeled Created or Updated. Recent dates read `today`, `yesterday`, or `2 days ago`; older dates use `Sep 8` (this year) or `Dec 10, 2025`. Hovering a date shows the full local timestamp with time. Active blocked-by context stays visible when Details is off.

## Keyboard shortcuts

Task-list shortcuts work anywhere on the home screen, even when focus is not on the task list. Typing in title, description, search, or picker inputs disables them. An inline editor or dialog also pauses task-list shortcuts; the editor's field shortcuts take priority while it is open. Application shortcuts such as `Ctrl/⌘+K` remain available. Filter keys act only while the filter toolbar is focused; sort keys act only while the sort toolbar is focused. A toolbar mode ends when an option is chosen, focus leaves the app, the page is hidden, or `Escape` returns focus to the task list.

| Key | Action |
| --- | --- |
| `C` | Open the New task inline editor |
| `Shift+C` | Open a new child task inline editor for the active task |
| `Enter` | Edit the active task inline |
| `Space` | Move the active task forward: open to in progress, in progress or paused to done, done or canceled back to open |
| `Shift+Space` | Move the active task backward: open to done, in progress to open, paused or done to in progress, canceled to open |
| `P` | Pause an open or in-progress task, hiding it from Active, or resume a paused task to in progress. The palette entry runs the same action by mouse. |
| `Delete` | Immediately cancel the active task |
| `Ctrl/⌘+C` | Copy the selected task's title and description, without `@category` or `#tags` |
| `Ctrl/⌘+Z` | Undo the latest desktop task change; also in the shortcuts palette. A newer change replaces it, and the toast confirms the restore |
| `0` `1` `2` `3` `4` | Set the active task to P0 through P4 |
| `F` | Focus the filter toolbar; the next key picks a filter, or press `F` again to return to the list |
| `F then S` | Switch between active and inactive task views |
| `F then O` / `I` / `D` / `P` / `X` | Show only Open / In progress / Done / Paused / Canceled tasks |
| `F then 0`–`4` | Filter to P0 through P4; pressing the active number clears it |
| `F then U` | Toggle the unblocked-task view |
| `@` | Open the category filter with its search field focused |
| `#` | Open the tag filter with its search field focused |
| `F then C` | Open the category filter |
| `F then T` | Open the tag filter |
| `/` | Open task search; works from the task list or filter toolbar |
| `S` | Focus the sort toolbar; the next key picks a sort, or press `S` again to return to the list |
| `S then C` | Sort by created date |
| `S then U` | Sort by updated date |
| `S then P` | Sort by priority, highest first |
| `S then M` | Sort by manual sibling order |
| `S then R` | Reverse the date or priority sort direction |
| `V` | Toggle task descriptions and the time footer |
| `B` | Add a blocker to the active task |
| `M` | Open the move picker, including Remove parent for nested tasks |
| `Shift+Up` / `Shift+Down` | Extend the selection through visible sibling tasks |
| `Shift+Home` / `Shift+End` | Extend the selection to the beginning or end of the active sibling scope |
| `Ctrl/⌘+click` / `Shift+click` | Toggle a task or select a visible sibling range with the mouse |
| `Ctrl/⌘+Up` / `Ctrl/⌘+Down` | Move the selected task group one visible sibling slot in Manual order |
| `Ctrl/⌘+Home` / `Ctrl/⌘+End` | Move the selected task group to the beginning or end of its visible sibling scope; the first move switches to Manual order |
| `Up` / `Down` | Move through visible tasks, replacing the selection with the active row |
| `Home` / `End` | Jump to the first or last visible task, replacing the selection |
| `Ctrl/⌘` with movement keys | Reorder only in the default Active view, optionally narrowed to one category; search, tags, priority, Unblocked, inactive, exact-status, and context-only rows report what to clear. The Move button provides the same actions by mouse. |
| `Left` / `Right` | Move to a parent or expand/collapse children; `Right` on a task without children filters by its category and keeps that task as the sole selection, while `Left` while category-filtered clears that filter and keeps the active task selected |
| `Tab` / `Shift+Tab` | Do nothing while the task list is focused; list focus stays put |
| `Escape` | Cancel the inline editor (or return from description to title); from a toolbar return to the list; on the list clear a multi-task selection, otherwise reset filters; `F`/`S` also close their focused toolbar |
| `?` (`Shift+/`) | Open the starter help section on the right |
| `Ctrl/⌘+K` | Open the searchable shortcuts and syntax palette |
| `Ctrl/⌘+,` | Open Settings |
| `Alt+T` | Open the theme picker |
| Configured global shortcut (default `Ctrl+Alt+Space`) | Focus the Tasks window from anywhere in the native desktop app; change it in Settings. On Omarchy/Hyprland, copy the generated Lua binding from Settings. |

Creating places the task editor above the list; editing replaces the task's row in place. The editor focuses its title field. In Full help mode, a compact contextual tooltip points to the focused field and opens into the left margin when space allows. `Tab` and `Shift+Tab` move through the title, the single priority section, and the optional description. `Tab` from the title focuses priority, then `Tab` from priority opens and focuses the description when it is closed; `Shift+Tab` reverses that order. The description can also be opened with `Add description`. Focus the priority section itself, not an individual P0-P4 button, then press `0`-`4` or `←`/`→` to choose the task priority. Those number keys set the active task's priority on the list; behind `F` they filter instead. Action buttons are backup mouse controls, not Tab destinations; use `Enter` or `Ctrl/⌘+Enter` to save. `Escape` cancels the editor, or returns from the description to the title first. The priority defaults to P2. Saving or canceling returns focus to the task list.

Settings opens with focus on its tab list. Use `←`/`→` to switch between General, Shortcuts, and Data, then `Tab` to enter the selected panel's first control (the theme selector in General). `Shift+Tab` returns to the tab list; the selected tab and active panel keep the normal focus ring. Panel wrappers and the mouse-only close icon are not Tab stops; `Escape` closes the dialog.

In the explicitly selected replacement workspace, Data → Workspace sync explains that receiving is unavailable, without a receive action or backup/empty-folder confirmation. Data's first Tab stop is the disabled export control; Tab then returns to Data. Default desktop receive confirmation and Android folder selection are unchanged. [Current support and bounded evidence](support.md#scoped-settings-receive-evidence-8v8) describe the limits.

Use `@category` and `#tags` in the task title. The command palette explains the complete current shortcut and syntax surface, so update it when a keyboard action changes.

## For agents and contributors

Treat this document as the UI interaction contract when using browser automation, reviewing changes, or adding commands:

- Start UI checks from the task list. Do not assume the New task button is focused or that the inline editor is already open.
- Wait for the initial focus contract: a populated workspace should have `document.activeElement` on `[role="listbox"]`; an empty workspace should focus `[aria-label="Saved tasks"]`.
- Prefer keyboard events for the primary path, but verify the equivalent mouse path for every action. A shortcut-only feature is incomplete.
- Buttons are backup and discovery affordances. Trigger actions with their normal keyboard commands or field shortcuts; do not make buttons Tab destinations. The New task button is intentionally `tabIndex=-1` and remains available as a mouse fallback, as do the filter buttons and the individual inline-editor priority buttons. The filter and sort button groups are programmatic focus stops for `F` and `S`, not normal Tab destinations. The inline editor's priority section is its single keyboard focus stop.
- Clicking a toolbar button, a task status icon, a task's category badge, or a header Help, Themes, or Settings button never focuses the button itself (the mousedown default is prevented), so the current keyboard surface keeps focus and keyboard navigation keeps working. Clicking the New task button opens the inline editor and focuses its title; clicking a task row opens that task's editor. Clicking a category badge filters the list to that category, the same as choosing it from the picker. Ctrl/Cmd-click toggles a row, and Shift-click selects a visible sibling range. Dialogs opened from header controls return focus to the surface that opened them, never to the button.
- Do not add Tab navigation from the task list. `Tab` and `Shift+Tab` leave focus on the list; use `C` or the command palette to open the inline capture editor. While editing, those keys stay within its fields, and `Escape` cancels or returns from the description.
- Add a compact, discoverable mouse affordance when adding an action. Icon buttons need accessible labels and tooltips; use menus or progressive disclosure instead of duplicating controls across every row. The Move button beside Details opens a popover with Move up, Move down, Move to beginning, and Move to end for the selected task group; it is closed by default and does not add controls to every row. The move picker puts its Remove parent action in a separate group above new-parent results when the task is nested.
- Add a shortcut to `src/components/HelpPalette.tsx` when adding a keyboard-first action. Keep the list as the initiating surface.
- Keep focus ownership explicit. `src/components/TaskList.tsx` owns the home/list focus, toolbar focus modes, and window-level home shortcuts, `src/navigation.ts` owns explicit list entry plus the shared focus-steal prevention for backup controls, and the focus stack owns modal return targets.
- Do not add `autoFocus` to a secondary action to solve initial focus. Initial focus belongs in the list lifecycle, after the first query has rendered the correct empty, error, or populated state.
- While visible, the home list checks a shared workspace revision and reloads only when it changes, so CLI and agent writes appear without a restart. Refreshes must preserve focus and unsaved inline-editor content. A new data result should update the active row without moving the user's focus unless the focused element no longer exists.
- Keep the end-to-end assertions in `scripts/check-ui.mjs` aligned with this guide. Run `pnpm test:ui` when Chromium and `agent-browser` are available; use a scratch database only.

## Experimental v2 browser reader

The default app and the interaction contract above remain v1. The [explicit browser reader](../README.md#opt-in-v2-browser-reader) is a partial, read-only v2 client, not a replacement home screen or a complete v2 UI acceptance claim.

- Launch with explicit `--v2-root` and outside-root `--database`, then confirm both displayed paths. The dev bridge is query-only. Confirmation precedes task queries and cache creation; selection is not persisted.
- Initial ready/empty-results focus belongs on the list; initial unavailable/error states focus Retry. Search and dialog focus are preserved across visible-page polling. Active task identity survives fresh results while present.
- While the list is focused, arrows/J/K and Home/End navigate the matching page; Enter opens literal details. Click a row and use Show details for the mouse path. Escape or Close returns from details to the list.
- Search is applied on Enter/Search, not as a side effect of refresh. Status has a separate dropdown. Results use manual preorder, with excluded ancestors shown as context and pagination bounded to 50 matching tasks. This does not implement v1 collapse, group selection, filter-toolbar or full home-shortcut behavior.
- Canonical title/description and string category/tag slugs are rendered without v1 classification parsing or legacy `descriptionMarkdown`/closure aliases. Details are an explicitly read-only snapshot.
- Pending/invalid evidence suppresses task rows, reports available diagnostics/operation ID and never executes recovery. Known task conflict copies are reported separately; alternate versions are never adopted implicitly.
- A restarted/replaced dev bridge refuses the retained page's selection token. Reload and confirm the displayed selection rather than silently reconnecting to another root or default v1.
- No capture, edit, status, relationship, order, undo, purge, doctor, initialization, migration, rollback or recovery controls are provided. Supported CLI controls remain separate. This browser mode does not launch the separate [Windows native pilot](windows-native-pilot.md); Android v2 UI remains withheld and no v1 sidecar fallback occurs.

`node scripts/check-v2-ui.mjs` exercises disposable browser/process scenes, including actual CLI edits and explicit pending recovery, with a separately preserved v1 UI return. It does not execute an app migration/adoption/rollback flow or establish native/provider acceptance. The later bounded native `m1p` loop is complete and `4t6` restores the established main client; neither enables those controls in this query-only browser mode nor closes owner/cutover gates.

## Linux main client on the new engine

The [explicit `--v2-edit` dev:web mode](../README.md#main-client-on-the-linux-backend) opens the established main client above on the selected Linux backend, through the same `MainWorkspace` route as the Windows native loop below. It replaced the former preview/apply browser workbench; there is no second editor. Default v1 and the read-only reader above remain unchanged.

- Confirm the displayed root/cache/profile before any domain query. The [home-screen contract](#home-screen-contract) then applies unchanged: the list or empty shell receives focus, never New task.
- Capture, inline edit with classification shorthand, priority, Space/Shift+Space/P/Delete statuses and Ctrl+Z undo execute directly through the bridge and persist in canonical files. Filters, search and external CLI writes refresh through the shared workspace revision.
- Shift+C child capture, the M move picker (including Remove parent) and the B blocker picker (add or remove) execute through the bridge with the relationship rules above: done blockers still block, canceled ones do not. Parent cycles, dependency cycles and canceled targets are refused before anything is sent.
- Ctrl/⌘+↑/↓ and Ctrl/⌘+Home/End reorder the selected sibling group through the bridge with the manual-ordering preconditions above; the gateway places it against the complete sibling scope, including hidden tasks, and writes all affected keys or nothing. Stale versions, mixed scopes, out-of-order selections and a target outside the scope are refused before anything is sent.
- Ctrl+Z undoes this client's latest change; pressing it again walks back through about the last 50 of its own status, capture (including child capture), content, priority, relationship and order operations. The list is kept in this browser profile for the same confirmed folder, cache and local profile, so it survives reload and bridge restart; another folder, cache or profile starts empty, and changes made by other clients are never offered. Each step uses the gateway's operation undo, and its own preview checks eligibility first: consumed history, later changes to the affected tasks or order scope, and inverses that would create a cycle are refused before anything is sent, announced, and dropped, so the next Ctrl+Z tries the next older change. Undoing a capture removes the task only while it is unchanged. Redo is not available.
- Batches, purge, backup/restore and global focus are refused visibly with no legacy fallback. The same withheld wrappers serve both routes; relationship, reorder and operation undo remain withheld on Windows, where Ctrl+Z stays limited to single-task status changes.
- An uncertain write opens the contextual retry dialog described for the Windows loop below; **Retry same request** reuses the exact envelope. Reload discards this memory-only state and the selection; a restarted bridge refuses the old selection token.

`scripts/mainClientRouting.test.mjs` covers the HTTP route's legacy-transport refusal, persisted direct, relationship and reorder actions (including manual order after a bridge restart with a fresh cache), blocking rules, pre-send relationship and reorder refusals, withheld refusals without bridge requests and lost-reply retry. Browser walkthrough evidence is recorded separately when Chromium tooling is available; none of this is Linux desktop, Windows or Android acceptance.

## Disposable Windows native loop

**The native route reuses the established main client above, like the Linux `--v2-edit` route.** Its task list, compact filter/sort toolbar, inline capture/editing, classification shorthand, priority shortcuts, theme picker, help/settings and focus behavior are reused. Save and status shortcuts execute directly, without a mandatory preview/apply dialog. Literal canonical title/Markdown and classification are projected into presentation data; inline shorthand is escaped to preserve literal markers and code on round-trip. Unsupported native writers remain withheld, with no legacy fallback. Owner approval and wider native capability acceptance are still open; see [restored-client evidence](restored-main-client.md).

The [Windows native launch recipe](windows-native-pilot.md#quickstart-windows-powershell), `pnpm dev:native`, requires an explicit disposable root, outside-root cache and separate dedicated profile. Project shell-emulator configuration addresses the [historical argument-forwarding limitation](windows-launch-argv.md); do not repair malformed paths or add `--`. Confirm the resolved paths in the native window before any query or sidecar starts. The main client shares one embedded SEA session; filters/search and external CLI refresh use the same selected root. **C / Enter / Space / Shift+Space / P / 0–4 / Ctrl+Z** use the established interactions; only eligible latest single-task status undo is currently enabled. Parent/dependency/order/batch changes and general operation undo remain unavailable on this Windows profile. Pending original requests are protected by a contextual retry dialog, not a replacement task editor.

A stopped child may restart with the same frozen paths, but writes are never automatically retried or recovered. A validated, correlated `INVALID_REQUEST`, `UNSUPPORTED_VERSION` or `UNKNOWN_COMMAND` reply is an ordinary inline error only when no prior attempt was uncertain; writes stay enabled. The selected capture/edit composer rejects empty literal shorthand titles and competing categories before sending. Every other executing error locks the original request; **Retry same request** keeps its original context/key/payload/version/actor/flags. **Copy request and paths** copies the full envelope and selected-path metadata. The expandable textarea contains the complete envelope; its adjacent `<pre>` contains path-summary metadata only. Acknowledged external reconciliation pauses further writes until the workspace is reopened after reconciliation. Preserve both before manual reconciliation. Reload/native close can lose the memory-only request despite best-effort unload protection. Every cold launch requires confirmation again. Backup/restore and pending recovery remain explicit CLI controls. See [runnable instructions, actual proof and friction](windows-native-pilot.md).

The backend and standalone CLI are separate keyboard-free agent surfaces that use the same typed command path and SQLite workspace. `task.list` accepts `sort: "manual"`; `task.reorder` accepts an explicit `tasks` list with expected versions and one `beforeId`, `afterId`, `first`, or `last` placement. UI focus does not replace those interfaces, and UI-only behavior must not introduce duplicate task or storage rules.
