# Refactor inventory and reset

**Reviewed: 2026-10-04. Current baseline: `905c65a`.** Current direction and execution gates are in [PLAN.md](../PLAN.md). This document is an audit record, not another work queue or normative contract. The owner's subsequent clean-cut decision below supersedes the original reset's coexistence and legacy-native assumptions.

## Assessment

Keep the core direction, but stop feature expansion while proving a smaller understandable, usable slice. The work is not an incoherent framework rewrite or simply untested AI output. It contains useful domain separation, explicit data compatibility, strict canonical validation and real crash/replay tests. Its main drift is delivery order: a broad Linux storage/recovery backend developed before the everyday native app and platform boundaries were regularly exercised.

At `bdc7dad`, the previous 30 commits added 21,378 lines and removed 68, including fixtures, tests and documentation. V2 production backend modules totaled about 5,000 lines across 49 files. Existing `App.tsx`, `TaskList.tsx`, Android engines and native code were essentially unchanged. The result was mostly a parallel successor, not simplification of the existing application.

| Original goal | Finding |
| --- | --- |
| Tight API/model/services | Model and effect functions are clearer, but `v2Protocol.ts` still describes command/args/results with strings and generic records. Writer orchestration is repetitive and some recovery code is difficult to read. |
| Backend separated from clients | Node CLI and browser share the gateway and rules. A provider-neutral application/storage boundary and actual v2 native/Android use remain unproven. |
| Spec-driven decisions and behavior | Strong explicit contracts/fixtures and evidence limits. Historical milestone narration makes current support and next work unnecessarily hard to find. |

## Latest commit: keep it, but stop the pattern

`905c65a` adds browser single-task parent selection/removal, not new backend relationship semantics. It reuses `task.move`, full prospective-graph/sibling checks and the existing immutable prepared-request path. `V2ParentChoice.tsx` has a concrete responsibility; cancelling synthetic/autofill select changes protects against unrequested parent removal. Literal paged candidate queries remain bound to the original context. No new dependency, canonical schema, receipt ledger or native permission was introduced.

The client also extracts the now-repeated prepared-envelope construction into one small method. That is a reasonable concrete consolidation, not a general command framework.

The costs are another experimental editor mode and surface, exact command-handshake maintenance, more technical UI copy and further deferred native proof. Parent search still calls the existing full-root query/cache path and inherits its performance problem. The commit does not address quadratic fingerprints, weak public command types, recovery readability or native acceptance. No new correctness defect was identified by this bounded review, but it was not an exhaustive correctness/security audit.

**Decision:** retain the commit and its tests. Treat it as the final browser feature addition before the reset checkpoints, not evidence that the old implementation sequence should continue.

## Confirmed defect and architectural risks

### Quadratic authority fingerprints

`src/backend/v2QueryCache.ts:74–83` serializes a task's exact-byte hash plus its complete sibling-ID sequence for every task. A flat scope repeats the same N-ID sequence N times. Subsequent authority observations read/store those long values; unchanged info queries still scan the root and synchronize local authority. `V2ReaderView.tsx` polls info every two seconds.

Disposable WSL2 / Node v22.22.3 probes at `bdc7dad` produced:

| Flat root tasks | SQLite cache | Warm unchanged info calls |
| --- | --- | --- |
| 1,000 | 15.7 MiB | 105–160 ms |
| 5,000 | 361.5 MiB | 1,688–2,034 ms |

The 5,000-row cache held 375,350,000 fingerprint characters. The repeated sibling representation, not just filesystem scanning, is a concrete avoidable cost. These are local diagnostic measurements, not performance acceptance or portable thresholds. The parent commit did not change the fingerprint implementation.

Fix the representation with a once-per-scope fixed-size signature while preserving all current invalidation/replay semantics. Existing-cache compatibility needs explicit tests; a fresh-cache-only benchmark is insufficient.

### Boundaries and readability

- `src/backend/v2Protocol.ts:5–19`: runtime validation is strong, but generic string/record types do not enforce command-to-input/result relationships inside clients/application calls.
- `src/backend/v2Gateway.ts`: growing nested dispatch, with broadly advertised Linux capabilities rather than a proven native client profile.
- `src/backend/v2DoctorJournal.ts`: compressed multi-statement conditions conceal important staged-inode, publication and cleanup state transitions. Small file line counts are not proof of simplicity.
- Many writers repeat context/receipt/pending/observation/commit plumbing. Some repetition can be reduced, but different publication/deletion guarantees must stay explicit.
- Crash tests such as `v2UpdateRecovery.test.ts` transform generated runtime source at exact strings. They provide real process evidence but make readability changes require careful fault-harness maintenance.
- `src/backend/v2CopyStage.ts` has a separate stage-only implementation with tests, while public archive/restore use their own journal path. It is a deletion candidate after caller/need review, not an automatic safety-code removal.

### Product behavior

