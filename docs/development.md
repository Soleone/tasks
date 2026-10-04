# Development and validation

This describes development, packaging, and validation for the current implementation. The [system specification](../spec/overview.md) records implemented behavior only; aspirational work is separated under [ideas](../ideas/overview.md). A limited multi-source controller is available to the Node CLI and JSON-lines sidecar behind an explicit local registry. The first-party UI and Android remain single-workspace.

Tasks has two useful development paths:

- `pnpm dev:web` runs Vite and a local HTTP bridge for fast UI iteration.
- `pnpm dev:tauri` runs the native Tauri shell and its sidecar on Windows and Linux. On Linux, the Tauri entry point applies the WebKitGTK Wayland workaround before initializing the webview.

The web bridge is local iteration tooling. It uses the same typed commands and SQLite storage as the sidecar, but it is not evidence of desktop or PWA support.

## Technical reference

The repository has one shared application path:

```text
React UI
  -> typed Tauri bridge
  -> thin Rust process/lifecycle boundary
  -> bundled Node sidecar (JSON lines over stdin/stdout)
       -> TypeScript commands and domain rules
       -> SQLite adapter and canonical JSON workspace

Standalone CLI -> the same TypeScript commands and storage adapters
```

At the React surface, `App.tsx` owns task-query and refresh lifecycle, persisted view choices, and dialog orchestration. `TaskList.tsx` owns home-list focus and active/selection identity, list shortcuts, and sibling reorder interaction. Keep the focus-preserving refresh bridge at that boundary.

