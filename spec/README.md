# Tasks specification

Tasks is a keyboard-first task list. Tasks live as plain JSON files in a folder you choose, one file per task, so they can be synced, backed up and edited by agents without a server. The desktop and web apps show that folder as a calm, filterable list.

This spec says what the app does. It doesn't say how it is built, what is proven on which machine, or why every decision was made. Evidence lives in [docs/evidence/](../docs/evidence/README.md).

## Three layers

| Layer | Covers | Read it when |
| --- | --- | --- |
| [Backend](backend/) | What is true about the data: files, fields, commands, rules, safety | You change what is stored or what a command does |
| [Ecosystem](ecosystem/) | How other tools touch the folder: CLI, agents, sync, backup, migration | You script against Tasks or move data in or out |
| [Client](client/README.md) | What a person sees and presses in the desktop and web app | You change the UI or a shortcut |

Desktop and web are one client. The few differences between them, and between Windows and Linux, are listed once in [client/platforms.md](client/platforms.md) and nowhere else.

## Reading a rule

Behavior is written as rules in tables:

| Rule | When | Then |
| --- | --- | --- |
| `capture.open` | `C` on the list | The New task editor opens above the list with the title focused |

- **Rule** is a stable slug, `area.behavior`. Tests put it in their title (`test("capture.open: ...")`), so `rg capture.open` finds the spec line, the test and usually the code.
- **When** is the situation or input. **Then** is the observable result, in plain present tense.
- **MUST** appears only where a rule could be misread as optional.
- A `> Why:` line follows a rule only when the reason isn't obvious.

Backend commands use a fixed block instead: **Input**, **Effect**, **Refuses when**, **Example**.

## Glossary

| Term | Meaning |
| --- | --- |
| Workspace | The folder holding `workspace.json` and one JSON file per task. This is the only synced state. |
| Task | One file with 14 required fields (id, title, typed text, description, status, priority, category, tags, parent, dependencies, order key and three timestamps) and optional ones such as attachments. |
| Attachment | An image file in the workspace's `attachments/`, listed by name on a task. Written once, never changed. |
| Status | `open`, `in_progress`, `paused`, `done` or `canceled`. **Active** means open or in progress; everything else is **inactive**. |
| Priority | `P0` (highest) to `P4`. New tasks are `P2`. |
| Category | At most one `@category` per task. |
| Tags | Any number of `#tags`. Filters combine them with AND. |
| Due date | At most one `^date` per task: a calendar day, with no time and no start date. |
| Parent | The task a task is nested under. Moving a root task carries its children. |
| Blocker | A dependency that isn't canceled. A done blocker still blocks. A task with no blockers is **unblocked**. |
| Manual order | A persistent order among siblings, shared by the app, CLI and agents. |
| Cache | Local, rebuildable SQLite next to the app, never synced. Losing it costs write authority until the workspace is reconciled, never task data. |
| Operation | One accepted change. Undo reverses an operation, only while nothing newer touched the same tasks. |
