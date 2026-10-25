# Learning

Tasks teaches its moves by watching what you do, not by asking how much help you want. A hint points at a move you haven't used yet and retires once you have. There are no help levels.

## Moves

A move is one shortcut, shorthand key or gesture worth learning, named after the rule it performs (`status.forward`, `shorthand.category`). Keyboard devices and touch devices learn different moves (see `platform.moves`).

| Rule | When | Then |
| --- | --- | --- |
| `learn.practice` | A move is performed: by its keys on a keyboard device, or by any path on a touch device | It is learned for good and saved with this Tasks home's preferences. Its hints stop |
| `learn.chapters` | Showing moves | They are grouped into chapters in this order: Capture, Editor, Work, Find, Shape, Look back. A chapter lists only this device's moves and is left out when it has none |
| `learn.chapter-done` | The last unlearned move of a chapter is learned while hints are on | A toast says the chapter is complete. The last move of all says every move is learned instead |

## Hints

Hints are quiet and come one at a time, at the point of use.

| Rule | When | Then |
| --- | --- | --- |
| `learn.nudge` | The editor opens while hints are on and an editor move is unlearned | One muted line under the title teaches the first unlearned editor move: `@` categories, `#` tags and `^` dates, then on a keyboard `Tab` completion, `Tab` and `0`–`4` for priority, and `Backspace` to put a pill back. The line stays the same while that editor is open |
| `learn.nudge-done` | The nudged move is performed in that editor | Its line shows a check. The next editor teaches the next unlearned move |
| `learn.pointer-tip` | On a keyboard device, the mouse performs a move that is still unlearned while hints are on | A toast names its keys. Each move tips at most once per session |
| `learn.hesitation` | `F` or `S` | The mode's guide opens at once until that mode has been used to choose an option. After that it opens only when no key follows within 600 ms, so a practiced chord never flashes it |
| `learn.hints-off` | Hints are off | No nudges, pointer tips, chapter toasts or progress ring. The Learn panel and the mode guides still work |

## Learn panel

| Rule | When | Then |
| --- | --- | --- |
| `learn.panel` | `?`, or the Help button | The Learn panel opens on the right without taking focus: how many moves are learned, then each chapter with its moves and keys. Learned moves are checked and the next unlearned one is marked. `?`, `Escape` or its close button closes it |
| `learn.progress-ring` | Hints are on and some of this device's moves are unlearned | The Help button's circle fills in the accent color as moves are learned. Once every move is learned it is the plain help icon |
| `learn.all-shortcuts` | All shortcuts at the bottom of the Learn panel | Opens the `Ctrl/⌘+K` palette |

## Settings

| Rule | When | Then |
| --- | --- | --- |
| `learn.hints` | Show hints in Settings > General | On by default and remembered. Turning it off stops every automatic hint (`learn.hints-off`) |
| `learn.reset` | Reset progress in Settings > General | Every learned move is forgotten, so hints and the progress ring start over, and pointer tips may show again this session. The section says how many moves are learned. Nothing else changes |
