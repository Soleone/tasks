# TaskDB v2 command boundary proposal

**Status:** Reconciled working proposal, not accepted or implemented. [V1 protocol](../spec/protocol.md), [queries](../spec/queries.md), [CLI](../spec/cli.md) and [mutations](../spec/mutations.md) still govern shipped clients. This note owns input/projection/version/retry/error contracts; [model](task-model-v2.md) owns field validation, [behavior](task-behavior-v2.md) owns effects/undo, [lifecycle](collection-lifecycle-v2.md) owns root/repair/migration safety, and [ordering](syncthing-sync-ordering.md) owns key allocation.

## Version and selected-root boundary

Select **protocol 2** for the new field/projection/input contract, independently of canonical schema 2 and SQLite's internal schema version. One command session addresses one selected root. No source registry, source refs or cross-root graph/routing fields in protocol 2; the opt-in v1 controller remains separate.

| Request/root | Target behavior |
| --- | --- |
| Protocol 1 / schema-1 root | Existing v1 behavior, no forced migration |
| Protocol 2 / schema-2 root | New contract |
| Protocol 1 / schema-2 root | Refuse before writing; old binaries' current invalid-manifest refusal remains valid evidence, not v2 support |
| Protocol 2 task command / schema-1 root | `UNSUPPORTED_SCHEMA`, never implicit conversion |
| Malformed, mixed or missing manifest with records | Fail closed; not a new empty collection |

Protocol-2 `workspace.info` is also the non-mutating open/inspection boundary: report root/schema state, supported commands/capabilities, and the local write context, without initializing or migrating canonical files. It may inspect a v1 or empty root for an explicit control operation, but does not project v1 tasks as v2. Its state is `empty`, `ready`, `incomplete`, `unsupported`, or `recovery_pending`, with detected `schemaVersion` (or null), advertised supported command names, issues, and pending operation identity where relevant. Inspection can report an invalid root; task commands cannot use it as write authority. Only explicit `workspace.init` initializes an empty selected root as v2; only `workspace.migrateV1` produces a separate destination from a selected v1 source. Neither silently changes the client's selection. Lifecycle owns the allowed layout and procedure.

Unsupported protocol numbers fail `UNSUPPORTED_VERSION`; unsupported data schemas fail `UNSUPPORTED_SCHEMA`. Missing/invalid files fail `INVALID_CANONICAL`. A new API version does not change old canonical files or redefine the root v1 spec.

## Envelope and API projection

Keep JSON-lines, `requestId`, actor, success/error shape, and preview flags. Decode strict JSON, rejecting duplicate members, unpaired surrogate escapes and non-finite decoded numbers as `INVALID_REQUEST`; never let lossy decoding collapse distinct retry payloads. Every executing mutation requires a nonempty `idempotencyKey` (`IDEMPOTENCY_KEY_REQUIRED`) and local `writeContext` obtained from `workspace.info`/a fresh query. Versioned task commands retain their required expected-version arguments:

```json
{"version":2,"requestId":"edit-1","writeContext":"opaque-local-context","command":"task.update","args":{"id":"task-id","expectedVersion":17,"title":"Call @alice"},"actor":{"kind":"agent","label":"release-agent"},"idempotencyKey":"stable-edit-key"}
```

Success echoes protocol/request identity, current local context, and `result`; task projections contain canonical model fields plus integer `version` and derived `blockedByIds`. Category/tags are slug/null and slug arrays, not v1 `{slug,label}` objects. `description`, `closedAt`, and per-task `orderKey` replace their v1 projection equivalents; no simultaneous alias fields. `blockedByIds` follows the unchanged readiness rule, not a portable-export alias. Local `operationId` and workspace revision remain non-canonical.

A receipt replay is a historical result, not a fresh task read. Re-read before using its task version for another action. A failed response has a stable `code`, readable `message`, and optional structured details identifying affected IDs/operation/plan; never include task content in diagnostic logs by default. Actor rules remain human/agent/system with a nonempty label; omission keeps the legacy normalized agent/cli default. Request identity is not an idempotency key.

