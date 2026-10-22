# Rules

## Status

| Command | Allowed from | To |
| --- | --- | --- |
| `task.start` | open, in progress, paused, done | in progress |
| `task.pause` | open, in progress, paused | paused |
| `task.complete` | open, in progress, paused, done | done |
| `task.reopen` | any | open |
| `task.cancel` | open, in progress, paused, canceled | canceled |
| `task.delete` | any | canceled |

| Rule | Then |
| --- | --- |
| `status.same-state` | A request for the current status changes nothing and still succeeds |
| `status.invalid` | Any other move outside the table fails `INVALID_TRANSITION` |
| `status.delete-is-cancel` | `task.delete` cancels. Only `task.purgeCanceled` and `task.clearDone` remove files |
| `status.no-cascade` | Changing a task's status never changes its children or dependents |

## Relationships

| Rule | Then |
| --- | --- |
| `link.new-target` | A new parent or blocker must exist and not be canceled |
| `link.existing-canceled` | Existing links to canceled tasks can be removed or restored by undo |
| `link.no-cycle` | Parent and dependency cycles and self-links fail before any write, including in batches and undo |
| `link.reparent-first` | A task moved under a new parent goes first among its new siblings. Its own children keep their links |
| `link.noop` | Setting the same parent or removing an absent link changes nothing |

## Time

Each operation uses one captured instant.

| Change | `updatedAt` | `closedAt` |
| --- | --- | --- |
| Create | now | `null` |
| Title, description, priority, category, tags, attachments | now | kept |
| Parent or dependency | now | kept |
| Status to done or canceled | kept | now |
| Status to open, in progress or paused | kept | `null` |
| No-op | kept | kept |
| Reorder or key maintenance | kept | kept |
| Clearing attachments from done tasks | kept | kept |
| Undo of a status change | kept | the exact earlier value |
| Undo of a content or link change | now | earlier value only if closure changed |
| Redo of a status change | kept | the exact recorded forward value |
| Redo of a content or link change | now | recorded forward value only if closure changed |
| Redo of an order change | kept | kept |
| Redo of a create | original value | original value |

| Rule | Then |
| --- | --- |
| `time.created-fixed` | `createdAt` never changes after create |
| `time.updated-is-edit` | `updatedAt` means the last edit, not the last status change |

> Why: keeping edit time separate from closing time lets sorts by "updated" mean what people expect.

## Order

Every set of siblings (same parent, or all root tasks) has a persistent manual order. It includes hidden and canceled tasks.

| Rule | Then |
| --- | --- |
| `order.compare` | Sort by order key bytes ascending (a shorter prefix comes first), then by task ID bytes. No locale, no case folding |
| `order.keys` | Keys follow `fractional-indexing` 3.2.0 with its default base-62 digits. `generateKeyBetween` and `generateNKeysBetween` must give byte-identical results |
| `order.key-valid` | A key starts with A-Z or a-z, has the integer length that head implies, never ends its fraction in `0`, is never bare `A` plus 26 zeros, and is at most 256 bytes. Invalid stored keys fail `INVALID_CANONICAL`; generating one that is too long fails `ORDER_KEY_LIMIT` before writing |
| `order.new-first` | Created tasks and tasks moved under a new parent go first in their sibling set |
| `order.ties` | Equal keys are legal. Two devices capturing at once may pick the same key; the ID breaks the tie |
| `order.reorder-gap` | A reorder writes keys only for the moved tasks when there is a gap. Inside a run of equal keys, it rewrites only the keys in that run that must change |
| `order.reorder-noop` | A reorder that leaves the same sequence writes nothing |
| `order.normalize` | `task.order.normalize` rewrites a sibling set to `generateNKeysBetween(null, null, n)` in its current order. It is never automatic |
| `order.preserve-fields` | Order changes touch only `orderKey` |

| Lower | Upper | Count | Keys |
| --- | --- | --- | --- |
| null | null | 1 | `a0` |
| null | `a0` | 1 | `Zz` |
| `a0` | null | 1 | `a1` |
| `a0` | `a1` | 1 | `a0V` |
| `a0` | `a1` | 2 | `a0G`, `a0V` |
| null | null | 3 | `a0`, `a1`, `a2` |