The default path remains protocol 1. The [experimental v2 browser reader](../README.md#opt-in-v2-browser-reader) has a separate `V2App.tsx` confirmation gate, `V2ReaderView.tsx` query/focus lifecycle and `v2BackendClient.ts` strict v2 projections. `scripts/dev-web.mjs --v2-root PATH --database CACHE` selects a read-only dev bridge and sets `VITE_TASKDB_V2=1` for Vite; unflagged launches explicitly use the v1 app. Only the matching dev bridge's per-process selection token is accepted. No selection is persisted or passed through the v1 client/registry.

Adding `--v2-edit` explicitly enables the Linux-only [literal editor](../README.md#opt-in-v2-capture-and-editing). The launcher sets `VITE_TASKDB_V2_EDIT=1` only for that mode and otherwise explicitly sets it to `0`. Health additionally declares the exact ten ordered task commands (create/update, six statuses, latest local status undo and parent move) and retained profile path, without creating a cache/profile. `v2EditorClient.ts` prepares immutable serialized memory-held requests; `V2TaskEditor.tsx` owns preview/apply/unresolved/manual-reconciliation states. Reader polling never overwrites draft or retry authority. The shared HTTP adapter retains separate read-only/editor handshakes and the server whitelists only create/update, the six single-task status commands, `task.status.undo` and `task.move` in editor mode. Status action selection reuses the protected preview/apply/retry dialog; no batches, grouped/operation/deletion undo or generic mutation dispatcher is exposed. Status undo restores exact historical status/closure only from eligible retained local history; malformed/missing selected history maps to `UNDO_UNAVAILABLE`, never a guessed inverse. Both preimages and postimages must contain valid selected task records. Parent mode uses `V2ParentChoice.tsx` for context-bound, query-only 50-result search/pages and explicit root selection; current/chosen identity survives filtering. Only deliberate item presses change the parent: Base UI synthetic/closed-typeahead/autofill value changes are not consent to reparent or remove a parent. Query pages without ancestor expansion normalize only the protocol's absent optional `contextTasks` to an empty local projection; malformed present data still refuses. Parent ID, source version/context and executing request remain fixed, and backend full-graph/complete-scope rules remain authoritative. No dependency or general ordering dispatcher is enabled. Profile selection changes are refused before gateway access. No automatic token refresh/recovery, saved payload/selection or native launch is added.

Vite pre-optimizes the lazy editor's checkbox dependency so opening it cannot trigger a late-optimization page reload. HMR/source edits, frontend restarts, browser crashes and reloads are still not durable retry storage; preserve unresolved requests and do not use HMR during them.

`JsonLineSession` shares process framing/correlation/timeouts; `BackendSession` retains its v1 parser and unchanged `--stdio` launch. The v2 reader's selected Node process factory is exercised by tests, not exposed as a native capability. Native v2 launch is withheld: the current shell plugin chooses the first matching binary permission, so adding another entry with different arguments could silently launch v1. Packaging a distinct native route and validating its lifecycle remain open. Android v2 UI is also withheld. Default Tauri permissions and native code are unchanged.

Keep the boundaries concrete:

- **Domain/contracts** contain task rules, schemas, command/query types, and stable errors. They do not import Tauri, Node, the DOM, or SQLite.
- **Application/storage** owns validation, canonical-file reconciliation, SQLite transactions, migrations, queries, activity, and idempotency. It is the only layer that writes task data.
- **Adapters** handle UI transport, CLI arguments/JSON, and native lifecycle/file integration. They do not duplicate business rules.

Desktop read-only task commands live in `taskQueries.ts`; `taskRecords.ts` owns SQLite row materialization shared by reads and mutations, and `taskArguments.ts` holds shared argument checks. These dependencies flow one way into task command execution. Keep `canonicalWorkspace.ts` together for now: scan/apply candidate logic is also used by rebuild and pending-write recovery, so separating it would first require a shared canonical-record/apply layer. Avoid splitting either module by line count alone.

The canonical JSON files are the inspectable source of current task state; SQLite is a local, rebuildable cache. See [Canonical workspace files](canonical-workspace.md) for the file layout, import/rebuild behavior, archives, and conflict resolution. Sync only that canonical root; never sync the database or its WAL files. See [Syncthing setup](syncthing.md) for multi-device setup.

### Command and reliability rules

- UI and CLI use versioned JSON envelopes with request IDs, actor/client identity, runtime validation, stable error codes, and deterministic bounded queries.
- Every mutation has an idempotency key; edits also require an expected version. Reusing a key with a different payload is an error, and stale versions are rejected rather than silently retried.
- A task change, activity entry, and successful receipt commit together. Dry runs and read-only requests persist nothing.
- SQLite uses foreign keys, short transactions, a bounded busy timeout, and WAL on local storage. Only one writer is expected at a time.
- The desktop keeps one long-lived sidecar. Correlate requests and handle malformed responses, timeouts, exit, shutdown, and restart visibly. Never replay an uncertain write without its original idempotency key.
- The native shell provides a configurable focus-only global shortcut through the Tauri global-shortcut plugin. Windows supports this. Linux support is X11-only with the current backend; native Wayland compositors such as Omarchy/Hyprland do not reliably deliver it, so an Omarchy bind or the desktop portal is still required there.
- The WSL wrapper invokes the Windows sidecar when the Windows app is running; WSL must not open the Windows database directly through its mounted Windows filesystem.

### Data and recovery

The minimum task record has a UUID, title, Markdown description, status, optional priority/category, timestamps, completion state, and a local optimistic version. Activity has a monotonic sequence, actor/request provenance, and before/after changes. Receipts record successful idempotent mutations. Add planning dates, parent/dependency edges, and FTS indexes only as their milestone behavior ships.

Statuses are `open`, `in_progress`, `paused`, `done`, and `canceled`. Inbox, Today, overdue, deferred, and blocked are views, not statuses. Real mutations increment the version; repeated state transitions are no-ops. Parent and dependency cycles are rejected transactionally, and cancellation does not silently remove history or relationships.

Classification is derived from task text: at most one `@category` and any number of `#tags`, with Markdown/code/URL false positives excluded. Derived category/tag records are reconciled in the same transaction as the task change.

Use the SQLite backup API or `VACUUM INTO` for live-database backups; never copy only the main file from a WAL database. Validate snapshots in a new location before switching workspaces. Lossless JSON snapshots preserve canonical records, relationships, history, and receipts; portable task exports are intentionally smaller and readable. Migration and restore must fail without making the previous workspace unusable.

### Safety boundaries

Task text and imported Markdown are untrusted input: sanitize or disable raw HTML, validate external link schemes, and never pass task content to a shell. Tauri exposes only the fixed sidecar and required native capabilities; there is no arbitrary SQL/shell interface or unauthenticated network listener. Local storage relies on OS permissions and is not encryption. Debug logs should not include task content by default.

## Prerequisites

For the backend and web loop, install Node LTS with `node:sqlite` support and enable the repository's pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install
```

The native shell additionally needs the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). The primary native target is Windows 11. A Linux/WSL checkout is suitable for backend, packaging, and bridge checks, but it is not a native desktop acceptance environment.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm check` | Type-check the backend and web app. |
| `pnpm test` | Build the backend and run the file-backed SQLite tests. |
| `pnpm test:sidecar` | Build the target Node SEA sidecar and run it with a minimal environment. |
| `pnpm build:sidecar` | Rebuild the target sidecar and `tasks-cli` binaries without running their probes. |
| `pnpm test:ui` | Exercise the default v1 UI in Chromium against a temporary workspace. |
| `node scripts/check-v2-ui.mjs` | Exercise the explicit read-only v2 browser reader, CLI visibility, pending/recovery and default-v1 isolation on disposable roots. |
| `node scripts/check-v2-editor-ui.mjs` | Exercise explicitly enabled literal capture/editing, single-task status actions/latest local status undo and parent changes, literal paged parent choices/focus, fixed stale/canceled-target/lost-reply retries and explicit CLI pending recovery on disposable roots. |
| `pnpm dev:web` | Run Vite and the dev-only local backend. |
| `pnpm dev:backend` | Run only the dev backend. |
| `pnpm dev:tauri` | Run the native Tauri shell, rebuilding the sidecar only when needed. On Linux, the app applies the WebKitGTK workaround before webview startup. |
| `pnpm build` | Check and build the web app and backend. |
| `pnpm build:tauri` | Build the sidecar, web app, and native release bundles. |

`pnpm test:ui` needs `agent-browser` and Linux Chromium. It covers keyboard and mouse paths, conflicts, persistence, responsive layouts, themes, exports, and accessibility checks. If those tools are unavailable, use `pnpm dev:web` for manual checks and record that native/browser automation was not run.

## Use a scratch workspace

The default web backend uses the application data directory. Point both the database and canonical root at a disposable checkout-local directory when experimenting:

```bash
mkdir -p .tmp/tasks-dev
TASKS_DATABASE_PATH="$PWD/.tmp/tasks-dev/tasks.db" \
TASKS_SYNC_ROOT="$PWD/.tmp/tasks-dev/sync" \
pnpm dev:web
```

In PowerShell:

```powershell
New-Item -ItemType Directory -Force .tmp\tasks-dev | Out-Null
$env:TASKS_DATABASE_PATH = "$PWD\.tmp\tasks-dev\tasks.db"
$env:TASKS_SYNC_ROOT = "$PWD\.tmp\tasks-dev\sync"
pnpm dev:web
```

The dev backend binds to `127.0.0.1`. Its default port is `5174`; set `TASKS_DEV_BACKEND_PORT` to change it. Vite arguments can be passed after `--`, for example `pnpm dev:web -- --port 5199`. `pnpm dev` starts Vite without a backend; set `VITE_DEV_BACKEND_URL` when connecting it to a separately started bridge. The bridge only accepts local-page origins and is never packaged. For v2 use the [disposable reader walkthrough](../README.md#opt-in-v2-browser-reader), with both directory flags before `--`. V2 health reports configuration without querying a root; confirmed queries may create/update its outside-root cache. In read-only mode all raw HTTP mutations are refused even if the Linux gateway advertises them. Explicit `--v2-edit` permits create/update and six single-task statuses only; all other writes remain refused. Do not treat this dev listener, lexical profile path, selection token or browser checks as a filesystem security sandbox, native lifecycle or complete writable-client acceptance.

The theme preview is served at `http://127.0.0.1:5173/themes.html` while `pnpm dev:web` is running. It reads the same built-in and workspace theme files but does not persist a selection.

## Source-registry prototype

The registry is opt-in through `TASKS_SOURCE_REGISTRY_PATH`. It is intended for disposable CLI/JSON-lines experiments until the UI learns to carry `TaskRef` through selection and writes. Do not set it for `pnpm dev:web` yet: the current UI is single-source and will correctly reject ambiguous writes rather than guess a root. With the variable unset, the existing `pnpm dev:web` flow is unchanged.

Example `.tmp/sources.json`:

```json
{
  "format": "tasks.source-registry",
  "formatVersion": 1,
  "defaultSourceKey": "personal",
  "sources": [
    { "key": "personal", "label": "Personal", "databasePath": "personal/tasks.db", "syncRoot": "personal/sync" },
    { "key": "project", "label": "Project", "databasePath": "project/tasks.db", "syncRoot": "project/sync" }
  ]
}
```

Paths are relative to the registry file. Use empty disposable roots inside `.tmp/`, not personal task data. Then:

```bash
TASKS_SOURCE_REGISTRY_PATH="$PWD/.tmp/sources.json" pnpm run tasks-cli -- sources --json
TASKS_SOURCE_REGISTRY_PATH="$PWD/.tmp/sources.json" pnpm run tasks-cli -- list --json
TASKS_SOURCE_REGISTRY_PATH="$PWD/.tmp/sources.json" pnpm run tasks-cli -- update <task-id> --source-key project --title "Updated title" --json
```

Combined list JSON records include a source-scoped `ref`; `--source-key` selects a list source or targets one source for a write. A create without `--source-key` goes to `defaultSourceKey`. The same registry is loaded by the JSON-lines sidecar. Without a registry, legacy v1 commands continue to use their existing database and `TASKS_SYNC_ROOT` resolution.

## Windows 11

Use a Windows filesystem checkout for the native shell rather than launching Tauri from the WSL path. From an elevated PowerShell, install Node LTS, Rustup, and the Visual Studio C++ workload and Windows SDK:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```

Then, in the Windows checkout:

```powershell
corepack enable
corepack prepare pnpm@11.22.0 --activate
rustup default stable-msvc
pnpm install
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri
```

On Omarchy, use `pnpm dev:tauri`. The Linux Tauri entry point applies the WebKitGTK compatibility setting before initializing the webview, so no environment variable is required:

The built-in global shortcut is not considered supported on Omarchy's native Wayland session yet. Open Settings and copy the generated Omarchy binding into `~/.config/hypr/bindings.lua`. It uses `o.bind` with `focus` and `launch`, matching Tauri's lowercase Linux WM_CLASS (`tasks`) rather than the reverse-DNS application identifier, so the shortcut focuses the existing Tasks window and launches it only when no matching window exists. Reload Hyprland after saving the file.

```bash
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri
```

`pnpm build:tauri` creates the MSI and NSIS installer after the development launch works. On Omarchy, the same build creates the Linux release binary and bundles; run the binary directly with `./src-tauri/target/release/tasks`, or launch the AppImage after it is built. The packaged sidecar is generated under `src-tauri/binaries/` and is intentionally ignored by Git. See [the Tauri shell notes](../src-tauri/README.md) when rebuilding native icons.

The checked Windows host has WebView2. Other Windows machines still need the normal WebView2 and Tauri prerequisites.

## Native replacement feasibility checkpoint (`dh1`, 2026-10-04)

**Owner chose Windows-first; blocked on bounded Windows writer proof `fcf`.** Rebooting into Omarchy is currently impractical. This is a read-only feasibility record after `fwk`, not a native launch or writer acceptance. Checkout `c7f3f1f`, branch `main`, was clean during inspection. No native builds/launches, installations, SSH permission changes or personal task selection were performed.

### Hosts actually checked

| Host | Observed prerequisites | Decision / blocker |
| --- | --- | --- |
| Current WSL2 Ubuntu (`chuck`) | Linux 6.6.114.1, Node 22.22.3, pnpm 11.22.0, Rust/Cargo 1.96.0; WSLg display sockets exist | `pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0` reports all four missing. WSLg presence is not a native desktop pass under the plan; no dependency installation or UI launch attempted. |
| Local Windows host through PowerShell | Windows 11 Home 10.0.26200, WebView2 154.0.4258.53, Node 24.19.0, pnpm 11.22.0, Rust 1.98.1/MSVC target and VS 2022 C++ Build Tools | Plausible native shell/build host, but `v2Gateway.ts` withholds every write command outside Linux. A Windows-first pilot needs a separately approved bounded writer proof, not `82r` or implicit Windows/WSL filesystem mixing. No checkout exists at the wrapper's documented default `/mnt/d/src/wsl/tasks`. |
| Configured SSH alias `validator` | Connection attempted with `BatchMode=yes`, `ConnectTimeout=10`; no remote command executed | SSH exited 255: local `~/.ssh/validator` is mode `0644`, so OpenSSH ignores it and authentication fails with `Permission denied (publickey,password)`. No remote OS, desktop session, toolchain or checkout could be verified; this alias is not assumed to be Omarchy. Do not repair credentials or change permissions as part of this read-only task. |

The project describes an Omarchy setup, but the owner cannot conveniently reboot into it. Host decision `snr` is resolved: use the checked Windows 11 host. The new bounded prerequisite `fcf` starts with actual Windows filesystem/API feasibility and proves one existing-task `task.update`, no-op, restart, interrupted publication, divergence refusal and original-request retry/recovery using disposable NTFS data and actual Windows Node/SEA processes. Root/cache and dedicated `APPDATA` must be explicit; local evidence lives under `<APPDATA>/com.soleone.tasks/taskdb-v2/roots/`. Stop on missing durability/tooling guarantees rather than removing platform gates. This does not approve the broad `82r` port or enable other unproven Windows commands. `dh1` stays in progress pending the reviewed proof; `mg8`/`m1p` remain gated.

### One backend route, not two matching permissions

The installed/locked `tauri-plugin-shell` **2.3.6**, `src/scope.rs:257`, uses `self.scopes.iter().find(|s| s.name == command_name)`. Its argument processing reconstructs fixed arguments from that first entry; it does not search later entries by supplied arguments. Today's `src-tauri/capabilities/default.json` allows only `binaries/tasks-backend` with fixed `--stdio`. Supplying v2 arguments under a second same-name entry can therefore start the first entry's **v1** path rather than refuse it.

**Proposed single-entry pilot route, not implemented or Windows-write-approved:** keep the existing SEA sidecar name and shared JSON-lines gateway, but activate exactly **one** native pilot capability set with exactly **one** `binaries/tasks-backend` spawn entry. Its allowed argument shape is:

```text
--stdio --v2-root <explicit absolute disposable root> --database <explicit absolute outside-root cache>
```

Use fixed flag positions and narrowly validated absolute path arguments, never `args: true`, `sh`, a system Node executable, arbitrary executable names or a second same-name entry. Do not permit a bare `--stdio` route in the pilot. The shell scope is not itself a filesystem sandbox: canonical/cache physical-path checks remain in the backend. Deny unexpected command/argument shapes at the concrete client/native boundary as well; the plugin is not an exact-length validator for all supplied argument lists.

Tauri's installed `tauri-utils` 2.9.3 (`src/acl/mod.rs:358`) selects only explicitly named/inlined capabilities when `app.security.capabilities` is nonempty. This supports a pilot config selecting a single capability without also activating the default v1 capability. `pnpm tauri dev --help` confirms `--config` accepts a JSON/path overlay; no overlay was created or run here. Merely adding a capability file without explicit selection would include it by default and is unsafe.

No distinct temporary backend binary is needed for this proposal. A pilot-only config/launcher, if implemented in `m1p`, must be explicitly removed in `dvs`, with its retained root/cache/profile/recovery locations accounted for. Cutover must leave one default entrypoint, not permanently retain two permission/application modes. `pnpm dev:tauri` currently starts v1 and is **not** a runnable replacement-pilot command.

### Selection, runtime and allowed operations

- Host/profile: the checked Windows 11 desktop, Tauri 2/WebView2 and a Windows writer subset only after `fcf` proves it. The current Linux profile is not Windows evidence. A one-command content proof does not authorize all commands needed for the native loop; remaining capture/status/undo/backup/restore publication guarantees must be covered by separately reviewed bounded work before that loop. No native implementation has started.
- Bundle Node into the existing `tasks-backend` SEA via `pnpm build:sidecar` on the **selected host**. Build and inspect that host's artifact, not the stale September 30 binaries found in this WSL checkout. `scripts/build-sidecar.mjs` copies its actual build-time Node executable and injects the bundle; verify its `node:sqlite` support and runtime behavior independently of the host's interactive Node version. Installed users should not need system Node.
- Root/cache/profile: select and display all three absolute paths before querying or enabling writes; refuse missing configuration. Canonical root and cache are explicit CLI arguments. For Windows, set one dedicated `APPDATA` for both app and CLI so retained evidence lives under `<APPDATA>/com.soleone.tasks/taskdb-v2/roots/`; Linux would use `XDG_DATA_HOME` instead. Keep cache/profile outside the canonical root on local NTFS with Windows-native paths/processes, not Linux Node opening `/mnt/c` or `/mnt/d`, network storage or SAF. Do not infer personal/default/v1 roots, use the legacy `bin/tasks` wrapper, create an HTTP fallback or silently change profile/selection.
- Confirmation and transport: `V2App.tsx`, `V2WorkspaceReader` and `V2EditorClient` currently refuse native editing/launch. `m1p` must adapt useful UI through the shared protocol gateway and one concrete native transport/selection path. HTTP selection tokens are development guards, not native authority; do not reuse the dev listener as a shipped native backend.
- Pilot UI allowlist: `workspace.info`, `task.get`, `task.list`, `category.list`, `tag.list`; capture/content through `task.create`/`task.update`; the six `task.start`, `task.pause`, `task.complete`, `task.reopen`, `task.cancel`, `task.delete` transitions and eligible `task.status.undo`. Search is a `task.list` filter. The broader gateway's advertised Linux controls are not permission to expose a generic UI command dispatcher. Parent/dependency/order/batch/doctor/migration/purge controls are outside this basic native proof.
- Separate CLI controls for this proof: `workspace.archive`, `workspace.restore` to a disjoint destination, and explicit `workspace.recovery.resume` through the original root/cache/profile. Use fresh `workspace.info`/`task.get` only for genuinely new edits, never to renew an uncertain original request. Capability advertisement must remain truthful for the selected platform; no legacy fallback if a command is unavailable.
- Filesystem assumptions: the implemented Linux writer relies on complete enumeration, exact-byte validation, regular files, no-clobber creation/atomic replacement and directory/file fsync. `fcf` must establish the concrete Windows guarantees rather than treat those Linux calls as portable or weaken durability silently. Same-root cooperating writers share the retained profile lock/journal. External editors/Syncthing are not covered by that lock and final-read/replace is not distributed CAS. Pause sharing for the disposable recovery scene and keep independently verified backups.

### Process/retry behavior and native acceptance steps

Reuse `JsonLineSession`'s long-lived child, request correlation, 120-second timeout, malformed/unknown-reply refusal and kill/close handling. It starts a new child on a later request but does not replay pending calls. Native-client handling must preserve the exact prepared context/key/payload/version/actor/flags after an executing error; restart cannot mean re-reading authority and issuing a fresh mutation. Selection/profile changes must be explicit and refused while unresolved. Existing memory-only retry loss on reload/window close and preview/apply friction must be reported, not claimed fixed by this feasibility check.

Once the selected Windows profile has reviewed evidence for the required commands and `m1p` implements the route, acceptance is:

1. Build the SEA sidecar/native shell on that host, declare exact versions/artifact and use an explicitly disposable root/cache/profile. Inspect effective capabilities and actual launched argv; negatively check bare-v1, omitted/changed paths and unexpected arguments. Prove no legacy cache/root startup.
2. Confirm paths before backend access. Exercise keyboard and mouse capture, content edit, each supported status action/latest-status undo, search and list/dialog focus. Declare unavailable controls rather than hiding a second runtime.
3. Edit via the CLI with the **same** root/cache/profile and verify native refresh without stealing draft/focus. Quit/relaunch and verify tasks, receipts/history and selection confirmation behavior.
4. Declare an interrupted-write or lost-reply scene in the native app. Preserve the original envelope; inspect pending work, explicitly recover if required and replay the original request. Verify one operation/effect, unchanged retry identity and clear unresolved state. A backend subprocess-only crash test is not this native-client evidence.
5. Archive and restore into a separate root through existing CLI controls, verify exact canonical bytes and open the restored root with fresh authority. Never reuse a copied cache to claim old receipt authority.
6. Record actual platform/UI evidence, definite refusal versus uncertain-write behavior, preview/apply costs and reload/retry loss. WSL/browser tests, tool inventory and a design proposal cannot close native acceptance.

The host choice is resolved, but there is no approved/runnable Windows writer route yet. Leave `dh1` in progress blocked on `fcf`; stop for review before beginning that proof. Do not start `mg8`/`m1p` or broaden platform work to fill the gap.

## Android status

The Android feasibility work now has the desktop/mobile configuration split, a generated Android project, a Tasks-owned native SQLite bridge with fixed storage operations, a TypeScript mobile command slice for runtime probes, task listing, task creation, task editing and single/batch status transitions, classifications, workspace info, built-in themes, and portable task export through Android's document picker, an Android SAF folder picker that persists a selected tree URI, and a canonical JSON import bridge. When a folder is selected, Android rescans `workspace.json`, `tasks/`, and `order/` on startup, foreground refreshes, and workspace polling, then rebuilds its private cache when the canonical content changes. New Android task captures write their canonical task and sibling-order files back through SAF. Edits and status transitions also write updated task files through SAF. Before writing, Android records the intended file contents and original bytes in its private SQLite cache; after an interrupted write it verifies the selected folder and completes missing or partially written files before importing, refusing unrelated file edits instead of overwriting them. Importing a selected workspace into a device with unsynced local tasks is blocked by default rather than deleting those tasks; the receive flow (`workspace.receive.prepare`, `workspace.receive.status`, `workspace.receive.abort`) lets the user safely adopt a different workspace by backing up the private cache first, adopting it when the folder still matches, and restoring the backup on abort. While a receive is pending, every other command is blocked with `RECEIVE_PENDING`. SAF does not provide a multi-file atomic commit, so other devices may see an intermediate state before recovery. Android Settings shares font-size and keyboard-help preferences with desktop, offers document export and folder selection, and identifies global shortcuts and permanent cleanup as unavailable rather than exposing nonfunctional controls. Android now records and can undo the latest edit, status, move, dependency, reorder, or creation operation if affected task versions and sibling scopes still match; undo also rejects relationship cycles introduced by external changes. Undoing a creation deletes the task file through the same staged-write path, writing the corrected sibling order before removing the file so an interrupted undo never leaves a dangling order reference. A non-empty purge is not undoable and invalidates the previous undo, including during interrupted-write recovery; an empty purge leaves undo intact. `workspace.sync`, `workspace.rebuild`, `task.purgeCanceled`, `workspace.archive`, `workspace.backup`, and `workspace.conflict.list`/`resolve` are supported. `task.purgeCanceled` permanently deletes canceled tasks, re-parents their children to the root, and removes their dependencies, writing the deletions and updates through the staged-write path. `workspace.archive` and `workspace.backup` export a portable JSON copy of the canonical files or the private cache through the document picker. The Android home screen reports Syncthing conflict copies found during task refresh. `workspace.conflict.list` scans the selected SAF folder and reports them unresolved; Android does not resolve or delete them, so use a desktop or CLI client. `workspace.sync` reports the unresolved conflict count when a folder is selected. The separate status-undo commands remain open; `workspace.restore` is not applicable because the SAF folder is the source of truth and the receive flow handles adoption.

The host uses Node 26.9.0, pnpm 11.22.0, Rust 1.98.1, Tauri 2.11.5, JDK 21.0.2, Android SDK command-line tools 23.0, platform-tools 37.0.1, platform/build tools 36, and NDK 27.2.12479018. The four Android Rust targets are installed. Activate the mise-managed paths with `eval "$(mise env --shell bash)"`, then use `pnpm tauri android build --debug --apk -t aarch64` for an arm64 debug APK or `-t x86_64` for an emulator APK.

A Google APIs x86_64 `medium_phone` emulator is available on this host; no physical Android device is connected. On 2026-09-24, `pnpm tauri android build --debug --apk -t x86_64`, `:app:testUniversalDebugUnitTest`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib` passed. In a disposable `Tasks-plan-validation` SAF folder selected through the standard picker, task creation wrote canonical task/order files, a pending write staged in the stopped app's private test database recovered on relaunch, and the app exported a readable 3-task JSON file. The recovery state was deliberately seeded in the emulator database; this is standard-provider emulator evidence, not physical-device or third-party-provider acceptance. `scripts/platformParity.test.mjs` also imports a desktop canonical fixture into the Android command engine and compares classification, filters/order, stale-version errors, receipt replay, and create undo. A Pixel 10a run provided initial on-device SAF read evidence for a 68-file workspace; see the [Android SAF performance record](android-saf-performance.md) for the measurement and its limits.

Additional process-lifecycle cases, complete native UI/focus/theme validation, physical-device acceptance, larger workspaces, and third-party SAF providers remain open. The emulator recovery used a seeded pending record to verify restart recovery, not a kill during an active SAF write. Web and Linux desktop checks are not Android acceptance evidence.

#### Signed Android release APK

`pnpm build:android` requires signing, builds an arm64 release APK, and verifies it with `apksigner`. It rejects a missing or incomplete local properties file before starting Tauri; Gradle then validates the keystore file, passwords, and private-key alias before producing the release artifact. Android SDK Build-Tools must be installed, with `ANDROID_HOME` or `ANDROID_SDK_ROOT` set so the command can locate `apksigner`.

Create a release keystore in a private location. For example, `keytool -genkeypair -v -keystore "$HOME/.android/tasks-release.jks" -alias tasks-release -keyalg RSA -keysize 2048 -validity 10000` prompts for the passwords interactively. Do not pass passwords as command-line arguments. Create `src-tauri/gen/android/keystore.properties` locally with the `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` properties. `storeFile` may be absolute or relative to `src-tauri/gen/android/app`. Enter the passwords only in this ignored local file; restrict its filesystem permissions (for example, `chmod 600` on Linux/macOS). The file is already excluded by the Android project's `.gitignore`. Never commit the properties file or keystore, and keep a secure backup of the keystore. Build output and signing validation do not print the property values.

The separate `pnpm build:android:debug` command uses Android's debug signing and does not need release credentials.

## WSL and agent access

The `bin/tasks` wrapper lets an agent in WSL call the Windows sidecar and database instead of opening the Windows database directly from WSL. Set `TASKS_WINDOWS_ROOT`, `TASKS_WINDOWS_SIDECAR`, or `TASKS_WINDOWS_DATABASE` when the default paths do not match the checkout.

The current M0 evidence includes Linux backend and sidecar probes, Windows tests and packaged sidecar checks, a native Windows 11 long-lived desktop probe, the WSL CLI bridge with the app open and closed, sidecar recovery, and Windows MSI/NSIS builds. Omarchy remains a later native target.

Do not treat a browser preview as native desktop validation, and do not treat WSL as an Omarchy/Linux desktop pass. Keep those boundaries explicit in test reports.
