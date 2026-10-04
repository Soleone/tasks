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
| `node scripts/check-windows-update.mjs` | After bundling on Windows, build/run disposable Windows Node/SEA content-update and recovery scenes on local NTFS. Not a native UI or release pass. |
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

**Historical read-only checkpoint. Owner chose Windows-first; the later bounded `fcf` evidence is recorded below for review.** Rebooting into Omarchy is currently impractical. This is a read-only feasibility record after `fwk`, not a native launch or writer acceptance. Checkout `c7f3f1f`, branch `main`, was clean during inspection. No native builds/launches, installations, SSH permission changes or personal task selection were performed.

### Hosts actually checked

| Host | Observed prerequisites | Decision / blocker |
| --- | --- | --- |
| Current WSL2 Ubuntu (`chuck`) | Linux 6.6.114.1, Node 22.22.3, pnpm 11.22.0, Rust/Cargo 1.96.0; WSLg display sockets exist | `pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0` reports all four missing. WSLg presence is not a native desktop pass under the plan; no dependency installation or UI launch attempted. |
| Local Windows host through PowerShell | Windows 11 Home 10.0.26200, WebView2 154.0.4258.53, Node 24.19.0, pnpm 11.22.0, Rust 1.98.1/MSVC target and VS 2022 C++ Build Tools | Plausible native shell/build host, but `v2Gateway.ts` withholds every write command outside Linux. A Windows-first pilot needs a separately approved bounded writer proof, not `82r` or implicit Windows/WSL filesystem mixing. No checkout exists at the wrapper's documented default `/mnt/d/src/wsl/tasks`. |
| Configured SSH alias `validator` | Connection attempted with `BatchMode=yes`, `ConnectTimeout=10`; no remote command executed | SSH exited 255: local `~/.ssh/validator` is mode `0644`, so OpenSSH ignores it and authentication fails with `Permission denied (publickey,password)`. No remote OS, desktop session, toolchain or checkout could be verified; this alias is not assumed to be Omarchy. Do not repair credentials or change permissions as part of this read-only task. |

The project describes an Omarchy setup, but the owner cannot conveniently reboot into it. Host decision `snr` is resolved: use the checked Windows 11 host. The new bounded prerequisite `fcf` starts with actual Windows filesystem/API feasibility and proves one existing-task `task.update`, no-op, restart, interrupted publication, divergence refusal and original-request retry/recovery using disposable NTFS data and actual Windows Node/SEA processes. Root/cache and dedicated `APPDATA` must be explicit; local evidence lives under `<APPDATA>/com.soleone.tasks/taskdb-v2/roots/`. Stop on missing durability/tooling guarantees rather than removing platform gates. This does not approve the broad `82r` port or enable other unproven Windows commands. `dh1` remains pending until the reviewed proof completes its decision; `mg8`/`m1p` remain gated.

### One backend route, not two matching permissions

The installed/locked `tauri-plugin-shell` **2.3.6**, `src/scope.rs:257`, uses `self.scopes.iter().find(|s| s.name == command_name)`. Its argument processing reconstructs fixed arguments from that first entry; it does not search later entries by supplied arguments. Today's `src-tauri/capabilities/default.json` allows only `binaries/tasks-backend` with fixed `--stdio`. Supplying v2 arguments under a second same-name entry can therefore start the first entry's **v1** path rather than refuse it.

**Proposed single-entry pilot route, not implemented or Windows-write-approved:** keep the existing SEA sidecar name and shared JSON-lines gateway, but activate exactly **one** native pilot capability set with exactly **one** `binaries/tasks-backend` spawn entry. Its allowed argument shape is:

