# Windows capture proof (`7hr`, 2026-10-04)

## Simplified-route proof pending

The Node desktop create route now stages a hidden sibling and publishes by native rename, without new pending-create journals/progress. See [the approved design](../spec/v2/storage.md#task-creation) for selected guards, orphan handling and the accepted publish-before-SQLite duplicate window. Existing old intents still have explicit recovery under the original journal contract.

`node scripts/check-windows-create.mjs` now measures the simplified route: pre-publication orphan, publish/before-commit duplicates, committed receipt replay, selected parent/destination guards, unrelated changes and flush refusal. Run `pnpm build:backend:bundle` first, then the checker with actual Windows Node in a disposable fixed local NTFS checkout. Its new results must be recorded separately, never overwrite the dated JSON report below. Native rename is not a no-clobber CAS.

**No simplified-route Windows acceptance yet:** implementation/validation ran on Linux/WSL2 (`process.platform === "linux"`), not actual Windows Node. Syntax/source-transform checks are not Windows Node/SEA execution. Android V2 writes remain withheld. Current command admission is indexed in [support](support.md); the old five-query/two-writer profile below describes its original checkpoint only.

## Historical scope and invocation (2026-10-04)

One explicit Windows profile now permits five queries, `activity.list`, `task.create`, `task.update` and matching explicit recovery. Default Windows writes, statuses/undo, relationships/order/batches and workspace controls remain withheld. Native launch/permissions/UI are unchanged.

From an actual Windows Node checkout on fixed local NTFS, with disposable data only:

```powershell
pnpm build:backend:bundle
node scripts/check-windows-create.mjs
node scripts/check-windows-update.mjs
```

The checkers own fresh synthetic golden roots, outside-root caches and dedicated APPDATA profiles. They package the actual Windows Node runtime through the existing SEA/postject mechanism. Installed-product system-Node independence and native lifecycle remain later gates.

The **single private profile flag** is now `--windows-task-proof`, replacing `--windows-update-proof` without an alias because its bounded scope includes creation. Keep the exact eight positions in the future selected native route:

```text
--stdio --v2-root ABSOLUTE_ROOT --database ABSOLUTE_OUTSIDE_ROOT_CACHE
--windows-task-proof --local-profile ABSOLUTE_OUTSIDE_ROOT_PROFILE
```

There is still no replacement `pnpm dev:tauri` launch. The prospective inline capability must use this new fixed flag, not add a second same-name scope or default/mobile grants. Creation and content share the existing gateway/runtime; no second engine or arbitrary shell route was added.

## Historical journaled publication and recovery

The existing Linux creation implementation was reused, not ported by bypassing ownership:

1. Check context/key, historical receipt, complete source bytes/graph, authority budget and parent scope. Generate a lowercase UUIDv4, operation ID, time and first-position fractional key once. A preview's ID/time/version is hypothetical, never reserved; callers cannot supply a creation ID.
2. Retain initial durable progress before immutable pending intent. The intent fixes original envelope, physical root/task-directory/cache bindings, full byte/membership guards and next bytes. Missing initial progress cannot mean fresh capture.
3. Write/flush the private same-directory stage, bind its physical identity and durably publish `publicationStarted` before the no-clobber hard link. A target arriving after the final guard must not be replaced. Exact matching bytes alone do not establish ownership.
4. After link, flush its directory, validate fixed bytes/identity/full graph and publish verified progress. **Fix in this task:** recovery of an already-linked target now reflushes the task directory before verification, history or receipt. The earlier conditional flush could be missed by termination immediately following the link. Flush refusal preserves target/stage/progress/pending evidence and creates no receipt/history.
5. Commit one effect/history and original-context receipt before private stage/progress/intent retirement. Missing target after publication-start is uncertain, never permission to recreate. Missing/replaced/partial ownership/progress, source formatting/membership changes and other/copied cache selections refuse with preserved evidence.
6. An unchanged original request can replay historical success after the task disappears without resurrection. Explicit recovery has its own receipt and survives its own lost reply. Corrupt post-commit cleanup stays pending even while that acknowledgment is safely historical. Original-location cache loss can explicitly complete fixed evidence under fresh authority, never revive old-context request replay or invent a new ID/time/key.

Windows recovery now admits only a `taskdb.pending-create` with original `task.create`, or a `taskdb.pending-update` with original `task.update`, including historical-acknowledgment retirement. Every other pending family/command remains unavailable. No broad `82r` gate was removed.

## Historical actual evidence

[Structured report](windows-create-proof.json) records the exact executed bundle, host, artifact hashes and all scenes. Executed bundle SHA-256: `f0bdd8638c12aa45ece62e2d11a9fc40acc87aeb0e962af10d181a825187ddae`. It was copied byte-for-byte to the existing isolated C: proof checkout; that checkout's older source files were not claimed as current provenance. Owner D: source and personal data were untouched.

- Windows 11 **10.0.26200**, x64, Windows Node **24.19.0**, libuv **1.52.1**, fixed local **NTFS**. **64 creation scene groups** across Windows Node/SEA plus **38 retained update groups**, all passed.
- Actual capture termination: intent, stage write/binding, publication-start, link, verification, before/after SQLite commit, stage/evidence retirement, unpublished progress and lost reply. Recoverable scenes produce fixed bytes/UUID/time/key and one history/original receipt plus a separate recovery receipt. Started absence and unpublished progress refuse instead of guessing.
- Refusal: formatting/arrival, occupied or exact-but-unowned target, missing/replaced/divergent target, lost/replaced/partial stage, lost/partial progress, task-directory replacement, different/copied cache. A last-instant target collision stays untouched. Actual already-linked flush refusal prevents acknowledgment/retirement. Recovery's own lost reply/corrupt cleanup and cache-loss authority rotation are exercised.
- `pnpm check`, `pnpm lint`, full `pnpm test`: **1,622 passed, two known skips, zero failures**. Focused Linux capture/status fault tests: **67 passed**, including the new publication-flush regression. Skips remain withheld-doctor and opt-in isolated Syncthing.

## Tooling failures and bounded limits

- Initial checker source transforms assumed unsuffixed esbuild private names/module headers. Packaging stopped before scene acceptance. The harness now locates the unique function within its actual module segments, accepts generated numeric suffixes, validates every transform before packaging, and runs Node scenes before SEA packaging. Faults/diagnostics are injected only into disposable bundles, not production switches.
- A deep scene profile made `lock.db` 254 characters and its SQLite journal path exceed this host's 260-character boundary. Windows SQLite refused before any capture intent/effect. The diagnostic run remains at `.tmp/windows-create-J6jA7W` in the isolated proof checkout. Fresh numeric scene directories prove only short explicit paths. **Native selection must validate supported full root/cache/profile/lock-journal path lengths, or separately prove longer paths before accepting them.** This is not arbitrary-long-path acceptance or permission to shorten an uncertain live selection.
- Fifteen creation and seven update SEA signature warnings remain unsigned-packaging evidence. Repeated postject instances emitted process-listener warnings during creation packaging; no production listeners or warning suppression were changed.
- Successful scratch data/binaries were removed; failed synthetic diagnostic scratch was retained. No power-loss durability, hostile reparse/hardlink race, network/provider, native UI/lifecycle, status/undo/archive/restore, installer/signing or release acceptance is claimed.

Clean-code self-review kept distinct no-clobber creation/replacement safeguards, scoped the sole durability fix, and left two concrete test harnesses rather than inventing a generic writer/proof framework. Under the owner's active validated task/commit loop, the next bounded task is `byy`, single-task statuses and eligible latest-status undo, not native UI or workspace controls.
