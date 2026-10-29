# Capture and edit

Capture and edit use the same inline editor, laid out like the row it replaces: the status glyph, the title in the row's type and place, then the due date and the category column where the row ends (`home.row-layout`), so the title line doesn't move when editing starts. The field is as wide as its text, with the tags right after it as in the row; a click on the rest of the line puts the caret at its end. When the editor is too narrow for the one-line title field and both, the due date and category drop under the title, still in their columns. The fields have no box; the caret, the key hints and the active row's fill show that it is open. Its stops are the title, an optional description and, when the task has images, the image row. Priority isn't in the editor; it is one key on the list after saving (`priority.set`).

## Opening and closing

| Rule | When | Then |
| --- | --- | --- |
| `capture.open` | `C`, the palette, or the New task button | The editor opens above the list with the title focused |
| `capture.child` | `Shift+C` on a task, or New child in Task actions | The editor opens under the active task and saves the new task as its child. Its parent expands, so the new task shows and becomes active |
| `capture.child-canceled` | `Shift+C` on a canceled task | Refused with a message. Canceled tasks can't take new children |
| `edit.inline` | `Enter`, or clicking a row | The editor replaces that row with the title focused and scrolls fully into view, again once an on-screen keyboard has resized the window |
| `edit.save` | `Enter` in the title, or `Ctrl/⌘+Enter` anywhere | Saves. Focus returns to the list on the saved task. While suggestions are open, `Enter` follows `shorthand.enter`. A soft keyboard's action key in the title is Go, which saves, even when a description follows |
| `edit.saved` | This client saves an edited task from the editor | A band of the theme accent sweeps across the saved row, and as it reaches the end a check draws there, holds and fades. Undo, redo and changes from elsewhere never play it, and reduced motion turns it off |
| `capture.saved` | This client saves a new task from the editor | A bigger moment than an edit: the same sweep, but the row's edge glows and a plus spins in at its end with a burst of sparks, holds and fades |
| `edit.cancel` | `Escape` | Cancels, from the title or the description. While a marker is being typed, it follows `shorthand.escape` |
| `edit.keeps-draft` | The workspace changes while the editor is open | The draft stays as typed |

## Inside the editor

| Rule | When | Then |
| --- | --- | --- |
| `edit.tab-order` | `Tab` / `Shift+Tab` | Title, then description, then the image row when there are images, wrapping around. Landing on a closed description opens it. While suggestions are open, `Tab` follows `shorthand.tab` |
| `edit.priority` | Saving | The editor keeps the task's priority. New tasks start at P2 |
| `edit.description` | Typing in the description | Markdown notes kept with the task, shown in the list with its details (`details.toggle-active`). The field sits where Details shows the description, in the same type, and grows with its text. `Enter` starts a new line, so `Ctrl/⌘+Enter` saves from here |
| `edit.description-button` | Add description | Opens the description for the mouse |
| `edit.description-visible` | Add description opens the description | It takes focus and scrolls into view, again once an on-screen keyboard has resized the window |
| `edit.buttons` | Cancel, Add description and Save | Mouse fallbacks, not Tab stops, quiet at the end of the line under the title, or under everything else when the editor is narrow. Each shows the key that does the same from the focused field, such as `Esc` before Cancel in the title and `Ctrl+Enter` before Save in the description. The dismissal button always says Cancel and sits before Add description. Touch differs (`platform.editor-buttons`) |

## Images

Images are kept beside the text, never inside it. The description stays exactly what was typed.

