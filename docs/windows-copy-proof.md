# Windows absent-destination archive/restore proof (`gxm`)

The one private `--windows-task-proof --local-profile PATH` profile now has **18 commands**: the prior queries/activity/create/content/single-status/eligible-status-undo/recovery subset plus `workspace.archive` and `workspace.restore`. Default Windows writes, migration, init/rebuild, doctor, purge, relationship/order/batches and native UI remain withheld.

**Only absent destinations are supported.** The owner explicitly chose this boundary after native NTFS directory rename into an existing empty directory returned `EPERM`. Existing empty destinations fail with `UNSUPPORTED_COMMAND` before preview, staging or key consumption. There is no delete-before-rename fallback. Historical success can acknowledge the original request without recreating an absent destination or source.

## Evidence

- [Copy artifact/scene report](windows-copy-proof.json): **182 passing Windows Node/SEA groups**, 90 archive and 92 restore, counting both runtimes. Restore additionally checks independent source-directory replacement. The checker exited **0**.
- Retained proofs on the same verified bundle: [156 status/undo](windows-copy-retained-status-proof.json), [64 creation](windows-copy-retained-create-proof.json), [38 content-update](windows-copy-retained-update-proof.json). Each checker exited **0**. Original milestone reports remain unchanged.
- `pnpm check`, `pnpm lint`, `pnpm test`, `git diff --check`: pass. Full regression **1,626 passed, two known skips, zero failures**, 1,628 total. The skips remain the withheld-doctor fixture and optional isolated Syncthing. Original corpus coverage remains **101/112**, separate from scene/test counts.
- Production absence-only gating was committed as `06bdd1d`; the following proof commit records acceptance, not another writer implementation.

Host: Windows 11 Home `10.0.26200`, x64 fixed local NTFS, actual Windows Node `24.19.0` / libuv `1.52.1`. Explicit disposable source/selection/destination/cache/profile paths only. The isolated Windows checkout has older source files; the fresh bundle and checker were transferred and byte-verified, not represented as a synchronized source checkout. Owner D: checkout and personal tasks were untouched.

Current source bundle: **514,246 bytes**, SHA-256 `537687cb288209ff2c30164d2f8f2a720ce5c9d8c586c6e90c9da67cccce5f12`. The normal copy SEA is **93,466,112 bytes**, SHA-256 `3a4550c5b20036d00489bb683bb24e5cd44944385f9a22676e45c1f61850161e`. The copy report records the checker hash, runtime and all 20 packaged executable hashes. The retained update report records binaries rather than a source-bundle field; its selected bundle was independently verified before all retained runs.

## Exercised boundaries

- Exact canonical bytes and invalid-UTF8 known conflict copies, Markdown, fixed IDs/fields/time/order/graphs; unchanged source and selected-root task versions. Transport temporaries and Syncthing history are not copied.
- A meaningful content operation/receipt is seeded at the actual source. Source history remains present; the destination opens with fresh root authority, zero receipts and zero operations. Old source context cannot create at the destination.
- Explicit selection/default-profile/v1 traps, exact allowlist, previews, early empty refusal followed by same-key absent execution, restarted original-request replay, actor/flags/argument identity refusal and historical absence without resurrection.
- Physical junction resolution: source/selected-root/ancestor/nested overlaps refuse; an absent destination under a physically disjoint aliased parent publishes at the resolved path. Neither command switches selection.
- Actual termination at intent, bound empty stage, every **1–5** file-write prefix (descriptor last), verified report, target reservation, directory publication, before/after receipt commit, target/evidence retirement and lost reply. Post-publication cuts assert the actual destination matches the intended source. Pending target roots cannot resume the owner copy under the Windows proof profile.
- Unbound stage creation and unpublished progress replacement remain uncertain and refuse. Exact durable prefixes may explicitly finish through the original selected root/cache/profile, retaining the fixed operation and original receipt result.
- Source bytes/membership/independent-source binding, stage bytes/missing file/partial file/foreign entry/binding/directory absence, destination arrival, published output edits/absence/root or task-directory replacement, missing/partial progress, lost verification or target reservation, other/copied cache: recovery refuses and preserves the observed canonical/private evidence.
- An occupied destination arriving immediately before rename is preserved. Recognized published output must reflush its parent before receipts or retirement; injected flush refusal preserves evidence and stores no completion receipt.
- Original-location cache loss allows fresh-context explicit recovery with retained witnesses, never old-context replay. Recovery's own committed lost reply replays its receipt; corrupt cleanup stays pending, exact corrected cleanup can retire, and historical replay never recreates an absent output.
- Structurally valid copy intents with a retained existing-destination identity refuse both before application and during historical recovery receipt cleanup. Migration is withheld at command admission, and matching recovery requires archive/restore, absent destination and no migration evidence. No wider migration proof is claimed.

## Reproduction

Build `pnpm build:backend:bundle`, transfer and verify `dist/sidecar/cli.cjs` plus current checkers into an isolated Windows checkout with the existing fixture and postject dependency. From that checkout, with actual Windows Node:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/check-windows-copy.mjs
& 'C:\Program Files\nodejs\node.exe' scripts/check-windows-status.mjs
& 'C:\Program Files\nodejs\node.exe' scripts/check-windows-create.mjs
& 'C:\Program Files\nodejs\node.exe' scripts/check-windows-update.mjs
```

Allow at least **25 minutes** for the copy checker. It writes `.tmp/windows-copy-proof.json` after each scene, with `complete: false` until the entire proof finishes, then emits the final report and removes its successful scratch. Incomplete scratch stays for diagnosis. The final run also captured its exit code separately. A parent timeout is not a passing exit status and may leave a Windows writer running; inspect it before retrying.

Checker bring-up exposed three harness mistakes, corrected without production changes: a non-unique initial-prefix transform, using file removal on a synthetic empty directory, and comparing transient SQLite lock journals as copy witnesses. The final harness uniquely bounds each module/function/statement, braces conditional write/unlink cuts and excludes only local lock machinery from recovery-evidence comparisons. All canonical inventories remain exact. An initial 900-second run completed after its parent timed out; it was not used as the final exit-status proof. The full strengthened rerun exited 0 with source-history assertions.

Clean-code self-review: reused the existing public copy writer/journal/files engine; no obsolete stage-only port, production fault hooks, new dependency or generic writer framework. Standalone family proof scaffolding remains deliberately repeated to avoid reworking validated ownership/cut diagnostics in the retained checkers. All source mutation/fault injection is confined to disposable checker bundles.

## Limits

Short local NTFS paths only. Numeric synthetic scene names avoid the known SQLite lock-journal path limit; this is not a long-path product fix. Native selection must validate complete supported paths or independently prove longer ones. Unsigned postject signature/listener warnings remain packaging limitations.

This is bounded process-interruption evidence, not hardware power loss, hostile reparse/noncooperating races, network/document providers, Android/Linux native, signing/installers, UI lifecycle, release or personal backup/restore acceptance. Preserve original authority and recovery evidence; uncertain ownership requires reconciliation, not automatic adoption or rollback. Native `m1p` remains the next gate.
