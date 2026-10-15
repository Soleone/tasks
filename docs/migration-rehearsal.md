# One-time migration rehearsal (`y9b`)

## Decision and boundary

Reuse the existing converter and guarded copy publication unchanged. The rehearsal passes on **WSL2 Linux Node v22.22.3**, with canonical roots on the Linux filesystem, a separate protocol-2 control cache and disposable `XDG_DATA_HOME`. This is process-interruption evidence, not native migration, hardware power-loss or sharing/provider acceptance.

**Windows migration remains unavailable**, including in the private `windows-task-proof` profile. Its archive/restore proof does not authorize conversion. Android migration is also withheld. A future Windows-only conversion requirement needs a bounded prerequisite, not removal of the platform gate. Moving personal snapshots onto this Linux host also requires explicit permission; none was accessed here.

`y9b` closes disposable rehearsal only. Owner sessions and the essential-workflow checklist (`hzv`), permission to read/convert/select personal tasks, and sole-default cutover (`dvs`) remain open.

## Rehearsed flow and evidence

[The end-to-end rehearsal](../src/migration/rehearsal.test.ts) creates eight synthetic tasks, first opens them with the actual legacy CLI/cache, freezes the canonical source and makes an independent backup, then runs the friendly preview and JSON-lines migration in fresh CLI processes. It independently checks every converted field against literal expectations, not another call to the converter:

- Exact IDs, all five statuses and priorities, Unicode/literal spacing/protected code, CRLF Markdown and an empty description.
- Title-only classification, lowercase category/tags, tag deduplication, and description markers left untouched.
- Exact parent/dependency membership and all sibling sequences, including inactive tasks under a canceled parent, a grandchild and an empty leaf scope. Root order deliberately differs from filename order.
- Lossless explicit-offset/UTC timestamp instants, retained legacy update time and matching terminal closure.
- No legacy descriptor/sync/order fields in output. Frozen source, independent backup and old cache remain byte-identical.
- Preview produces no destination or receipt. Completion retains exact raw source bytes in its recovery archive, never changes selection, and original-envelope restart/replay returns the same result.
- Fresh target opens `ready` under a different context, with zero imported receipts/history/undo claims; old control authority refuses without changing output. The original source/control selection remains intact.

The existing [source observation](../src/migration/schema1SourceFaults.test.ts), [conversion](../src/migration/conversion.test.ts), [publication](../src/migration/writer.test.ts), [interruption/recovery](../src/migration/recovery.test.ts) and [friendly CLI](../src/backend/friendlyCli.test.ts) tests are retained and rerun, not replaced by the new happy-path rehearsal. They exercise real subprocess kills at fixed intent, backup, every file prefix, verification/reservation/publication, SQLite commit and retirement; original-owner resume; source/stage/evidence divergence refusals; fresh-authority selection; and explicit return to preserved v1 with later v2 edits kept separately.

Focused run: **221 passed, zero skips/failures**. Full regression: **1,666 passed, two known skips, zero failures** (1,668 total). Types/lint pass. Corpus remains 101/112; these are additional integrated checks, not new corpus cases. The runbook was executed through both source CLI and bundled `dist/sidecar/cli.cjs`: byte-identical source/backup, exact committed target golden, successful fresh selection and exact original-envelope replay. Logs: `/tmp/tasks-y9b-{focused,full,check,lint,rehearsal,runbook,bundle-rehearsal}.log`.

**Setup failure, not hidden acceptance:** the first synthetic variant added outgoing dependencies to the canceled root above the nested chain. The legacy CLI's fresh-cache import refused `INVALID_CANONICAL` despite an acyclic inventory. Inspection found its shrinking `pendingTasks.length` loop can stop before the remaining import round. The accepted fixture leaves that root dependency-free while retaining cross-task/multiple dependencies elsewhere. No legacy importer repair or broader legacy-cache acceptance is claimed. Migration reads canonical files, not that cache. A separate test-only source-transform scene reinstated the original outgoing dependencies and confirmed the full eight-task conversion/replay/fresh-authority flow still passes despite the legacy rebuild refusal (`/tmp/tasks-y9b-legacy-dag-variant.{mjs,log}`). That supplemental scene changes only the test module, not production, and is not added to the 221-test suite count. No converter or personal-conversion blocker was found; the legacy importer repair is outside this replacement task's scope. The first runbook smoke also exposed pretty-printed `jq` preview output being read as multiple invalid JSON-lines requests. The runbook now uses `jq -c` and checks the preview response before conversion; both CLI variants were rerun.

## Actual refusals and recovery

