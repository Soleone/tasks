# V2 protocol, queries and CLI

**Status: accepted target; bounded implementation.** [Current support](../../docs/support.md). [Overview](overview.md). Model owns values; mutations owns effects; storage/migration owns recovery. Only one selected root, no source registry/ref routing.

## Envelope

One strict JSON object per line. Reject duplicate members, unpaired surrogates, non-finite decoded numbers, unknown envelope keys or malformed types with `INVALID_REQUEST`. Version must be 2 (`UNSUPPORTED_VERSION` otherwise). Allowed fields: version, optional string/null requestId, command, object args (default empty), actor, idempotencyKey, writeContext, readOnly, dryRun. Actor defaults to agent/cli; explicit kind is human/agent/system and label a nonempty string. Boolean flags default false. RequestId correlates, not deduplicates.

```json
{"version":2,"requestId":"edit-1","writeContext":"ctx-A","command":"task.update","args":{"id":"a","expectedVersion":17,"title":"Call @alice"},"actor":{"kind":"agent","label":"release-agent"},"idempotencyKey":"edit-key"}
```

Success: `{version:2,requestId,ok:true,writeContext,result}`. Failure: `{version:2,requestId,ok:false,error:{code,message,details?}}`; undecodable correlation is null. Context is an opaque local token, never a canonical field or access credential. Task projections are exactly model fields plus positive-safe-integer `version` and derived sorted `blockedByIds`; no v1 aliases/label objects. Results may include the command-specific diagnostics listed below. Messages are readable, but callers branch on codes; default diagnostic logs MUST NOT expose task text.

Mutation commands, including previews, need current writeContext to bind local optimistic tokens. Executing mutations additionally require a nonempty idempotencyKey (`IDEMPOTENCY_REQUIRED`, retaining v1 spelling). Existing-task commands require positive safe expectedVersion (`EXPECTED_VERSION_REQUIRED`). Batch items carry their own versions. Preview requires no key; if a key is supplied, any existing receipt must match the full request identity before continuing. Flags differing from an executed receipt yield `IDEMPOTENCY_KEY_REUSED`, not replayed execution as preview.

## Inputs

Create requires exactly one title or text. Literal create defaults category null/tags empty. Literal partial update preserves omissions; category null and tags empty explicitly clear. Text is exclusive with title/category/tags and replaces all three on update, including clearing classification when no tokens remain. Mixed shapes, old aliases and unknown write args fail `INVALID_ARGUMENT`. Normalize before deciding no-op, not before comparing retry payload identity.

Shorthand scanner:

1. Protect triple-backtick spans through matching close or end, then paired single-backtick spans on one line. Preserve code contents/spacing; no arbitrary Markdown promise.
2. Outside protected code, scan left-to-right: `\@`, `\#`, `\\` decode to literals; decoded escaped markers cannot classify. Unknown escapes remain literal. Boundaries are evaluated on decoded text, with escaped-marker eligibility retained.
3. Match `(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b` with ASCII word boundaries and normal greedy matching/backtracking. Lowercase category/tags, reject more than one distinct category with `MULTIPLE_CATEGORIES`, deduplicate/sort tags. A trailing hyphen lies outside the token.
4. Remove only marker/name spans, preserving preceding boundary characters and all remaining internal whitespace. Outer-trim by model. Empty resulting title is `INVALID_ARGUMENT`. Descriptions never classify.

Thus `Review @Work #TODO` becomes title `Review`, category work/tags todo; `Review @work now` retains **two** interior spaces. Literal `Call @alice` stays unclassified; shorthand `Call \@alice` does likewise after unescaping. Migration uses v1 recognition WITHOUT the new escape step.

## Authority

Write context binds the selected physical root/provider and local cache epoch. Root selection/adoption, restore, complete cache/receipt loss or unsafe version-range exhaustion creates a fresh context, never reused authority. Another local cache/device cannot replay this cache's keys. Cooperating processes sharing its cache may share context. Same-cache restart preserves it; same-cache rebuild may preserve context/receipts while reissuing non-reused local versions. Task tokens are context+ID+version, not replicated counters or timestamps.

