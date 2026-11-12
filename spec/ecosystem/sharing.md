# Sharing

A workspace is shared by syncing its folder, for example with Syncthing: the `sync/` folder of each device's Tasks home, never the home itself. Tasks adds no sync service of its own.

## Syncing

| Rule | Then |
| --- | --- |
| `share.folder-only` | Only `workspace.json`, `tasks/` and `attachments/` are shared. Each device keeps its own home with its own cache, settings and recovery files |
| `share.refresh` | The app notices changes from other devices and the CLI and refreshes without a restart |
| `share.join-disjoint` | Different task files from different devices simply add up |
| `share.join-identical` | The same ID with identical bytes is one task |
| `share.conflict-kept` | Different versions of one task, including sync conflict copies, are reported as issues. Tasks never merges them or picks a winner on its own |
| `share.edit-delete` | Whether an edit or a delete wins depends on the sync tool. Tasks never restores a deleted file from an old copy |
| `share.no-crdt` | Two devices reordering the same siblings at once may conflict. Tasks doesn't promise to keep both intentions |

## Conflicts in the app

| Rule | When | Then |
| --- | --- | --- |
| `conflict.count` | A task in the list has one or more conflict copies beside it, all readable | The header shows how many tasks, in the warning color with a split icon, left of the due count. It is hidden at none. A copy whose task is gone, or one that can't be read, isn't counted and stays with doctor in the CLI |
| `conflict.dialog` | Clicking the count | A dialog shows one conflicted task at a time: the version in the list first, then each copy, each drawn as a task row with its details and its own Keep this one button. A line names the fields that differ, e.g. "They differ in title and priority" |
| `conflict.keep` | Keep this one | That version stays under the task's ID through a `keep-one` doctor plan, and the others are removed. The next conflict shows, or the dialog closes after the last. A refusal shows its message and the versions as they are now |

## Doctor

Doctor resolves conflicts a person has reviewed. Use it on one device at a time: finish syncing, pause sharing and other writers, inspect, plan and apply there, then resume sharing and let it settle before repairing elsewhere.

| Rule | Then |
| --- | --- |
| `doctor.inspect` | `workspace.doctor.inspect` lists issues, each version found (by path, ID and byte hash) and the links pointing at it. It works even with unfinished work pending |
| `doctor.keep-both` | A `keep-both` plan picks which version keeps the original ID. Each other version becomes a new task with a fresh UUID and its content and times unchanged |
| `doctor.keep-one` | A `keep-one` plan picks the one version that stays under the original ID. The other versions are dropped, and links to the task are left alone |
| `doctor.links` | Every link pointing at a split task needs an explicit choice of version. A missing choice fails `AMBIGUOUS_LINK` |
| `doctor.repair-links` | A `repair-links` plan fixes only reported broken links, by reparenting or removing dependencies |
| `doctor.apply` | `workspace.doctor.apply` with the plan ID is the confirmation. If anything changed since planning, it fails `STALE_REPAIR_PLAN` and writes nothing |
| `doctor.cleanup` | Conflict copies the plan names are removed only after every new file is written and verified. Their bytes stay in a recovery copy |
| `doctor.late-links` | A link to a split task that shows up later is reported, never redirected silently |
| `doctor.not-undo` | Doctor is not undoable. Restore from its recovery copy instead |
