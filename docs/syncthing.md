# Syncthing setup

This guide assumes you already know the basic Syncthing workflow. It covers the Tasks-specific part: safely introducing another device when at least one device already contains task history.

> **Safe default:** share only the canonical `sync/` directory. On a new device, use **Settings → Sync with another device…** before adding the folder to Syncthing. The app backs up and empties the local workspace, locks the UI, and waits for the existing workspace to arrive. Add the now-empty folder to Syncthing as **Send & Receive**. Do not use the app until the transfer is complete and verified.

Syncthing is a file transport, not a backup. A deletion or bad edit can be propagated to every send-and-receive device. Keep an independent Tasks archive or backup as well.

## What to share

Tasks keeps the authoritative current state in ordinary JSON files and uses SQLite as a local cache:

```text
<application data>/
  sync/                         # share only this directory
    workspace.json
    tasks/<task-id>.json
    order/root.json
    order/<parent-task-id>.json
  tasks.db                      # do not share
  tasks.db-wal                  # do not share
  tasks.db-shm                  # do not share
  .tasks-local/                 # do not share
```

The default `sync/` directory is beside `tasks.db` in the application data directory:

- Windows: `%APPDATA%\com.soleone.tasks\sync`
- Linux: `~/.local/share/com.soleone.tasks/sync`

If `TASKS_SYNC_ROOT` is set, use that directory instead. Configure the override separately on each device. Use a dedicated Syncthing folder for the root, not the entire application-data directory. Keep `themes/`, `exports/`, archives, and other local application files outside this share unless you have a separate reason to manage them.

**Android status:** the current Android build can select and persist a SAF folder permission, import `workspace.json`, `tasks/`, and `order/` into its private cache, and write new Android task captures, task edits, status changes, dependency and parent changes, reorders, and undo of the latest operation (including undoing a creation, which deletes the task file) back to the canonical root. Every multi-file write is staged in the private cache and verified, so an interrupted write is completed on the next recovery instead of silently overwriting the folder. Android also supports the receive flow to safely adopt a different workspace (backing up the private cache first, adopting when the folder still matches, restoring on abort) plus `workspace.sync`, `workspace.rebuild`, `task.purgeCanceled`, `workspace.archive`, and `workspace.backup`. `task.purgeCanceled` writes the canceled-task deletions and dependent updates back through the staged-write path. Portable restore and on-device acceptance are still being completed. Do not point Syncthing at Android app-private storage or expect unsupported Android commands to update the share. The selected folder should be a user-visible directory such as `Documents/Tasks/sync`. Only the canonical JSON root will be shared.

Do not add ignore rules that exclude `workspace.json`, `tasks/`, or `order/`. Syncthing's own marker, temporary, version, and conflict files may appear in the shared directory; leave those under Syncthing's control.

## First seed from a history device

Call the device containing the trusted task history the **history device** and the other device the **new device**.

### 1. Prepare the new device

On the new device, open **Settings → Sync with another device…** and confirm the warning. Tasks creates a dated backup, empties its local `sync/` directory, and locks the task UI. It does not delete the backup. Follow the setup link shown by the app, then add the empty `sync/` path to Syncthing. This ordering matters: Syncthing must first see the folder after it has been emptied, so it has no local task deletions to propagate.

If you abort, pause Syncthing before choosing **Abort and restore backup**. The app restores the previous canonical files and unlocks the workspace.

### 2. Make a recovery point

Before changing Syncthing settings:

1. Close Tasks and stop other clients that can write the workspace.
2. Pause the Syncthing folder while preparing the copy.
3. Run `workspace.sync` on the history device and make sure the unresolved conflict count is zero. Resolve existing conflicts before seeding another device.
4. Create an independent recovery point. `workspace.archive` copies the canonical JSON root; `workspace.backup` creates a consistent SQLite backup; `workspace.export` is a lossless JSON snapshot. Use the command surface through the CLI or an agent client. Do not copy a live `tasks.db` file by hand.
5. Confirm that the history device has `sync/workspace.json`, the `tasks/` directory, and the `order/` directory. Keep `workspace.json`; it is the stable workspace identity shared by all devices.

If the history device already has a Syncthing folder with unrelated files, create a dedicated folder for Tasks instead of sharing its parent.

### 3. Put the history device in seed mode

In Syncthing, add the Tasks `sync/` path as its own folder and share it with the new device. During the initial seed, set the folder type on the history device to **Send Only**.

Send Only means remote changes are received as out-of-sync information but are not applied locally. Do not press **Override Changes** casually. That action makes the current history-device state authoritative and can overwrite remote changes or delete files that are absent on the history device.