Check decoded envelope/command, root descriptor/binding/schema, context and argument shapes first. Then look up a supplied key BEFORE live task existence/version/graph/scope preconditions. Match decoded command, original args, normalized actor/flags, protocol/context; ignore requestId and object-member ordering, NOT array order/input spelling/effective state. Same identity returns the exact historical result; differing identity fails `IDEMPOTENCY_KEY_REUSED`. Replayed task tokens may be stale: re-read before another mutation.

Absent receipt proceeds through pending-state, full observation and domain guards. No-op stores a success receipt without task effects. Failed preconditions/previews do not consume keys. Receipts remain in SQLite for the context lifetime; explicit deletion/pruning that loses them rotates context. No silent expiry, synced ledger or permanent independent receipt store. Lost cache means old requests fail `STALE_WRITE_CONTEXT`, including create; callers MUST NOT silently refresh context/key/version and retry an uncertain intent. Inspect canonical/recovery state and reconcile manually. Do not infer identity from a matching title. Retained pending intent can be explicitly recovered but cannot guarantee old-context replay after total cache loss.

The [bounded Linux capture/status commands](conformance.md#recoverable-capture-and-status) now execute the original input/context/receipt vectors. Preview creation IDs/times/versions are hypothetical, not reserved authority; uncertain executing retries retain the original context/key/payload/version. Missing publication evidence is not permission to allocate a new identity or resurrect a task.

The [bounded Linux relationship commands](conformance.md#guarded-parent-and-dependency-edits) implement the declared `task.move` and dependency add/remove shapes with current selected-task versions, exact request replay and non-consuming previews. Complete graph/scope/byte guards precede effects; existing canceled references may be unchanged or removed, while new choices refuse canceled targets. Dependency arrays and parent/key/time fields still cannot be set through `task.update`.

The [bounded Linux ordering commands](conformance.md#recoverable-ordering-and-normalization) implement the declared `task.reorder` and `task.order.normalize` versioned-list shapes, non-consuming previews and exact historical replay. Lists/placement remain part of original retry identity; receipt replay precedes live scope/version checks. Meaningful ordering returns selected/scope projections and actual `rewrittenIds`, including fresh selected tokens even for unchanged bytes. Grouped history is local; the later [guarded undo slice](conformance.md#guarded-status-and-grouped-undo) supplies eligible inverses.

The [bounded Linux undo/status-batch commands](conformance.md#guarded-status-and-grouped-undo) implement the declared status undo/undoMany/transitionMany and operation-ID inverse shapes. Batch versions and array order remain retry identity; historical replay precedes live eligibility. Creation inverse additionally reports `removedIds` and `recoveryLocation` for independently retained raw originals, not another selectable root. Unsafe history/scope/graph refuses without effects; redo/undo-of-undo and destructive control reversal remain unavailable.

The [bounded Linux purge command](conformance.md#verified-canceled-task-purge) implements empty public args with current context/key, non-consuming previews and historical receipt precedence. A meaningful result also identifies its grouped local `operationId`; `recoveryLocation` points to verified independent raw recovery data, not another root or receipt ledger. `PURGE_REFERENCED` includes `details.references` with exact survivor/target/field triples. Previews do not reserve the canceled set. Unknown subset/filter/force args refuse rather than approximate this destructive command.

The [bounded Linux lifecycle controls](conformance.md#explicit-initialization-and-retained-cache-rebuild) implement retained same-cache rebuild: context/receipts/history survive and task versions are reissued. `preserveSQLite` in the fixture is a test-adapter event, not a public argument. Complete cache loss still refuses original authority; rebuild does not bypass pending work or import an old database.

## Commands

Listed args are the allowed write shapes; inherited read filters are defined below. Context/key are envelope fields, not args. IDs/version items are unique; task commands cannot set status/graph/keys/timestamps directly via update.

| Command | Args | Result core |
| --- | --- | --- |
| task.create | title or text; optional description, priority, category, tags, parentId | task, changed; operationId for changed task operation |
| task.update | id, expectedVersion; optional title/text, description, priority, category, tags | task, changed, optional operationId |
| task.start/pause/complete/reopen/cancel/delete/status.undo | id, expectedVersion | task, changed, optional operationId |
| task.move | id, expectedVersion, parentId | task, changed, optional operationId |
| task.dependency.add/remove | id, expectedVersion, dependsOnId | task, changed, optional operationId |
| task.reorder | tasks:[{id,expectedVersion}], placement | selected tasks, parentId, changed, rewrittenIds, optional operationId |
| task.order.normalize | parentId, complete tasks:[{id,expectedVersion}] in scope order | scope tasks, parentId, changed, rewrittenIds, optional operationId |
| task.transitionMany | tasks:[{id,expectedVersion,command}] with allowed status command names | tasks, changed, optional operationId |
| task.status.undoMany | tasks:[{id,expectedVersion}] | tasks, changed, optional operationId |
| operation.undo | operationId | affected tasks, changed, optional new operationId; creation removal adds removedIds, recoveryLocation |
| task.purgeCanceled | none | purgedIds, changed, recoveryLocation if nonempty |
| task.get | id | task |
| task.list | query filters | tasks, optional contextTasks, total, limit, offset, workspaceRevision |
| category.list/tag.list | none | categories/tags:[{slug,taskCount}], no label; non-canceled counts |
| activity.list | optional taskId, limit | activity:[{operationId,taskId,actor,createdAt,command,before,after}] |
| workspace.info | none | state, schemaVersion or null, commands, issues, pendingOperationId or null, workspaceRevision |
| workspace.init | none | schemaVersion, changed |
| workspace.rebuild | none | taskCount, changed, workspaceRevision; local rebuild only |
| workspace.archive | destinationDirectory | destinationDirectory, taskCount, changed; verified canonical copy incl. known conflict originals, no cache |
| workspace.restore | sourceDirectory, destinationDirectory | destinationDirectory, taskCount, changed; valid schema-2 archive to new root, no selection switch |
| workspace.migrateV1 | destinationDirectory | completion report under migration; incomplete stage never usable |
| workspace.recovery.resume | operationId | operationId, outcome (`complete` or error), original result if reconstructable |
| workspace.doctor.inspect | none | issues, versionRefs, incomingLinks, pendingOperationId |
| workspace.doctor.plan | kind and choices below | planId, clones, linkEdits, removedConflictPaths, recoveryLocation, changed |
| workspace.doctor.apply | planId | planId, repairedIds, removedConflictPaths, recoveryLocation, changed |

Directory arguments identify a caller-authorized destination/provider handle, not routing to another task source. [Storage](storage.md#archives) owns archive/restore content, disjoint/empty destinations, guarded stage completion and unchanged source; [migration](migration.md#stage) owns v1 conversion. No legacy SQLite snapshot import or old-authority adoption is implicit. Advanced controls need not have friendly CLI verbs; JSON-lines is the public boundary.

Doctor plan `kind:"keep-both"` takes unique issueIds, canonicalVersions:[{issueId,versionRef}], linkChoices:[{record:{taskId} or {versionRef},field:"parentId" or "dependencyIds",fromId,targetVersionRef}]. VersionRefs come from inspect, not arbitrary file paths. Plan allocates IDs and maps references; every reported incoming link needs a choice. `kind:"repair-links"` instead takes edits:[{taskId,parentId}] or [{taskId,removeDependencyIds}], limited to reported dangling links. An edit may specify both fields. No content overrides/merge editor. Apply of retained planId is explicit confirmation; missing/stale IDs yield `STALE_REPAIR_PLAN`. Storage owns semantic checks/copy disposition.

The bounded Linux doctor subset advertises `workspace.doctor.inspect`, `workspace.doctor.plan` and [confirmed `workspace.doctor.apply`](conformance.md#guarded-doctor-application-and-recovery). Other platforms continue withholding those capabilities. Inspection needs no write context/key and reports raw candidate refs/issues/incoming links even during pending work, without importing a partial task projection. Planning uses the declared nonempty choice/edit shapes with current context/key and historical receipt precedence. It retains fixed local plans, not canonical effects; results also identify chosen canonical versions and report `applyAvailable:true`/`recoveryReady:false`. The future recovery path is not an existing archive. Previews consume no plan/receipt and return hypothetical IDs; fresh planning refuses pending work. Apply requires exactly retained `planId` with current context/key, rejects consumed/lost/stale plans before effects and previews without execution evidence. Its meaningful result additionally supplies `operationId` and `recoveryReady:true` for the independently verified raw recovery file. Original-request receipt replay precedes pending/live/plan/archive checks; it is historical, not renewed file authority. Published-intent recovery retains fixed IDs/time/actor, accepts only bound publication/cleanup evidence and requires the original cache location. Retained local split history adds `unreviewedIncomingLinks` diagnostics to inspection without inferred redirects. Planning receipt replay keeps its original result, even after application; its old `recoveryReady:false` is historical. Apply-dependent original doctor cases now execute separately from planning evidence. The fixture `capability-refusal` specifically requires withheld doctor apply, so it is skipped on the newly writable Linux profile rather than replacing its command; no native unsupported-platform execution is claimed here.

Info state is empty/ready/incomplete/unsupported/recovery_pending. It may inspect v1/invalid roots for controls, not project their tasks as v2. Commands lists supported command names in ASCII order; known unavailable operations (including legacy registry/receive/conflict/snapshot shapes) fail `UNSUPPORTED_COMMAND`, unknown names `UNKNOWN_COMMAND`. No unsupported write silently approximates another action. Info/doctor inspection stay available during pending work; fresh ordinary operations fail `RECOVERY_PENDING`. A completed receipt replay is historical, not a presentation of pending work as complete.

## Queries and CLI

Keep [v1 single-root filters/paging](../queries.md#tasklist-filters): status OR, tags AND, priority, category/null, title+description ASCII-insensitive substring search, unblocked, ancestors, created/updated/priority/manual sorts. No classification objects/sourceKeys/refs. Slug filters normalize ASCII case and optional matching marker, then validate grammar; no title parsing. Search trims/caps at 200 UTF-16 units at a complete Unicode scalar boundary. Limit defaults 50, clamps 1–100; offset clamps nonnegative. Invalid types/directions fail INVALID_ARGUMENT. Priority defaults ascending/P0; dates descending. Ties are exact ID bytes; manual uses full-tree preorder with ordered sibling scopes, filters do not detach ancestry. Ancestor context does not count in total; null category is not the slug uncategorized. Canceled-only classification entries are omitted. Manual direction cannot reverse tree order.

Friendly CLI preserves [v1 verbs](../cli.md) where negotiated: add positional text is shorthand, add --title is literal; update --title literal or --text replacement; --description maps description. --category/--clear-category and repeated --tag/--clear-tags replace/clear explicit classification; reject conflicting/mixed forms. --source-key/sources are unavailable in v2. New --write-context binds supplied keys. Interactive initial calls may fetch authority/generate key; supplied stable key requires original context and expected versions. Never silently re-read authority for uncertain retries. Preserve/report prepared retry metadata without task text. --json prints result/error, JSON-lines full envelope. Existing exit 3 for stale task version remains; other protocol failures exit nonzero. V1 roots/clients retain their old contracts. UI adapters remain separate work.

The bounded Node [friendly implementation](conformance.md#explicit-opt-in-human-cli) selects v2 only with an actual `--v2-root PATH` option and explicit `--database CACHE_OUTSIDE_ROOT`; flag-valued content and words after `--` do not switch a v1 invocation. It branches before v1 environment/default database/registry/watchers. Initial new operations negotiate info and may get a task version; supplied keys require retained context/version before **any** backend query, then dispatch the original request directly so historical receipts precede pending/live checks. There is no automatic retry/recovery/selection switch. It exposes task/query/status/undo/link/purge verbs plus `init`, `rebuild`, `archive DESTINATION`, `restore SOURCE DESTINATION`, `migrate-v1 DESTINATION`, and `recover OPERATION_ID`. Ordering, status batches and doctor stay JSON-lines controls. Native writable capabilities remain withheld.

Before executing, stderr completes one synchronous task-payload-free retry report: command, selected absolute root/cache/profile paths, context/key, existing-task version, actor, preview flags and `requestHash`. That hash is **client metadata**, combining protocol request identity with lexical selected root/cache/profile paths, not a new envelope/canonical field or success ledger. Optional `--request-hash HASH` rejects changed prepared identity/selection before dispatch. Directory arguments become absolute before hashing; retain the original arguments/working directory. It does not prove physical-profile continuity or filesystem sandboxing. Preserve the exact payload yourself; stdout/terminal loss or lost private evidence still needs the retained context and manual inspection. `info --json` additionally exposes transport `writeContext`; other successful JSON output is the command result. Errors go to stderr as `{ok:false,error}` with exits 1 for protocol/storage, 2 for CLI usage and 3 for stale task version. A stale error never authorizes refreshing an uncertain operation. [README walkthrough](../../README.md#opt-in-v2-human-cli).

## Error codes

| Code | Meaning |
| --- | --- |
| INVALID_REQUEST | Envelope/strict JSON failure |
| UNSUPPORTED_VERSION / UNSUPPORTED_SCHEMA | Command/data version refusal |
| UNKNOWN_COMMAND / UNSUPPORTED_COMMAND | Unknown or known unavailable operation |
| INVALID_ARGUMENT / MULTIPLE_CATEGORIES | Invalid or mixed input / competing categories |
| TASK_NOT_FOUND / INVALID_PARENT / INVALID_DEPENDENCY | Missing/invalid task or relationship choice |
| PARENT_CYCLE / DEPENDENCY_CYCLE / INVALID_TRANSITION | Forbidden graph/status change |
| EXPECTED_VERSION_REQUIRED / STALE_TASK_VERSION | Missing/old task token |
| IDEMPOTENCY_REQUIRED / IDEMPOTENCY_KEY_REUSED | Missing execution key / different request identity |
| WRITE_CONTEXT_REQUIRED / STALE_WRITE_CONTEXT | Missing/old root/cache authority |
| INVALID_CANONICAL / INVALID_STORAGE | Invalid files/graph / storage failure |
| STALE_FILE / STALE_SCOPE / ORDER_KEY_LIMIT | Byte/member guards / generated key overflow |
| PURGE_REFERENCED | Surviving references prevent the whole purge |
| UNDO_UNAVAILABLE / OPERATION_UNAVAILABLE | Ineligible status/group history |
| AMBIGUOUS_LINK / STALE_REPAIR_PLAN | Incomplete link choices / changed or lost plan |
| RECOVERY_PENDING / RECOVERY_CONFLICT | Retained unfinished intent / unsafe replay |
| MIGRATION_INVALID_SOURCE / MIGRATION_CONFLICT / DESTINATION_NOT_EMPTY | Invalid source / changed conversion guard / occupied output |

## Rationale

Cache-local receipts keep synced JSON minimal without a separate completed-operation ledger. Cache loss is an accepted edge case requiring fresh authority and manual reconciliation, not a supported old-request replay guarantee. Context protects local token identity; it is not cross-device compare-and-swap or distributed exactly-once authority.

Normative cases: `literal-create`, `literal-update`, `classification-clear`, `text-replace`, `text-mixed`, `text-empty`, `text-escape`, `text-code`, `text-boundary`, `text-gaps`, `text-multiple`, `tags-normalize`, `old-alias`, `protocol-version`, `protocol-schema`, `protocol-duplicate`, `protocol-nonfinite`, `context-required`, `context-loss`, `context-root-switch`, `receipt-replay`, `receipt-changed`, `receipt-actor`, `receipt-rebuild`, `noop-receipt`, `capability-refusal`, `query-literal`, `query-readiness`, `cli-literal`, `cli-text`, `cli-key-context`, `archive-restore`, `restore-cache-authority`, `destination-overlap`.
