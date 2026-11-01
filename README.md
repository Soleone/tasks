# Tasks

A keyboard-first task list whose tasks are plain JSON files, so you, your scripts and your coding agents can all work on them.

**[Try it in your browser](https://tasks.soleone.xyz)**, no install, or [download the app](https://github.com/Soleone/tasks/releases/latest) for Windows, Linux, macOS or Android.

![Capturing a task with shorthand, starting it and finishing it in Tasks](docs/media/demo.webp)

Every task is one file in a folder you choose, so you can sync it, back it up and edit it with any tool. The app, the command line and your agents all go through the same backend, so they follow the same rules and every change can be undone.

## What it's like

- **Capture without leaving the keyboard.** `C` opens a new task. Type `@work #urgent !fri` in the title and they turn into a category, a tag and a due date as you type.
- **Move work along in one key.** `Space` steps a task from open to in progress to done, `0`–`4` set its priority and `[` `]` its effort. `Shift+C` adds a subtask, `B` a blocker.
- **Ask the list one question.** `!` shows what is due today or late, `D` what you finished in the last day. `F` filters, `S` sorts, `/` searches.
- **Undo anything.** `Ctrl/⌘+Z` takes back your latest change, and the undo history is still there after a restart.
- **Learn it as you go.** `Ctrl/⌘+K` lists every shortcut and the shorthand, `?` opens the Learn panel and `Alt+T` picks a theme. On desktop, a global hotkey can bring Tasks forward or open a new task from anywhere.

Every key has a mouse or touch path too. The full keymap is in [the client spec](spec/client/README.md).

## Get it

- **In your browser:** [tasks.soleone.xyz](https://tasks.soleone.xyz) keeps your tasks in that browser only. Add the example tasks from the corner button to look around.
- **Desktop and Android:** the [latest release](https://github.com/Soleone/tasks/releases/latest) has a Windows installer, a macOS disk image for Apple silicon, a Linux AppImage and an Android APK. The first launch asks you to create a Tasks home or open one you already have. The desktop apps update themselves.

## Your tasks are files

Everything Tasks keeps for one device lives in one folder, its Tasks home:

```text
<home>/settings.json   this device's preferences
<home>/sync/           the tasks: add only this folder to Syncthing
<home>/local/          caches, writer lock, recovery files and undo records; never synced
```

- **Syncing devices.** Each device has its own home. Share only the `sync/` folders between them with Syncthing; settings and undo history stay on each device. Never sync the home itself or its `local/` folder.
- **`local/` is not a throwaway cache.** It holds undo history, receipts and recovery files. Deleting it loses them, though the tasks themselves are safe in `sync/`.
- **Backups.** Close Tasks and the command line and copy the whole home. When you open a copy, the app asks to start a new history there, so a copy never inherits or wipes history silently. The old history is kept aside in `local/retired/`. A home moved as a whole on the same drive keeps its history once you confirm the move.

Coming from a version of Tasks before homes? [Moving a task folder into a home](docs/moving-to-a-home.md) takes three steps.

## Scripts and agents

`tasks-cli` works on the same home as the app, sharing its lock, so both can be open at once. Every call names the home:

```bash
tasks-cli --home ~/Tasks add 'Write the release notes @work #docs !fri'
tasks-cli --home ~/Tasks list --status open --sort due
tasks-cli --home ~/Tasks complete TASK_ID
```

`--help` lists the verbs, and `tasks-cli --home PATH init` creates an empty home. Agents can send JSON lines instead, one request per line:

```bash
printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
  tasks-cli --stdio --home ~/Tasks --client cli
```

Before each write the CLI prints a `tasks-cli retry: {...}` line to stderr. To retry a write whose outcome you didn't see, pass back its context, key and expected version unchanged, and it is never applied twice. For now, build the CLI from a checkout: `pnpm install && pnpm build:backend`, then run `node dist/backend/tasks-cli.js`. See [the CLI spec](spec/ecosystem/cli.md) and [the commands](spec/backend/commands.md).

## Development

A React app, the CLI and the JSON-lines interface share one TypeScript backend. The desktop and Android apps are Tauri shells with a bundled Node runtime, and the web version runs the same backend in a Web Worker.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check && pnpm lint && pnpm test
pnpm dev:web
```

`pnpm dev:web` opens the app on a fresh copy of the sample tasks, so nothing touches your own. `pnpm dev:web:real` works on a copy of your real tasks and never writes back, and `pnpm dev:web --home PATH` opens a home you pick. `pnpm dev:native` runs the desktop app, `pnpm build:tauri` and `pnpm build:android` build the native apps, and `pnpm build:hosted` builds the web version. [The development guide](docs/development.md) covers each of these, plus validation, releases and signing. [PLAN.md](PLAN.md) has what is next and [GUIDELINES.md](GUIDELINES.md) the product principles.

## Documentation

- [Specification](spec/README.md): how the app works, in three layers (backend, ecosystem, client).
- [Development](docs/development.md): setup, validation, native tooling and signing.
- [Plan](PLAN.md), [guidelines](GUIDELINES.md), [agent instructions](AGENTS.md).
- [Evidence](docs/evidence/README.md): dated reports, frozen.

## License

[MIT](LICENSE).