Reject unknown write arguments and mixed old/new field shapes instead of silently ignoring them. No `descriptionMarkdown`, `completedAt`, `canceledAt`, category objects, per-task `sync`, source refs or caller-supplied timestamps/order keys through ordinary task commands. Full canonical import/migration uses its validated artifact path, not `task.update` as an unrestricted record replacement.

## Literal fields and shorthand

**Operator decision (2026-10-01):** JSON `title` is literal. `text` is shorthand normalized by the common command path, not a second client-specific classification implementation.

```json
{"title":"Review release","category":"planning","tags":["product"]}
```

```json
{"text":"Review release @planning #product"}
```

These create the same canonical fields. `text` is mutually exclusive with `title`, `category`, and `tags`, but may be combined with description/priority/parent on create.

- Literal create defaults omitted category/tags to null/empty. Literal update preserves every omitted field. Explicit category null or tags empty clears it. Node and Android must share this partial-update rule; Android's v1 requirement to resend title+description is not carried into v2.
- `text` update replaces title/category/tags together. No tokens means null/empty classification. Removing all tokens clears classification; a token-only result with no title is invalid, not an invented task name.
- Token recognition retains the v1 ASCII boundary pattern `(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b`, with ASCII word-boundary semantics, one distinct lowercase category, and unique sorted lowercase tags. In particular, a trailing hyphen is outside the recognized token; do not broaden it accidentally while porting the parser.
- Protect triple-backtick fenced spans (through closing fence or input end) and paired single-backtick inline spans on one line, as in v1. Do not parse their contents or alter their spacing. This is the bounded existing scanner, not a promise of arbitrary Markdown syntax support.
- Outside protected code, process `\@`, `\#`, and `\\` as literal escapes. An escaped marker is ineligible as a metadata token; unknown backslash sequences stay literal. Classify the unescaped eligible text, remove only recognized metadata spans, then trim outer whitespace using the model rule. Preserve remaining internal whitespace, including gaps left by removed tokens. No general whitespace collapse or backslash stripping in canonical readers.
- The v1 migration parser does **not** gain these escapes retroactively. It uses v1 token recognition and strips only recognized spans before trimming the result, preserving remaining literal/code text. Canonical readers never parse shorthand.

A UI can round-trip a literal `@alice` title through shorthand by escaping that marker or can send literal fields directly. That is future adapter work, not a change to the current editor contract.

## CLI and artifact compatibility

Keep familiar verbs and `--description`, mapping that flag to the new `description` only on a negotiated v2 root. For v2, `add <text...>` uses shorthand; `add --title` is the literal alternative and may use explicit classification flags. `update --title` is literal, `update --text` is full shorthand replacement, and explicit `--category`/`--clear-category` plus repeated `--tag`/`--clear-tags` replace or clear classification. Reject conflicting flags and mixed input forms. V1 roots retain the current CLI/parser behavior. The v2-friendly CLI may fetch a current version/context and generate a key for an initial interactive write, but must never silently refresh them for an uncertain retry. A caller supplying its own stable key must also supply `--write-context` and, for versioned task writes, the original `--expected-version`; retry with the same prepared payload. On an uncertain initial result the CLI must preserve/report the prepared key/context/version metadata, without logging task content, rather than make a fresh request.

`--json` still prints the result or structured error; sidecar JSON-lines uses the full envelope. Legacy task exports, SQLite snapshots, canonical roots, and command payloads remain different artifacts. V2 canonical archives copy the validated canonical tree; cache backup/history is a separate local artifact. Do not relabel the existing `tasks.tasks-export` version-2 projection as canonical schema 2. No automatic reverse converter or import of an unknown export version.

## Local versions, context and receipt scope

**Selected simplified retry direction:** keep successful receipts in SQLite. The operator treats cache loss as an edge case and wants minimal synced JSON. No separate durable receipt ledger, synced operation log, or canonical repair receipts are added. A bounded pending-file journal is still needed to bridge an in-progress multi-file write; it is local recovery intent, not a retained ledger of every completed request.