```text
--stdio --v2-root <explicit absolute disposable root> --database <explicit absolute outside-root cache>
--windows-update-proof --local-profile <explicit absolute outside-root APPDATA profile>
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

This checkpoint was superseded by the content proof and [selected native-route decision](#selected-windows-native-route-dh1-2026-10-04) below. The backend content route is runnable; the native permission/client route remains unimplemented. Neither the original proposal nor its later selection constitutes native app acceptance.

## Windows content-update proof (`fcf`, 2026-10-04)

**Bounded backend process proof, not native app acceptance.** The shared update writer now runs under an explicitly selected Windows-only proof profile. No parallel engine, canonical/schema change, native capability, UI integration or personal-data operation was added. Unflagged Windows v2 writes remain unavailable; the default v1 app/sidecar launch is unchanged.

### Host, boundary and artifacts

- Windows 11 Home **10.0.26200**, x64; actual `C:\Program Files\nodejs\node.exe` **24.19.0**, libuv **1.52.1**. PowerShell `Get-Volume` reports C: as a fixed **NTFS** volume. The initial agent proof used C:; the owner later reproduced all scenes on D:, recorded below.
- Windows source snapshot: `C:\Users\soleone\AppData\Local\Temp\Tasks-fcf-checkout-addd29aeed9544cc8b94f6a0f3bf4ae2`. Base `0c4e26e` plus the current bounded source/bundle changes. All execution was Windows-native, not Linux Node accessing mounted Windows task/cache files.
- Every scene copies the golden synthetic root into checkout-local `.tmp/windows-update-*/<scene>/root`, with separate `<scene>/cache.db` and `<scene>/profile`. The CLI makes that explicit profile its APPDATA; local lock/intent state is under `profile/com.soleone.tasks/taskdb-v2/roots/<physical-root-hash>`. Default v1 root/cache/profile traps remain absent.
- The proof packages the actual Windows Node executable with the current CJS bundle using the existing SEA/postject mechanism, then launches both that SEA and Windows Node. The normal SEA was **93,461,504 bytes**, SHA-256 `93defe226d2f269be1fc60cb7e98410a25d7cb0a46cef4b316934a7959401f2f`. [Structured evidence](windows-update-proof.json) retains runtime, all seven binary hashes and scene groups. Binaries and synthetic scene data are explicitly removed after the checker, not installed artifacts.
- Postject printed seven `The signature seems corrupted!` warnings when altering signed Node PE copies. All resulting executables launched and passed; this does **not** establish Authenticode signing, installer or release acceptance.

Initial inspection did find a real blocker: opening a directory with `r` allowed the handle but Node fsync returned `EPERM`; native read-only `FlushFileBuffers` returned Win32 error 5. Native writable/read-write directory handles and Windows Node `r+` flush succeeded without elevation. `syncV2Directory` now uses `r+` only on Windows, still throws every open/flush failure and keeps Linux behavior. File exclusive creation/flush and replacement of an existing target were observed independently. `scripts/probe-windows-directory-flush.ps1` and `scripts/probe-windows-update-files.mjs` reproduce those API probes.

The longer real proof then exposed recursive mkdir returning a `\\?\`-prefixed first-created path while the selected domain used ordinary drive spelling. The retained-parent comparison now uses the same namespaced spelling on both sides, preventing an erroneous walk beyond the owned profile parent. Focused filesystem tests exercise initial and repeated lock-domain entry. No flush is dropped, replaced with a delay or approximated by browser/Linux behavior. Review also caught an inherited recovery gap: observing already-replaced bytes could skip the task-directory flush before receipt commit. Recovery now flushes that directory even when it does not rewrite the target. A test-only flush refusal after the rename cut must preserve pending/target bytes and leave zero receipts/history; successful retry flushes before committing/retiring. API success and process recovery are not hardware/power-loss evidence.

### Exactly the supported subset

From a Windows checkout, the explicit backend argv is:

```text
--stdio --v2-root ABSOLUTE_NTFS_ROOT --database ABSOLUTE_OUTSIDE_ROOT_CACHE
--windows-update-proof --local-profile ABSOLUTE_OUTSIDE_ROOT_APPDATA_PROFILE
```

Missing/orphan profile flags and non-Windows activation fail before cache creation. Root/cache/profile must be explicit local drive-letter absolute paths; the profile is physically checked outside the root before dispatch, and cache/sidecars retain the existing physical checks. This is declared local NTFS tooling, not a filesystem sandbox or portable/network-storage claim.

Info advertises exactly `workspace.info`, `task.get`, `task.list`, `category.list`, `tag.list`, `activity.list`, `task.update`, `workspace.recovery.resume`. Recovery only accepts `taskdb.pending-update` whose original command is `task.update`, including retirement after historical recovery receipts. A valid pending status intent is refused intact. Capture, every status/undo/relationship/order/batch operation, init/rebuild, doctor, purge, archive/restore and migration remain unsupported in this profile. The human-friendly CLI and browser editor are not Windows-enabled by this flag.

### Actual exercised flow

`node scripts/check-windows-update.mjs` passes **38 scene groups**, 19 each through Windows Node and the Windows SEA, using a minimal child environment and retained root/cache/profile across newly started processes:

1. Query/context preparation, preview, receipt-only no-op, literal title/Markdown edit, untouched-field/file preservation, restart and exact original-request historical replay. A real edit produces one operation/activity and one original-key receipt; a no-op adds only its own receipt. Stale versions and changed payload under the original key refuse without another effect.
2. Actual process termination after durable pending staging, after canonical replacement, immediately before SQLite COMMIT, immediately after COMMIT before retirement, and after retirement before reply. Info exposes pending work, ordinary reads refuse, and explicit recovery plus unchanged original-envelope replay yields one effect/history. The complete original context/key/version/actor/payload/flags and fixed edit time are checked. Explicit recovery has its own acknowledgment receipt, not a second edit.
3. Divergent/formatting-only target bytes, missing planned target, newly arrived task membership and a different cache stop recovery with `RECOVERY_CONFLICT`, preserving pending bytes and canonical files. A non-update status intent returns `UNSUPPORTED_COMMAND` without retirement. Missing target replay against an already completed historical receipt never recreates a file.
4. Cache loss at the original location rotates context; old original requests remain stale before and after explicit fresh-authority recovery. The fixed recorded outcome/time is recognized rather than inventing another edit.
5. Authorized root and cache-parent junction aliases resolve to the same physical authority. A record/filename case mismatch and a tasks-directory junction refuse instead of silently importing/overwriting. A separate Windows process holding the root SQLite writer lock blocks the update without a pending/task effect; termination releases it and the original new edit can execute.

Fault cuts are inserted into disposable test-only copies of the built bundle, with unique-source assertions, then packaged into Windows SEAs. No production fault flag or generic shell command endpoint exists. The checker deliberately disposes only its known synthetic scenes after preserving/verifying failure evidence.

### Reproduce and review gate

Use the normal prerequisites and `pnpm install` in a **local Windows NTFS checkout**, then run in PowerShell:

```powershell
pnpm build:backend:bundle
node scripts/check-windows-update.mjs
```

The checker selects its own golden disposable root/cache/dedicated profile, verifies fixed NTFS, builds the native test binaries and removes its scratch data. Do not substitute `bin/tasks`, personal paths, WSL Node or an existing retained production cache.

Validation: backend/web types and lint pass; `pnpm test` has **1,602 passed, two known skips, zero failures**. Six focused CLI/filesystem tests also pass in actual Windows Node. The two historical Linux skips remain the normative withheld-doctor fixture and opt-in isolated Syncthing transport run, not Windows test substitutions. Clean-code review kept production changes at the CLI capability and filesystem/recovery boundaries.

**Scope remains backend-only.** No Tauri app was launched, no native UI/focus/lifecycle or capture/status/undo/backup/restore path is proven, and no installer/signing, power-loss, hostile reparse/hardlink race, network filesystem, Android/provider, distributed CAS or release claim is made. The owner reproduced the proof and authorized `dh1`; its route decision and remaining gates follow.

## Selected Windows native route (`dh1`, 2026-10-04)

**Decision complete; native launch not implemented.** After the owner reproduced `fcf` and requested continuation, review selected the existing Windows SEA with **one inline Windows-only capability in an explicitly supplied pilot config overlay**. No new file is added under `src-tauri/capabilities/`, no duplicate same-name spawn scope, second engine/binary, arbitrary shell or v1/HTTP fallback. This task changed documentation and SQ gates only, not native code, permissions, frontend or backend.

### Reviewed host and owner reproduction

- Owner ran `node scripts/check-windows-update.mjs` in `D:\src\wsl\tasks`: **38/38** scene groups, Windows 11 10.0.26200 x64, Node 24.19.0/libuv 1.52.1, fixed local **NTFS** volume. Reported normal SEA: 93,461,504 bytes, SHA-256 `74355eef3fefe9304845501b44dfb694d1d58d1334c1f350ce774c9dc6b41981`. Seven packaging signature warnings remain, not signing/release acceptance. This owner output is distinct from the initial C: artifact report; do not substitute one hash for the other.
- Read-only host recheck confirmed WebView2 **154.0.4258.53**, pnpm **11.22.0**, Rust **1.98.1**, target **x86_64-pc-windows-msvc**, C++ Build Tools **17.14.37614.0** and Windows SDKs **10.0.19041.0 / 10.0.22621.0 / 10.0.26100.0**. This is a feasible build/webview host, not a new Tauri build or desktop launch.
- D: is a source copy without `.git`; the attempted revision lookup returned `not a git repository`. Provenance was then checked by native `Get-FileHash`: `cli.ts`, `v2LocalDomain.ts`, `v2UpdateJournal.ts`, the Windows checker, default capability and Cargo lock match the WSL source at **4957d82** byte-for-byte. No credentials, toolchain, personal tasks or Windows files were changed during the recheck.

### Selected capability contract for the later implementation

The later pilot config must set **nonempty** `app.security.capabilities` to exactly its one **inlined** local/main-window Windows capability. Inline placement outside `capabilities/` avoids a standalone permission file being discovered by unflagged default startup. Do not include the `default`/mobile capability or append additional capability files through launcher arguments. Keep the unchanged v1 capability inactive in this pilot; leave it recoverable only until the clean cutover.

The inline capability permits `core:default`, `shell:allow-spawn`, `shell:allow-stdin-write`, `shell:allow-kill`, and exactly one spawn scope named `binaries/tasks-backend` with `sidecar:true`. No `shell:allow-execute`/open, unrestricted args, system Node, other executable or unnecessary global-shortcut grant. Additional permissions require concrete native acceptance demand, not copying the v1 set wholesale.

The single spawn list has **eight positions**, with five fixed flags and three validated path values:

```text
0 --stdio
1 --v2-root              2 ROOT
3 --database             4 CACHE
5 --windows-task-proof
6 --local-profile        7 APPDATA_PROFILE
```

Path validators must be anchored, nonempty local drive-letter absolute strings with no NUL/CR/LF or UNC/drive-relative substitution. Physical root/cache/profile resolution and outside-root checks remain backend responsibilities. Display and confirm all three paths **before spawning or querying**; use synthetic fixtures and dedicated local NTFS cache/profile, never the wrapper/default personal roots. Freeze the selection through pending/uncertain work; app and external JSON-lines CLI must use that same profile. Do not call the unflagged friendly CLI to perform Windows proof writes.

Installed shell **2.3.6** still selects the **first same-name scope**, replaces supplied fixed-slot strings, validates only variable slots and ignores extra supplied args. Therefore the selected scope must be the only one, the client must construct/validate the exact eight-position call, and acceptance must inspect the **actual reconstructed argv**. Do not claim the plugin itself rejects every wrong fixed flag or extra argument; missing/invalid variable slots must refuse and no supplied shape may reconstruct a bare-v1 route. `tauri-utils` **2.9.3** explicitly selects only the single inline capability for a nonempty capability list. These conclusions were rechecked against the pinned Rust sources, not inferred from a browser build.

### Current subset, later gates and removal

- **Supported now (after `gxm`):** five queries, activity, creation, existing-task content update, all six single-task statuses, eligible latest single-status undo, absent-destination archive/restore and matching explicit recovery, exactly 18 commands under `--windows-task-proof`. No old flag alias. [Copy evidence](windows-copy-proof.md) records 182 Windows Node/SEA groups plus retained status 156/creation 64/update 38. Existing empty destinations refuse before staging. This is backend process evidence only; grouped/arbitrary inverses, other task/workspace controls and native launch remain unavailable.
- **Next selected work:** the historical `dh1` decision started none of these proofs. `mg8`, `7hr`, `byy` and `gxm` subsequently completed under the authorized validated/self-reviewed task loop. Bounded native `m1p` is next. Routine task-end owner pauses are overridden, not genuine native/human/safety gates. Broad `82r`, migration, doctor, purge, relationship/order/batch controls and Android remain held.
- **Native client/lifecycle gate:** implement the one concrete `JsonLineSession` transport, selection/capability checks and useful existing UI in `m1p` only after the writer gates. Current `V2App`/reader/editor still refuse native launch/editing and the browser editor expects a different command set. No HTTP health token or full Linux editor allowlist substitutes for the actual selected eight-command handshake.
- **Retry:** keep correlation/120-second timeout/child cleanup, but never mistake restarting the child for replay. Retain the original context/key/version/actor/payload/flags after uncertain execution, explicitly recover through the same paths/profile, then replay the original request. Capture/status/undo/copy families need their own reviewed ownership guards. Memory-only request loss on window reload/close remains an acceptance issue, not fixed by this decision.
- **Removal:** `dvs` removes the temporary overlay/launcher, proof flag and versioned routing rather than leaving another app. Preserve selected root/cache/profile and pending journals/history across that change; do not solve naming or disk growth by deleting authority. The installed product must have one default backend path and no system-Node dependency.

`pnpm dev:tauri` still starts v1, **not** this replacement pilot. There is no new native command to run yet. The native acceptance steps above remain mandatory when `m1p` implements the route. Types/lint/full regression are recorded for this documentation checkpoint; no new native process or UI acceptance is implied. Stop for review before `mg8` or any capability proof.

## Typed update request (`mg8`, 2026-10-04)

The [one-request trace](update-request-trace.md) follows actual client preparation, raw/decoded request identity, content effect, durable intent/replacement, typed receipt, commit-before-retirement and unchanged retry/recovery. The existing single-file writer now receives only its concrete content/status/relationship request families and uses an explicit effect switch. Task projection/result decoding is shared at client and retained-receipt boundaries; malformed synthetic receipt results preserve evidence and return `INVALID_STORAGE`. There is no generic writer framework, canonical/schema change or added command.

Types/lint and full regression pass: **1,621 passed, two known skips**. The current bundle repeated all **38 Windows Node/SEA** scene groups on the declared fixed NTFS host, including every original interruption and directory-flush-refusal cut; [new report](update-request-proof.json) records bundle/artifact provenance without replacing the original `fcf` evidence. Seven postject signature warnings remain. The first 180-second harness timeout had no surviving checker/backend, and a fresh 600-second bounded run passed; its earlier disposable scratch was retained. No personal tasks, owner D: source, native UI or additional Windows capabilities were touched.

The owner's current autonomous loop replaces routine task-end pauses with validated self-review/commit/next-ready-task. It does not waive human/native/safety gates. Next is `7hr`, not `82r` or `m1p`.

## Windows absent-destination archive/restore proof (`gxm`)

[Evidence and reproduction](windows-copy-proof.md), [artifact/scene report](windows-copy-proof.json): **182 Windows Node/SEA groups**, plus retained status **156**, creation **64** and update **38**, all on the same verified bundle. Full regression: **1,626 passed/two known skips**, types/lint pass. The owner chose absent destinations only after native rename into an empty directory refused. Empty destinations are rejected before staging; existing-destination/migration/copy-target recovery scope remains withheld, including receipt cleanup. Exact source/conflict bytes, source history preservation, fresh destination authority, physical disjointness and staged/published ownership are exercised. Default native permissions/UI and personal data remain untouched. Short-path backend proof is not native lifecycle or release acceptance; `m1p` is next.

## Windows single-task status/undo proof (`byy`, 2026-10-04)

[Evidence and reproduction](windows-status-proof.md), [artifact/scene report](windows-status-proof.json): **156 Windows Node/SEA groups**, plus retained creation **64** and update **38** under the same verified bundle. Full regression: **1,624 passed/two known skips**, types/lint pass. Eligible inverses require retained single-task status sources; grouped/arbitrary history and multi-task effects remain unavailable, including receipt-based recovery cleanup. Recognized already-applied effects reflush before history/claims/receipts/retirement. Default native permissions/UI and personal data remain untouched. The one private profile advertises 16 commands; disjoint archive/restore is still gated by `gxm`, native acceptance by `m1p`.

## Windows capture proof (`7hr`, 2026-10-04)

[Capture evidence and instructions](windows-create-proof.md), [structured report](windows-create-proof.json): actual Windows Node/SEA pass **64 capture groups** plus **38 retained update groups**, full regression **1,622 passed/two known skips**, types/lint pass. The shared creation journal now reflushes an already-linked task directory before history/receipt/progress completion. No-clobber, fixed UUID/time/key, exact stage/target ownership, started absence, progress loss/divergence, late collision, historical replay, explicit recovery's own lost reply and cache-loss authority are exercised. No generic engine, native implementation or other Windows commands were added.

The one private flag is now `--windows-task-proof`, with creation/update-only recovery including receipt-based cleanup; the old flag is not an alias. The prospective eight-position inline capability above uses the new fixed flag. Default permissions still launch v1 and were not modified. Older `fcf`/`mg8` reports preserve their original flag/artifact evidence; current checker commands use the new flag.

The proof is limited to **short dedicated paths**. A diagnostic deep scene gave a 254-character SQLite lock path whose journal exceeded the host's 260-character limit and refused before capture intent/effect; that failed synthetic scratch is retained. `m1p` must validate supported complete path lengths or separately prove longer paths before native selection. This is not permission to mutate or shorten uncertain selected paths. Fifteen create/seven update packaging signature warnings and repeated-postject listener warnings are not signing/release evidence. Native UI/lifecycle, status/undo/control port, power-loss, hostile races and network/provider acceptance remain open. Next bounded work is `byy` under the active validated task/commit loop.

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