The experimental editor requires preview/apply even for normal status changes, displays authority/protocol terminology, and locks after every executing error. A definite stale-version refusal uses the same externally reconciled request flow as an uncertain lost reply. Browser retry state is memory-only. These constraints are documented and tested; tests do not establish that the workflow is pleasant or complete for daily use.

The reset asks for native use evidence and an explicit review of these interactions. It does not silently loosen the accepted retry/recovery contract or require another generic UI rewrite.

## Validation performed for this reset

At `905c65a`:

- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 1,591 passed, zero failed, two skipped (1,593 total).
- `node scripts/check-v2-editor-ui.mjs`: Chromium keyboard/mouse/content/status/undo/parent scenes, explicit recovery, fixed retries, focus, responsive checks and dialog axe audits passed.
- Skips: optional isolated Syncthing transport; original capability-refusal case specifically requiring withheld doctor apply, which the Linux profile now supports.

The recorded original-case coverage in [v2 conformance](../spec/v2/conformance.md) is 101/112. This reset did not independently recount every corpus case. Regression count and original corpus count are different measures.

No native desktop, Android/provider, power-loss, independent-interoperability or personal-data acceptance was performed. Test roots were disposable. No application code was changed by the planning reset.

## Initial queue reconciliation (before the clean-cut decision)

Before the reset, SQ contained 26 tasks: 17 closed evidence/implementation tasks and nine open items. Two broad umbrellas (`xz2`, `m1p`) were simultaneously in progress. Their descriptions/metadata still called the committed parent slice uncommitted and directed further app mutations. `23b` still described a 24-case conformance baseline. The plan repeated long milestone reports and ended with a broad “continue client implementation” instruction.

Changes made:

- Preserve all closed evidence tasks and all still-valid native/release obligations.
- Add `fwk` (cache growth), `dh1` (native feasibility), `mg8` (basic boundary/readability) and `hzv` (owner dogfood/review).
- Narrow `m1p` to one actual native basic-loop proof, without further browser feature expansion.
- Recast `xz2` as an explicit owner next-scope decision gate after dogfooding. Remove its open-ended implementation authority, retain historical evidence and fix parent commit references.
- Hold broad Windows/Android, remaining full-profile conformance, multi-platform acceptance, rollout and public-standard tasks behind that decision. Correct `23b` to the recorded 101-case baseline.
- Keep `69t` as the separate v1 native M1 obligation, host-gated after feasibility. Do not falsely close it or require every platform before recognizing a truthful narrow pilot.
- Make `fwk` the sole currently ready default task. No implementation task was marked completed by planning or test totals.

SQ edits are in the shared `.sift/` development queue, outside Git. Portable order and gates are in PLAN.md. Historical counters/artifact paths retained in task metadata are evidence records, not current next-work instructions.

## Owner decision: one publishable codebase

After reviewing the clean-code guidance, the owner clarified that they are the only existing user. They want clean cuts toward one elegant application, not permanent `v2` code, a strangler framework or compatibility with hypothetical external installations. Their existing tasks need a verified one-time migration. This changes the destination, not today's implemented support or permission to access personal data.

The revised plan narrows `mg8` to one real `task.update` path and applies delete → simplify → rename before considering abstractions. The cache fix remains small. Private APIs may change with their actual clients/tests; no alias layer is required. Creation/replacement/deletion safety must not be hidden inside a generic writer engine.

Queue adjustments:

- `hzv` now produces an owner-reviewed keep/replace/drop checklist for the daily workflow. Missing essentials become explicit cutover prerequisites, not an automatic parity rewrite.
- `y9b` becomes a bounded disposable one-time migration rehearsal and short runbook, not a broad rollout guide blocked on all platforms/full conformance.
- New `dvs` makes the replacement model the sole default, removes the legacy runtime and unused prototypes, removes versioned production names/flags and reconciles current specs. Only minimal isolated converter support survives. Git retains the old application.
- `xz2` reviews the consolidated app and chooses any remaining publication/platform scope. It does not gate the already-approved consolidation direction or authorize unlimited target expansion.
- `69t` is closed as **superseded, not passed**. Its relevant lifecycle/restore/focus obligations move to the replacement native proof and release validation (`m1p`, `gex`); no separate legacy-only product gate remains.
- Broad platform/conformance/public-standard tasks remain held. Publishing an app does not itself require independent public-standard proof. No implementation or acceptance task is completed by this planning edit.

Format/protocol version numbers and historical fixtures/evidence can remain. Production responsibility names, default launch paths and current contracts should describe one system. A cosmetic mass rename while both engines survive would not satisfy the decision. Cache/profile binding changes must not strand pending recovery evidence.

## Retained safety decisions

Keep literal titles, explicit classification, sparse order, local receipts/history and truthful unsupported capabilities unless a deliberate contract decision changes them. Do not silently change readiness semantics such as done dependencies remaining blockers. Compatibility with old code is optional; preserving the owner's data is not. Separate-root conversion, independent backups and original-request retry safety remain required. Actual personal conversion/selection, automatic live upgrade and release claims remain unapproved; the current work uses disposable data.