- `writeContext` is an opaque, fresh local epoch bound to the selected directory/provider handle and cache lifetime, not a collection ID. It is never replicated. All executing mutations require it, including create, purge and controls that have no existing task version. Missing context fails `WRITE_CONTEXT_REQUIRED`; a context from another root/local cache or a lost cache fails `STALE_WRITE_CONTEXT` before task writes.
- Task `version` remains a positive safe integer, meaningful only with that context and task ID. Allocate fresh, non-reused local versions for changed effects and rebuilds within an epoch; do not promise consecutive increments. If the range cannot be continued safely, rotate context and invalidate old tokens, not wrap/reuse them.
- A rebuild retaining the same SQLite state can preserve receipts/context while reissuing task versions. Root selection/adoption, restore or complete cache loss starts a fresh binding/context; do not import old receipts as current write authority into another root. Ordinary process restart with the same cache/context preserves safe replay.
- Validate root/schema/context and argument shapes first, then look up the local key before current task-state checks. Same key and same decoded request payload returns the stored result even if its old task version is now stale. Same key/different command, args, actor or preview flags fails `IDEMPOTENCY_KEY_REUSED`; changing only requestId or JSON object-member order does not change payload identity. This compares request content, not merely effective resulting state. A new operation still validates fresh task tokens and current file/scope/graph guards.
- If SQLite and receipts are lost, the old context is invalid. An uncertain retry must fail rather than create another task under a silently refreshed context. The caller must inspect canonical state/recovery diagnostics and reconcile manually before making a new request/key. The API cannot reconstruct request history by matching task titles. Another device cannot replay this device's receipts either.
- Receipts are retained for the cache/context lifetime, with no silent expiry or key reuse. Explicit cache reset/history removal that removes receipts rotates context and invalidates old requests. Pending recovery must be resolved or preserved for explicit handling before such a reset.
- A successful no-op stores a receipt without new task versions, canonical writes, activity or undo effects. Failed preconditions/previews do not consume the key. Persist the exact intended IDs/keys/times in local pending intent before the first file change, so ordinary crash recovery does not generate new ones.

This avoids accidental old-token reuse without making cache-loss replay a supported guarantee. Syncthing and arbitrary-editor final-read/replace limitations remain those selected in the ordering proposal; context is not cross-device CAS.

## Pending operations and previews

Preflight validates the complete proposed effects, graph, observed scope and byte baselines before writes. Stage one immutable local intent, apply/verify guarded files, then commit local versions/activity/success receipt. A multi-file filesystem/SAF operation is not a distributed atomic transaction.

After interruption, `workspace.info` and doctor inspection report `RECOVERY_PENDING`; ordinary queries/writes must not present an unfinished operation as a completed command. `workspace.recovery.resume` explicitly resumes retained intent with the same planned IDs/bytes. Unrelated edits, deletion, new scope membership, unreadable/partial files or a different root stop it with `RECOVERY_CONFLICT`, retaining current files and recovery artifacts. Do not silently roll back or resurrect files. With a surviving cache, completion can restore the original receipt; after total cache loss, explicit recovery does not turn an old request/context into a guaranteed replay.

`dryRun`/`readOnly` never mutate canonical state, receipts, activity, undo, or pending intent and never resume an old write implicitly. Query-cache refresh is permitted; diagnostics distinguish that from a task mutation. Execution revalidates current guards after a preview. A persisted doctor plan is a specifically named local planning operation, not a secretly writing generic dry run. Dry-running that planning command does not save an applyable plan ID. Invoking apply with a retained, reviewed plan ID constitutes the caller's explicit confirmation; a UI must obtain that confirmation before making the call.

## Public operation deltas

Unchanged task commands/transitions are linked from v1; new field semantics are owned by behavior. Updates allow title/text, description, priority, category and tags only; move/dependency/status/order use their named commands, not direct record fields.

