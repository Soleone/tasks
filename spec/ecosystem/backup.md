# Backup and restore

| Rule | Then |
| --- | --- |
| `archive.copy` | `workspace.archive` copies a valid workspace and its known conflict copies to a new folder. It never copies the cache, receipts or undo history |
| `archive.source-unchanged` | The source folder's bytes never change |
| `archive.destination` | The destination must be absent or empty and outside the source. Overlap fails `INVALID_ARGUMENT`; an occupied destination fails `DESTINATION_NOT_EMPTY` |
| `archive.verify` | The copy is verified before it is reported complete. An interrupted copy is left marked incomplete, never usable |
| `restore.new-folder` | `workspace.restore` validates a backup and copies it into a new folder under the same destination rules |
| `restore.no-switch` | Restoring never switches the open workspace. Opening the restored folder is a separate, explicit step with fresh write authority |
| `backup.independent` | Backups are independent copies, not a shared history. Keep them; local recovery copies don't survive every kind of loss |
