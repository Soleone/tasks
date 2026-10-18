# Capture and edit

Capture and edit use the same inline editor. It has three stops: title, priority and an optional description.

## Opening and closing

| Rule | When | Then |
| --- | --- | --- |
| `capture.open` | `C`, the palette, or the New task button | The editor opens above the list with the title focused |
| `capture.child` | `Shift+C` on a task, or New child in Task actions | The editor opens under the active task and saves the new task as its child |
| `capture.child-canceled` | `Shift+C` on a canceled task | Refused with a message. Canceled tasks can't take new children |
| `edit.inline` | `Enter`, or clicking a row | The editor replaces that row with the title focused |
| `edit.save` | `Enter` in the title, or `Ctrl/⌘+Enter` anywhere | Saves. Focus returns to the list on the saved task |
| `edit.cancel` | `Escape` | Cancels. From the description, the first `Escape` returns to the title |
| `edit.keeps-draft` | The workspace changes while the editor is open | The draft stays as typed |

## Inside the editor

| Rule | When | Then |
| --- | --- | --- |
| `edit.tab-order` | `Tab` / `Shift+Tab` | Title, then priority, then description. `Tab` from priority opens the description if it is closed |
| `edit.priority` | `0`–`4` or `Left`/`Right` on the priority stop | Sets the priority. New tasks start at P2 |
| `edit.description-button` | Add description | Opens the description for the mouse |
| `edit.buttons` | Save and Cancel buttons | Mouse fallbacks, not Tab stops |
| `edit.help-tooltip` | Full keyboard help is on | A compact tooltip points at the focused field |

## Shorthand

| Rule | When | Then |
| --- | --- | --- |
| `shorthand.category` | `@word` in the title | Sets the category. Two different categories refuse the save |
| `shorthand.tags` | `#word` in the title | Adds tags |
| `shorthand.literal` | Editing a saved task | The title field shows the text exactly as typed, markers in place. After the category or tags change elsewhere, it shows markers first. The description is Markdown and never sets category or tags |
| `shorthand.empty` | A title that is only shorthand | Refused before saving |

## Pickers

| Rule | When | Then |
| --- | --- | --- |
| `pick.parent` | `M`, or Move under in Task actions | The move picker opens. Choosing a task nests the selection under it |
| `pick.remove-parent` | `M` on a child | A Remove parent action sits in its own group above the results |
| `pick.blocker` | `B`, or Blockers in Task actions | The blocker picker adds a blocker, or removes an existing one. Done and canceled tasks aren't offered as new blockers |
| `pick.refusals` | Choosing a canceled task, or a choice that would create a cycle | Refused before anything is sent |
| `pick.existing-links` | A task already links to a canceled task | The link can still be removed |
