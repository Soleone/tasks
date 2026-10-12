# Task creation: one snapshot, sibling stage, native rename

Owner-approved bounded change: only Node V2 `task.create` on Linux and the explicitly selected Windows profile. Android V2 writes stay withheld; no other mutation journal changes.

## Desktop design

Keep one initial canonical workspace snapshot for graph/input validation, first-position ordering and SQLite authority. Preserve UUID/time/default fields, non-consuming previews and successful operation/history records. Write one hidden `.syncthing.taskdb-create-<operationId>.tmp` sibling in `tasks/`, flush its bytes, recheck the selected parent's exact bytes (if any), destination names and physical root/task-directory identity, then native rename and directory flush. No repeated full-root observations before or after publication: the known published task extends the initial snapshot for the transaction; the next query observes external changes normally.

New calls write no pending-create intent/progress and bind no stage identity. Interrupted stages are orphans: never auto-adopt, resume or silently remove them. A crash/error after rename but before SQLite commits may leave a canonical task without local history/receipt. The owner accepts that retrying the same request can create a duplicate. Once a success receipt commits, the original request replays its original result, even if the task later disappears; replay never resurrects it. Retain the original request and inspect uncertain outcomes before choosing a retry.

Unrelated external edits/arrivals after the initial observation do not abort capture. Parent/destination rechecks are best effort, not distributed locking or a no-clobber CAS. Native rename can overwrite a destination arriving after the final check on some platforms. Concurrent sibling arrivals may change first-position ordering. No hostile filesystem race or power-loss guarantee is added.

Pre-existing `taskdb.pending-create` evidence retains full-guard, hard-link/stage-identity/progress recovery. Owner-approved F10 narrows this legacy path: an already-present stage with no durably bound identity is preserved and refused, even if its bytes match. A stage-write-before-binding crash therefore requires manual inspection, not automatic adoption. New creates refuse pending work; only explicit recovery can complete/retire old intents. Missing/divergent old evidence remains for inspection, never reinterpreted as an orphan. Other mutation journals are unchanged.

## Future Android decision (not implementation permission)

Only local SAF through the chosen standard local provider is in scope, not arbitrary SAF/cloud providers. Android V2 writes remain gated pending end-to-end native integration. Future creation would stage a hidden sibling then use `renameDocument`, recheck the selected parent/destination rather than rescan the whole workspace, and keep only post-success SQLite receipts. Accept the same publish-before-receipt duplicate window and provider-specific collision/atomicity limits; never auto-adopt interrupted stages. Prove actual provider behavior and the complete native request/receipt route before enabling writes.

## Evidence boundary

Linux subprocess/regression tests cover the reduced observation path, selected guards, orphan preservation, accepted crash window, receipt replay and explicit old-intent recovery. [The Windows checker](../scripts/check-windows-create.mjs) now targets the simplified route but requires an actual Windows Node/SEA run on fixed local NTFS. [The old Windows report](../docs/windows-create-proof.md) remains historical journaled-process evidence, not simplified-route Windows acceptance. This implementation host is Linux/WSL2, not Windows; no native Windows, Android or release acceptance is claimed.