Example: siblings `lower:a0, a:a1, b:a1 (canceled), upper:a2`. Moving `move` before `b` gives `lower, a, move, b, upper` and writes only `a:a0V, move:a1, b:a1V`.

> Why: one key per task means independent captures never fight over a shared order file.

## Undo

| Rule | Then |
| --- | --- |
| `undo.status` | `task.status.undo` restores the latest status change and its exact `closedAt`, while nothing newer changed that task |
| `undo.operation` | `operation.undo` reverses one recorded operation if every affected task and sibling set is still as the operation left it. Fields changed later by unrelated edits are kept |
| `undo.order` | Undoing a reorder fails if siblings arrived, left or changed keys since |
| `undo.create` | Undoing a create removes the file only while the task is unchanged and nothing links to it. A copy of the file is kept outside the folder |
| `undo.graph` | The whole resulting graph is checked before any write |
| `undo.not-destructive` | Purge, clear done, doctor and migration can't be undone. Their recovery copies replace undo |
| `undo.unavailable` | Ineligible undo fails `UNDO_UNAVAILABLE` or `OPERATION_UNAVAILABLE` and changes nothing |
| `undo.direction` | `operation.undo` reverses an original supported change or a completed `operation.redo`, never an undo. `operation.redo` reverses a completed `operation.undo` |

## Redo

| Rule | Then |
| --- | --- |
| `redo.operation` | `operation.redo` reapplies one undone operation from its recorded effect, not by rerunning its original command. Unrelated current fields are kept; the complete resulting graph and any affected sibling scope are checked before writing |
| `redo.claims` | Each successful undo or redo records a fresh operation ID and consumes its immediate source once. Repeated cycles use those new IDs; old claims and receipts are never reset |
| `redo.create` | Redo of an undone create restores its retained task with the same ID, fields, order key and timestamps only if its file is absent, no conflict evidence exists for it, and the resulting graph is valid. It never creates a replacement ID or overwrites a reappeared file |
| `redo.unavailable` | Missing, consumed or unsafe redo history fails `OPERATION_UNAVAILABLE` without changing files or consuming the request's idempotency key |

## Purge

| Rule | Then |
| --- | --- |
| `purge.all-canceled` | `task.purgeCanceled` removes every canceled task at once, never a subset |
| `purge.referenced` | If any surviving task's parent or dependency points at a canceled task, nothing is removed and it fails `PURGE_REFERENCED` listing each survivor, target and field |
| `purge.no-relink` | Purge never reparents or unlinks survivors. Linked canceled tasks can be purged together |
| `purge.recovery` | Removed files are copied outside the folder first. There are no tombstones |
| `purge.attachments` | Attachments listed only by purged tasks are removed with them |
| `purge.unlisted` | Purge also removes attachments no task lists, but only names matching `data.attachment-name`, only those added more than 7 days ago (by their name) and not listed in any task record kept by this cache's undo and redo history |
| `purge.empty` | With nothing canceled and nothing unlisted to remove, it succeeds and changes nothing |

> Why: an image pasted on another device can arrive before the task that lists it, and an undo here can bring a removed image back. The grace period and the history check keep purge from deleting either.

## Clear done

| Rule | Then |
| --- | --- |
| `clear-done.selection` | `task.clearDone` selects done tasks whose `closedAt` is before `closedBefore`, or every done task when it is `null` |
| `clear-done.tasks` | With scope `tasks`, the selected task files are removed, with the attachments no remaining task lists |
| `clear-done.linked` | With scope `tasks`, a selected task stays when a task that stays links to it as parent or dependency, repeated until nothing more changes. Kept tasks are listed in `keptIds`. Links never make it fail |
| `clear-done.attachments` | With scope `attachments`, the selected tasks lose their `attachments` (keeping `updatedAt`), and files no remaining task lists are removed. The tasks stay |
| `clear-done.export` | With `export: true`, a zip is written to the home's `exports/` before anything is removed (a bare `--root` folder refuses export with `INVALID_ARGUMENT`): `tasks.json`, an array of the affected task files as stored, and `attachments/` with every file being removed. It is verified first; if writing it fails, nothing is removed |
| `clear-done.recovery` | Removed files are copied outside the folder first, as with purge |
| `clear-done.unlisted` | Attachments that no task listed beforehand are left for purge |
| `clear-done.empty` | With nothing selected, it succeeds, changes nothing and writes no export |