Do not repair records by guessing. The strict source reader refuses missing/incomplete sibling orders, unknown members or entries, malformed/duplicate-member JSON, stale hashes, unresolved conflict copies, unsafe/aliased IDs, missing or cyclic relationships, metadata-only/multi-category titles and inconsistent closure. Unknown `-00:00`, local/invalid calendar times, leap seconds and nonzero sub-millisecond precision refuse rather than round. Diagnostics name the affected path/field. Resolve any source issue separately, then freeze/back up again.

A nonempty destination refuses `DESTINATION_NOT_EMPTY`; overlap refuses `INVALID_ARGUMENT`. Use an **absent** destination with an existing parent. Do not overwrite or repurpose a failed destination/stage.

After interruption, query `workspace.info` through the **original v1 root, control cache and profile**. `recovery_pending` and its operation ID identify unfinished work; published target queries are blocked until reservation retirement. Preserve the original full envelope. A receipt-backed exact retry can acknowledge a completed operation; otherwise `RECOVERY_PENDING` is not permission to allocate another migration. Explicit `workspace.recovery.resume` needs the pending operation ID, current original-owner context and its own stable key. Resume accepts only unchanged recorded source/bindings/evidence and fixed output. Recheck completion before selecting the target.

Changed/missing source, stage, archive, progress or publication bindings refuse `MIGRATION_CONFLICT`/`RECOVERY_CONFLICT` and preserve evidence. Unbound stages or unpublished `.preparing` backups need inspection, not automatic repair. Keep all roots/cache/profile/evidence; do not delete the cache or switch profiles to bypass pending state. Never select or share a private `.stage` folder.

## Short one-user runbook

**Disposable example only.** Personal use needs separate owner approval and a supported host. The control lock cannot pause legacy writers, Syncthing or arbitrary editors.

1. **Back up and pause.** Stop all writers/sharing. Freeze one complete canonical snapshot (descriptor, `tasks/`, `order/`) and retain an independently verified backup outside it. Keep optional old cache/settings separately; they are not conversion inputs. This synthetic example never reads the personal default:

   ```bash
   pnpm build:backend
   umask 077
   scratch=$(mktemp -d)
   cp -R scripts/fixtures/schema1/sync "$scratch/frozen-v1"
   cp -R "$scratch/frozen-v1" "$scratch/independent-backup"
   export XDG_DATA_HOME="$scratch/profile"
   migrate() {
     node dist/backend/cli.js --stdio \
       --root "$scratch/frozen-v1" --database "$scratch/control.db"
   }
   ```

2. **Preview, then convert separately.** Keep the original executing envelope privately before dispatch; do not generate a new key/context after an uncertain reply.

   ```bash
   context=$(printf '%s\n' '{"version":2,"command":"workspace.info"}' | migrate | jq -er '.writeContext')
   jq -nc --arg ctx "$context" --arg dest "$scratch/converted" \
     '{version:2,command:"workspace.migrate",writeContext:$ctx,idempotencyKey:"snapshot-once",args:{destinationDirectory:$dest}}' \
     > "$scratch/original-request.json"
   jq -c 'del(.idempotencyKey) + {dryRun:true}' "$scratch/original-request.json" | migrate > "$scratch/preview.json"
   jq -e '.ok == true and .result.dryRun == true and .result.taskCount == 4' "$scratch/preview.json"
   migrate < "$scratch/original-request.json" > "$scratch/completion.json"
   jq -e '.ok == true and .result.selectionChanged == false and .result.taskCount == 4' "$scratch/completion.json"
   ```

   **Stop unless that completion check succeeds.** Inspect `recoveryLocation`, preserve it and the original cache/profile. For an interrupted attempt, use the recovery procedure above rather than rerunning with new authority.

3. **Inspect.** Verify source/backup unchanged and every mapped task/edge/full order, not only the visible Active list. The committed synthetic example should match `scripts/fixtures/workspace/root` exactly. Open only the completed target with a fresh cache:

   ```bash
   printf '%s\n' '{"version":2,"command":"workspace.info"}' \
     '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
     node dist/backend/cli.js --stdio \
       --root "$scratch/converted" --database "$scratch/fresh-target.db"
   ```

4. **Explicitly switch only after review.** Conversion never changes app selection or sharing. A real native/client switch remains gated on owner review, essentials and supported capability evidence; the commands above inspect only this scratch folder.
5. **Keep both roots.** Returning to the preserved v1 snapshot restores pre-conversion state and loses access to later v2 edits in that client. Retain those edits in the separate v2 root. There is no reverse conversion, dual writing or automatic rollback. Do not resume sharing until the chosen supported client/root is explicitly agreed.