| Protocol-2 operation | Boundary |
| --- | --- |
| `workspace.init` | Explicitly initialize an empty selected root as schema 2; refuse existing task/versioned data |
| `workspace.migrateV1` | Verified selected v1 root to a new non-shared destination; preview or execute, never switch selection |
| `workspace.recovery.resume` | Resume a specific retained operation intent under verified root/byte guards, no invented replacement operation |
| `task.order.normalize` | Explicit parent scope, complete versioned sibling list in current order, preview supported; allocate `generateNKeysBetween(null, null, count)` with the pinned algorithm/digits, grouped activity/undo; no-op only if all keys already match |
| `task.purgeCanceled` | Reference-safe full canceled-set purge, no automatic unlink/reparent; lifecycle owns checks/recovery |
| `workspace.doctor.inspect` | Read-only issues/pending-state report, no semantic repair |
| `workspace.doctor.plan` | Explicit local keep-both or dangling-link repair plan, key/context required; records source fingerprints, proposed IDs/link choices and summary; no canonical changes |
| `workspace.doctor.apply` | Apply an immutable reviewed plan ID/key under nominated-device coordination and fresh guards |

Doctor initially supports keep-both versions and explicit unlink/reparent plans for reported dangling references, rather than an unrestricted JSON merge editor. Editing repaired content uses regular commands. Generic operation undo does not reverse doctor/migration/purge; use their recovery copies. Legacy receive-preparation commands and v1 conflict-resolution shapes are not silently repurposed as v2 doctor. A v2 caller gets an explicit unsupported-command/capability error rather than a lossy approximation.

Node/Android must implement the same supported domain/input rules. Each advertises unsupported storage/control/repair operations explicitly; inspect-only doctor or an unproven provider cannot claim writable parity. Provider details are implementation evidence, not alternative task rules. No external adapters or unified-source UI are added by this contract.

## Error and fixture matrix

Preserve existing task/graph/transition/undo/idempotency codes where meaning is unchanged. Selected additions are target codes, not current parser changes:

| Code/case | Required behavior |
| --- | --- |
| `INVALID_ARGUMENT`, mixed text/literal fields or legacy aliases | Reject before changes; do not select precedence |
| `MULTIPLE_CATEGORIES` | More than one distinct shorthand category, even if tags are valid |
| `UNSUPPORTED_VERSION` / `UNSUPPORTED_SCHEMA` | Distinguish protocol from data; no migration/write |
| `WRITE_CONTEXT_REQUIRED` / `STALE_WRITE_CONTEXT` | Missing/stale local binding; no automatic fresh-context retry |
| `STALE_TASK_VERSION` | Re-read/reconcile; do not change key and blindly retry |
| `STALE_FILE` / `STALE_SCOPE` | Changed exact bytes or sibling/graph membership; refresh, no preflight partial writes |
| `ORDER_KEY_LIMIT` | Allocation exceeds cap; explicit normalization or refusal, not truncation or hidden global rewrite |
| `PURGE_REFERENCED` | Report survivor/reference IDs and actions needed, no partial purge |
| `AMBIGUOUS_LINK` | Repair lacks a choice for observed ambiguous reference, no apply |
| `STALE_REPAIR_PLAN` | Source bytes, links or scope changed since plan; no automatic new clone ID |
| `RECOVERY_PENDING` / `RECOVERY_CONFLICT` | Distinguish retained incomplete work from successful/failed-before-write outcomes |
| `UNSUPPORTED_COMMAND` | Known target operation unavailable on this platform; unknown names remain `UNKNOWN_COMMAND` |

Target cases must include literal `@alice`, omitted-field preservation, shorthand clearing/escapes/code/trailing hyphens, duplicate tags, old-shape refusal, ordinary same-key replay, changed-key payload, lost cache/old context, root switching, no-op receipts, graph-cycle undo, selected-key-unchanged moves, normalization, referenced purge, interrupted multi-file progress and doctor plan replay. These examples and decisions must become `spec/v2/` fixtures before implementing any of these operations.
