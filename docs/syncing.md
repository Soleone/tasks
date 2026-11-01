# Syncing devices with Syncthing

Tasks has no account and no sync service of its own. Your tasks are plain files, so you keep devices in step by syncing one folder with [Syncthing](https://syncthing.net), which copies files directly between your own devices.

The browser version at [tasks.soleone.xyz](https://tasks.soleone.xyz) keeps its tasks inside the browser and can't sync. Use the desktop or Android app on every device you want to share.

## What to sync

Each device has its own Tasks home. Only its `sync/` folder is shared:

```text
<home>/sync/           shared: workspace.json, tasks/ and attachments/
<home>/settings.json   this device only
<home>/local/          this device only: cache, lock, undo history, recovery files
```

Never add the home itself or its `local/` folder to Syncthing. That would copy one device's live database and lock onto another. Tasks checks for it: a home inside a Syncthing folder can't be created, and an existing one stops accepting changes until you remove it from Syncthing.

## Set up the first device

1. Install Tasks and create a home on first launch. Setup shows the home's sync folder, and Settings › Data shows it again later with Copy path.
2. In Syncthing, choose **Add Folder** and set its path to that sync folder, for example `~/Tasks/sync`. Label it something like `Tasks`.
3. Under **Sharing**, tick the devices you want to sync with.

## Add another device

1. Install Tasks there and create a new home. Don't open the other device's home or point Tasks at a folder you are about to sync; each device needs a home of its own.
2. Install Syncthing and pair it with the first device.
3. Accept the shared folder and set its path to this device's sync folder, for example `~/Tasks/sync`.
4. Once Syncthing shows the folder as **Up to Date**, the tasks appear in Tasks without a restart.

If both devices already had tasks, they simply add up: different tasks sit side by side and identical ones count once.

**On Android** the home must live on shared storage (Tasks suggests `/storage/emulated/0/Tasks`), and Tasks asks for all files access so it and Syncthing can both reach it. The folder to sync is `/storage/emulated/0/Tasks/sync`. The [Syncthing downloads page](https://syncthing.net/downloads/) lists the Android apps.

Already syncing a task folder from a version of Tasks before homes? Follow [moving a task folder into a home](moving-to-a-home.md) instead.

## Day to day

- **Changes show up on their own.** Edits from other devices, the CLI and agents refresh the open list without a restart. An image can arrive a moment after the task it belongs to.
- **Undo stays on each device.** `Ctrl/⌘+Z` takes back changes made on this device. It won't undo a change that came in from another one, and it refuses a step that would overwrite one.
- **Turn on file versioning.** Syncthing's file versioning for this folder gives you old copies of every task file. Tasks ignores the `.stversions` folder it creates.
- **Let it settle before switching.** Syncthing usually syncs within seconds, but if you edit on your phone and then on your laptop before they have seen each other, the same task can end up with two versions.

## When two devices change the same task

Syncthing copies files; it doesn't merge them. If a task changes on two devices before they sync, Syncthing keeps one version under the usual name and saves the other beside it as a conflict copy:

```text
<home>/sync/tasks/<id>.sync-conflict-<date>-<time>-<device>.json
```

Tasks never merges the two or picks a winner on its own. The list keeps showing the version under the usual name, and the conflict copy waits until you deal with it. To find any:

```bash
ls ~/Tasks/sync/tasks/ | grep sync-conflict
```

To resolve one, open both files and compare them:

- **The copy has nothing you need:** delete it.
- **The copy has the change you want:** make that change in Tasks, then delete the copy.
- **You want both as separate tasks:** use doctor, below.

A few cases come down to Syncthing rather than Tasks: whether an edit or a delete wins when they cross depends on Syncthing, and reordering the same tasks on two devices at once can conflict. Tasks never brings back a deleted file from an old copy.

### Doctor

Doctor resolves conflicts you have reviewed, through the CLI's JSON lines. It can split a conflict into separate tasks, keeping the original ID on the version you pick, and fix links that point at the wrong one. Use it on one device at a time: let Syncthing finish, pause the folder, close Tasks, then run it.

```bash
printf '%s\n' '{"version":2,"command":"workspace.doctor.inspect","args":{}}' | \
  tasks-cli --stdio --client cli
```

Inspect lists each issue with every version found. Then `workspace.doctor.plan` builds a plan and `workspace.doctor.apply` carries it out; [the sharing spec](../spec/ecosystem/sharing.md#doctor) has the details. Doctor can't be undone, but it keeps a recovery copy of everything it removes. Resume the folder in Syncthing afterwards and let it settle before repairing anything on another device.
