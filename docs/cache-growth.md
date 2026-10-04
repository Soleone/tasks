# Authority cache growth fix (`fwk`)

Measured 2026-10-04 on WSL2 Linux 6.6.114.1, Node v22.22.3. Disposable data only; no native, provider, hardware power-loss or personal-data acceptance.

## Change and existing caches

`src/backend/v2QueryCache.ts` now computes one SHA-256 signature per complete sibling sequence, including hidden/canceled tasks and the exact ID tie-break. Each observation stores the task's exact-byte hash plus that signature: **135 ASCII characters per task**, independent of sibling count. Formatting changes, membership/order invalidation, selected-key-unchanged moves and unrelated-scope isolation retain their existing behavior. No canonical schema, query contract, watcher or additional projection store changes.

SQLite schema remains 5 because no tables change. Existing `[byteHash, siblingIds]` observations differ from `[byteHash, scopeSignature]`; the next complete valid observation transactionally replaces them and allocates non-reused task versions. Context/counter, receipts, activity, memberships, undo claims, doctor plans and pending journals are not discarded. An incomplete/pending read without a snapshot leaves the observations untouched; an aborted refresh rolls back. The workspace revision changes only when canonical inventory/bytes change, not merely because this representation refreshes.

Re-read before a **new** mutation after that refresh. An uncertain original request must retain its original context/key/payload/version: completed receipts still replay historically, and pending work still requires explicit recovery. Tests exercise both paths. This is not a cache deletion/recreation or general compatibility layer.

Existing oversized database files do **not** automatically shrink. SQLite makes overflow pages reusable; this change neither vacuums the database nor deletes recovery evidence. Do not delete a retained cache to obtain the fresh-cache sizes below.

## Repeat the measurements

From the project root:

```bash
pnpm build:backend
node scripts/measure-authority-cache.mjs
```

The script creates/removes its own temporary roots, outside-root caches and app-data profile. Four scenes contain 1,000/5,000 flat or nested tasks. Nested scenes have ten root parents and evenly distributed children; all tasks use equal valid keys, exercising ID ties. It calls the actual `executeV2Line` gateway, including full canonical scans and synchronous SQLite transactions. Timings exclude CLI process startup and are diagnostic, not regression thresholds. Each warm command has five samples; update is an unchanged literal-title request with a **new key**, not a receipt replay. The recorded run was isolated from the full regression run.

| Layout | Tasks | Fresh cache bytes | Fingerprint characters | Info median ms (range) | Get median ms (range) | No-op update median ms (range) |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Flat | 1,000 | 245,760 | 135,000 | 48.42 (47.85–50.51) | 51.40 (46.40–54.86) | 88.03 (86.61–90.20) |
| Flat | 5,000 | 983,040 | 675,000 | 232.87 (228.54–235.49) | 229.03 (227.10–236.90) | 444.05 (440.78–457.90) |
| Nested | 1,000 | 245,760 | 135,000 | 45.08 (44.58–46.81) | 46.07 (44.97–47.51) | 91.42 (86.89–98.72) |
| Nested | 5,000 | 978,944 | 675,000 | 232.85 (230.88–235.58) | 232.97 (229.75–239.43) | 452.00 (445.71–455.21) |

The same physical caches then receive the old schema-5 array observations, with context/receipts retained. Their next info call refreshes the representation, preserves revision/context, and leaves canonical byte hashes unchanged. Original no-op receipts replay afterward. This reconstructs the old stored representation, not an old-binary speed benchmark; historical old-binary measurements are in [the reset inventory](refactor-reset.md#quadratic-authority-fingerprints).

| Layout | Tasks | Old observation chars | File bytes before/after refresh | Reusable free bytes afterward | First refresh ms | Retained-cache warm info median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Flat | 1,000 | 13,070,000 | 13,398,016 | 12,288,000 | 58.70 | 45.66 |
| Flat | 5,000 | 325,350,000 | 327,888,896 | 307,200,000 | 795.62 | 247.25 |
| Nested | 1,000 | 1,345,430 | 2,113,536 | 0 | 50.90 | 47.65 |
| Nested | 5,000 | 32,721,430 | 41,086,976 | 20,439,040 | 317.23 | 242.46 |

After every refresh the total is again exactly 135 characters per task. The script asserts that structural property, context/revision preservation, historical replay and unchanged canonical files. Physical file-size reclamation and eliminating full-root scans are outside this task.

## Verification

- `v2QueryCache.test.ts`: four structural 1k/5k flat/nested scenes, hidden/tied sibling membership and unaffected scope tokens; schema-5 refresh with rollback, unchanged revision/context, retained local tables, historical status/undo receipts and old unsent version refusal. Doctor-plan payload retention is a table-preservation check, not a new repair acceptance claim.
- `v2UpdateRecovery.test.ts`: an actual CLI SIGKILL after replacement, reconstructed old cache observations, unchanged pending bytes, explicit recovery and original-request replay with exactly one activity record.
- Focused cache/update/order/lifecycle/recovery run: **120 passed**.
- `pnpm test`: **1,598 passed, zero failed, two skipped (1,600 total)**. Skips remain optional isolated Syncthing and the original withheld-doctor capability case, unsupported by the writable Linux profile.
- `pnpm check`, `pnpm lint`, `git diff --check`: passed. Clean-code review: scoped production change, no new abstraction/dependency, comments explain the retained-authority transition.

Original corpus coverage remains the recorded 101/112. No UI changes or native validation. Stop for review; `dh1` is the next bounded host-feasibility task, not automatically authorized by completing this fix.
