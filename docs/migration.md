# Converting the old version's tasks

The app isn't published, so converting old (schema 1) task folders is an owner-only step, not part of the app. `pnpm migrate` wraps the CLI's `migrate` verb ([rules](../spec/ecosystem/migration.md)). It goes away once the owner's tasks are converted.

1. **Back up and pause.** Close the old app and stop Syncthing for the folder. Copy the old folder somewhere else as a backup. On Windows the old version kept it in `%APPDATA%\com.soleone.tasks\sync`.
2. **Convert.**

   ```powershell
   pnpm migrate "$env:APPDATA\com.soleone.tasks\sync" D:\data\donedb
   ```

   The old folder is only read. The new folder must be absent or empty. Saved manual order is kept where possible: stale references are discarded and missing siblings appended by ID. Missing order files or the entire order directory are fine; no tasks are dropped to match an order file. Top-level files that aren't JSON stay behind; anything else unexpected stops the conversion before it writes.
3. **Open it.** Start the desktop app and choose the new folder in setup, or in Settings → Data → Change folder.

## If it stops

A refused source names the file, field and reason. Fix the old folder by hand (or restore it from the backup), then run `pnpm migrate` again into an empty folder.

If the run is interrupted after it starts writing, it prints where it kept its cache. Don't delete that folder or the half-written destination. Resume with the operation ID from `info`:

```powershell
node dist/backend/tasks-cli.js --root OLD --database CACHE info
node dist/backend/tasks-cli.js --root OLD --database CACHE recover OPERATION_ID
```

Rolling back means opening the old folder in the old version again. Edits made after the conversion aren't copied back.