| Rule | When | Then |
| --- | --- | --- |
| `attach.paste` | `Ctrl/⌘+V` in the title or description with an image and no plain text on the clipboard | The image is saved and its thumbnail joins the image row. Text pastes work as before. The task lists the image when the editor saves |
| `attach.refused` | Pasting an 11th image, a file over 10 MiB, or anything but PNG, JPEG, WebP or GIF | Refused with a message. The draft is unchanged |
| `attach.row` | The task has images | Thumbnails sit in one row under the description, in the order they were added. Images are read only when the editor opens, and each is kept in memory for the session since it never changes |
| `attach.row-ready` | The editor opens on a task with images | The image row works with the keyboard at once. Each thumbnail shows a placeholder until its image loads |
| `attach.row-keys` | The image row has focus | `Left` / `Right` move between thumbnails, `Space` opens the preview, `Ctrl/⌘+C` copies the focused image and `Delete` or `Backspace` removes it from the draft. Each thumbnail's Copy and Remove buttons are the mouse path |
| `attach.preview` | `Space` on the focused thumbnail, or clicking it | The image opens centered, at its own size or shrunk to fit inside the window, never larger. `Left` / `Right` and the arrow buttons step through the task's images, wrapping around at either end. `Escape`, `Space` or clicking outside closes it and focus returns to the image row, on the image last viewed. A missing image has nothing to open |
| `attach.cancel` | Canceling the editor | Images pasted or removed in it are discarded with the rest of the draft |
| `attach.missing` | A listed image's file isn't on this device | Its thumbnail reads Image missing, with a tooltip saying it may not have synced yet or was removed on another device. It can still be removed |

## Shorthand

Typing stays the same as the CLI's shorthand, but the title field keeps only the words. What it lifts out becomes a pill: the due date and the category where the row shows them, and the tags after the title's text, all as quiet text with an ×. With none set, the line under the title hints `@category #tags !date`.

| Rule | When | Then |
| --- | --- | --- |
| `shorthand.lift` | `@word` or `#word` in the title, finished with a space or chosen from suggestions | It leaves the title and flies into its pill. The space before it stays, so typing continues. `\@`, `\#`, text in backticks and joined markers such as `#one@two` stay in the title |
| `shorthand.category` | `@word` | Sets the category pill. A second category replaces the first |
| `shorthand.due` | `!word` naming a date (see `text.due`), finished with a space or chosen from suggestions | Lifts into a due date pill reading like the row's marker (`tomorrow`, `Fri`, `2d late`) or, further out, `Nov 14`, resolved against today, with the full date on hover. A second date replaces the first. A word that names no date stays text |
| `shorthand.tags` | `#word` | Adds a tag pill |
| `shorthand.toggle` | Typing or choosing a category or tag the task already has | Removes that pill |
| `shorthand.match` | Typing `@` or `#` and the start of a category or tag the task already has | The typed letters light up in that pill in the warning color, with the tag's `#`, since finishing the name removes it |
| `shorthand.unlift` | `Backspace` right after a lift | The pill goes back into the title as text, with the caret after it, ready to fix |
| `shorthand.pill-click` | Clicking a pill | Removes it. Pills aren't Tab stops |
| `shorthand.pill-exit` | A pill goes away: clicked, toggled off, replaced or put back in the title | It shrinks and fades where it was while the pills after it close the gap. Reduced motion turns it off |
| `shorthand.suggest` | Typing `@` or `#` | Suggestions list matching names, then pills the task already has (marked remove), then the typed name if it is new. An exact match comes first. The highlighted row shows what `Enter` does |
| `shorthand.suggest-due` | Typing `!` | A month opens under the title and highlights the date the word points at as you type: the date it names, a count of days for a bare number, or the first of today, tomorrow and the weekdays ahead that it starts (`!fr` is Friday). A bare `!` starts on the date already set, so `Enter` removes it, or on today when there is none. Arrow keys move the highlight by a day or a week, and clicking a day picks it. A line under the month shows the date and what `Enter` does, which is remove when it is the date already set. A word that points at no date leaves `Enter` saving as usual |
| `shorthand.due-strip` | Typing `!` when vertical space is limited, such as on a phone with the on-screen keyboard open | The month shrinks to the week holding the highlighted date, without month arrows. Typing and the arrow keys still reach any date, and the strip follows |
| `shorthand.enter` | `Enter` with suggestions open | Chooses the highlighted row, or removes it if it is already a pill. A category or tag row that only repeats what is typed saves instead; a date always lifts first |
| `shorthand.tab` | `Tab` with suggestions open | Completes the highlighted name as text. A second `Tab` chooses it. A date is chosen at once |
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
| `pick.refusals` | Choosing a new canceled target, or a choice that would create a cycle | The backend's non-consuming preview refuses it before an executing mutation is sent. A link already in place can remain a no-op even if its target was canceled; execution revalidates after preview |
| `pick.existing-links` | A task already links to a canceled task | The link can still be removed |
