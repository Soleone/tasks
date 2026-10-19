# Capture and edit

Capture and edit use the same inline editor. It has three stops: title, priority and an optional description.

## Opening and closing

| Rule | When | Then |
| --- | --- | --- |
| `capture.open` | `C`, the palette, or the New task button | The editor opens above the list with the title focused |
| `capture.child` | `Shift+C` on a task, or New child in Task actions | The editor opens under the active task and saves the new task as its child |
| `capture.child-canceled` | `Shift+C` on a canceled task | Refused with a message. Canceled tasks can't take new children |
| `edit.inline` | `Enter`, or clicking a row | The editor replaces that row with the title focused |
| `edit.save` | `Enter` in the title, or `Ctrl/⌘+Enter` anywhere | Saves. Focus returns to the list on the saved task. While suggestions are open, `Enter` follows `shorthand.enter` |
| `edit.cancel` | `Escape` | Cancels. From the description, the first `Escape` returns to the title. While a marker is being typed, it follows `shorthand.escape` |
| `edit.keeps-draft` | The workspace changes while the editor is open | The draft stays as typed |

## Inside the editor

| Rule | When | Then |
| --- | --- | --- |
| `edit.tab-order` | `Tab` / `Shift+Tab` | Title, then priority, then description. `Tab` from priority opens the description if it is closed. While suggestions are open, `Tab` follows `shorthand.tab` |
| `edit.priority` | `0`–`4` or `Left`/`Right` on the priority stop | Sets the priority. New tasks start at P2 |
| `edit.description-button` | Add description | Opens the description for the mouse |
| `edit.buttons` | Save and Cancel buttons | Mouse fallbacks, not Tab stops |
| `edit.help-tooltip` | Full keyboard help is on | A compact tooltip points at the focused field |

## Shorthand

Typing stays the same as the CLI's shorthand, but the title field keeps only the words. Category and tags sit as pills under it.

| Rule | When | Then |
| --- | --- | --- |
| `shorthand.lift` | `@word` or `#word` in the title, finished with a space or chosen from suggestions | It leaves the title and flies into a pill under it. The space before it stays, so typing continues. `\@`, `\#` and text in backticks stay in the title |
| `shorthand.category` | `@word` | Sets the category pill. A second category replaces the first |
| `shorthand.tags` | `#word` | Adds a tag pill |
| `shorthand.toggle` | Typing or choosing a category or tag the task already has | Removes that pill |
| `shorthand.unlift` | `Backspace` right after a lift | The pill goes back into the title as text, with the caret after it, ready to fix |
| `shorthand.pill-click` | Clicking a pill | Removes it. Pills aren't Tab stops |
| `shorthand.suggest` | Typing `@` or `#` | Suggestions list matching names, then pills the task already has (marked remove), then the typed name if it is new. An exact match comes first. The highlighted row shows what `Enter` does |
| `shorthand.enter` | `Enter` with suggestions open | Chooses the highlighted row, or removes it if it is already a pill. A row that only repeats what is typed saves instead |
| `shorthand.tab` | `Tab` with suggestions open | Completes the highlighted name as text. A second `Tab` chooses it |
| `shorthand.escape` | `Escape` while typing a marker | Drops that marker and name. The editor stays open |
| `shorthand.save` | Saving with a marker still in the title | It counts as a pill. Saving never removes a pill |
| `shorthand.literal` | Editing a saved task | The title field shows the title without markers, and the category and tags as pills. Literal `@` and `#` show escaped. The title ends in a space with the caret after it, so `@` or `#` can be typed at once. The description is Markdown and never sets category or tags |
| `shorthand.empty` | A title that is only shorthand | Refused before saving |

## Pickers

| Rule | When | Then |
| --- | --- | --- |
| `pick.parent` | `M`, or Move under in Task actions | The move picker opens. Choosing a task nests the selection under it |
| `pick.remove-parent` | `M` on a child | A Remove parent action sits in its own group above the results |
| `pick.blocker` | `B`, or Blockers in Task actions | The blocker picker adds a blocker, or removes an existing one. Done and canceled tasks aren't offered as new blockers |
| `pick.refusals` | Choosing a canceled task, or a choice that would create a cycle | Refused before anything is sent |
| `pick.existing-links` | A task already links to a canceled task | The link can still be removed |