Enable Syncthing file versioning on at least one receiving device. Staggered or Simple File Versioning is preferable to no versioning for this workspace. Choose a retention period that fits the value of the task history. Versioning is a last-resort safety net, not a replacement for an independent archive.

### 4. Verify the incoming workspace

The app remains locked while the transfer is in progress. Add the empty folder to Syncthing, share it from the history device, and wait for the folder to become fully synchronized. During this first transfer the new device can use **Send & Receive**, because Syncthing did not scan its old task files before they were moved aside.

### 5. Verify before opening Tasks

While Tasks is still closed on the new device:

1. Confirm Syncthing reports the folder as up to date.
2. Compare `workspace.json` on both devices. The `workspaceId` must be identical.
3. Check that the task and order file counts look plausible.
4. Inspect a few task files if the history is important enough to warrant it.
5. Keep the Syncthing conflict and version directories intact until the new device has been checked.

Only now launch Tasks on the new device. Its new local SQLite database will bootstrap from the received canonical workspace. Check the task count and a few relationships in the UI, then use `workspace.sync` if you have a CLI or agent client. Do not run `workspace.rebuild` as a first response to a wrong root; preserve the files and investigate the identity or transfer problem first.

### 6. Choose the steady-state modes

After both devices show the same verified history:

- **Two active editors:** switch both folders to **Send & Receive**. Let Syncthing settle before switching between devices, and avoid editing the same task on two devices at once.
- **One-way archive or mirror:** keep the mirror **Receive Only**. Do not open Tasks there for editing.
- **One authoritative device:** keeping the history device **Send Only** prevents it from applying remote edits, but edits made elsewhere will not become part of that device's working copy until you intentionally change the mode. Use this only when that limitation is wanted.

Add further devices one at a time from a known-good, synchronized copy. Repeat the empty-target seed procedure instead of connecting several uninitialized workspaces at once.

## Daily safety rules

- Wait for Syncthing to settle before closing a device or opening the workspace on another device.
- Prefer one writer at a time for the same task or sibling scope. Independent task-file edits are less likely to conflict, but creating, moving, or reordering tasks can also touch an `order/*.json` file.
- Use Tasks or its command path to edit task files. Do not hand-edit a canonical file while Tasks or Syncthing is active.
- Never sync `tasks.db`, `tasks.db-wal`, `tasks.db-shm`, or `.tasks-local/`. SQLite is local and rebuildable; its WAL must not live in a shared folder.
- Do not use Syncthing **Override Changes** or **Revert Local Changes** as a general conflict resolver. Both buttons deliberately discard one side's local state.
- Do not delete `*.sync-conflict-*`, `.stversions`, or a device's pre-seed backup until the workspace has been checked and archived.
- File versioning only archives changes received from another device. It does not automatically preserve a bad local edit made on the same device, so keep regular Tasks archives as well.

## If something looks wrong

### A new device shows an empty or different workspace

Stop Tasks on that device and pause the Syncthing folder. Do not click Override Changes. Preserve the device's current `sync/`, `tasks.db`, `.tasks-local/`, and any Syncthing version/conflict files. Compare `workspace.json` with the history device. If the IDs differ, restore the pre-seed backup or remove the new device's local workspace from service and repeat the receive-only seed with an empty target.

### A task disappeared or a conflict appeared

Pause further edits long enough to preserve the current state. Keep the conflict copy and any `.stversions` entry. On a client with the workspace loaded, inspect:

```text
workspace.conflict.list
```

Resolve a specific entry explicitly with one of:

```text
workspace.conflict.resolve  { "conflictId": 1, "resolution": "keep-canonical" }
workspace.conflict.resolve  { "conflictId": 1, "resolution": "use-conflict" }
workspace.conflict.resolve  { "conflictId": 1, "resolution": "discard" }
```

Tasks does not silently merge two versions of a task. A task conflict is a whole-task candidate; an order conflict is a sibling-sequence candidate. Preserve an archive before choosing a resolution, and verify the result on every device after Syncthing settles.

If the wrong version has already propagated, restore from the Tasks canonical archive or a Syncthing version into a staging directory first. Inspect it, then replace the live canonical root only while Tasks and the Syncthing folder are stopped. Re-seed other devices from that verified root.

## Official Syncthing references

- [Getting started](https://docs.syncthing.net/intro/getting-started.html)
- [Folder types](https://docs.syncthing.net/users/foldertypes.html)
- [File versioning](https://docs.syncthing.net/users/versioning.html)
- [FAQ: conflicts and backups](https://docs.syncthing.net/users/faq.html#what-if-there-is-a-conflict)
