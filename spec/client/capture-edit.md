# Capture and edit

Capture and edit use the same inline editor. Its stops are title, priority, an optional description and, when the task has images, the image row.

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
| `edit.tab-order` | `Tab` / `Shift+Tab` | Title, then priority, then description, then the image row when there are images. `Tab` from priority opens the description if it is closed. While suggestions are open, `Tab` follows `shorthand.tab` |
| `edit.priority` | `0`–`4` or `Left`/`Right` on the priority stop | Sets the priority. New tasks start at P2 |
| `edit.description-button` | Add description | Opens the description for the mouse |
| `edit.description-visible` | Add description opens the description | It takes focus and scrolls into view, again once an on-screen keyboard has resized the window |
| `edit.buttons` | Save and Cancel buttons | Mouse fallbacks, not Tab stops. The dismissal button always says Cancel and sits before Add description |
| `edit.help-tooltip` | Full keyboard help is on | A compact tooltip points at the focused field |

## Images

Images are kept beside the text, never inside it. The description stays exactly what was typed.

| Rule | When | Then |
| --- | --- | --- |
| `attach.paste` | `Ctrl/⌘+V` in the title or description with an image and no plain text on the clipboard | The image is saved and its thumbnail joins the image row. Text pastes work as before. The task lists the image when the editor saves |
| `attach.refused` | Pasting an 11th image, a file over 10 MiB, or anything but PNG, JPEG, WebP or GIF | Refused with a message. The draft is unchanged |
| `attach.row` | The task has images | Thumbnails sit in one row under the description, in the order they were added |
| `attach.row-keys` | The image row has focus | `Left` / `Right` move between thumbnails, `Ctrl/⌘+C` copies the focused image and `Delete` or `Backspace` removes it from the draft. Each thumbnail's Copy and Remove buttons are the mouse path |
| `attach.cancel` | Canceling the editor | Images pasted or removed in it are discarded with the rest of the draft |
| `attach.missing` | A listed image's file isn't on this device | Its thumbnail reads Image missing, with a tooltip saying it may not have synced yet or was removed on another device. It can still be removed |

## Shorthand

Typing stays the same as the CLI's shorthand, but the title field keeps only the words. Category and tags sit as pills under it.

| Rule | When | Then |
| --- | --- | --- |
| `shorthand.lift` | `@word` or `#word` in the title, finished with a space or chosen from suggestions | It leaves the title and flies into a pill under it. The space before it stays, so typing continues. `\@`, `\#`, text in backticks and joined markers such as `#one@two` stay in the title |
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
