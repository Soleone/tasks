# Backup

A full backup is a copy of the whole Tasks home: its tasks, settings, caches, undo records and recovery files.

| Rule | Then |
| --- | --- |
| `backup.full-home` | A full backup is a copy of the whole home made while the app and the CLI are closed. Opened from the copy, each cache fails `CACHE_FROM_ELSEWHERE` until `workspace.newHistory` sets it aside; the tasks, settings and undo records come along. A home moved rather than copied keeps its history after `workspace.rebind` (`auth.moved-home`) |
| `backup.independent` | Backups are independent copies, not a shared history. Keep them; local recovery copies don't survive every kind of loss |
