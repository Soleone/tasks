# V2 ordering

**Status: accepted target; bounded implementation.** [Current support](../../docs/support.md). [Overview](overview.md). This page owns interoperable keys/placement, not cache authority or distributed transactions.

## Keys

Pin CC0 [fractional-indexing 3.2.0](https://registry.npmjs.org/fractional-indexing/-/fractional-indexing-3.2.0.tgz), default digits `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`. Implementations MUST reproduce `generateKeyBetween` and `generateNKeysBetween` for these defaults; a newer algorithm cannot silently change bytes.

A key has A–Z/a–z head and only base-62 digits afterward. Integer part length including head is `90 - headCode + 2` for uppercase, `headCode - 97 + 2` for lowercase. Reject insufficient integer length, bare `A` plus 26 zeros (reserved smallest integer), any fractional suffix ending `0`, non-ASCII/digit characters, and keys over **256 bytes**. Integer keys such as `a0` may end in zero. Invalid persisted keys fail `INVALID_CANONICAL`; excessive generated allocation fails `ORDER_KEY_LIMIT` before any writes.

Compare valid key ASCII bytes ascending (shorter prefix first), then exact task-ID bytes ascending. No locale collation, floating-point midpoint, case folding, jitter, ID suffix or implicit normalization. Sibling scope is exact parent ID or null, including hidden/canceled tasks. Equal keys remain legal until an explicit command needs a gap inside the tie.

| Lower | Upper | Count | Expected keys |
| --- | --- | --- | --- |
| null | null | 1 | `["a0"]` |
| null | a0 | 1 | `["Zz"]` |
| a0 | null | 1 | `["a1"]` |
| a0 | a1 | 1 | `["a0V"]` |
| a0 | a1 | 2 | `["a0G","a0V"]` |
| null | null | 3 | `["a0","a1","a2"]` |

## Placement

`task.reorder` selects unique versioned IDs in their current sibling order and exactly one `placement` (`beforeId`, `afterId`, `first:true`, `last:true`). All selected and anchor IDs MUST belong to one scope; an anchor cannot be selected. Wrong selected order/mixed membership/invalid placement fails `INVALID_ARGUMENT`. Resolve placement after removing the selected group from the complete observed sequence.

1. If final IDs equal original IDs, return a no-op, even with ties.
2. With distinct neighboring keys, or an end gap, allocate only selected keys between those bounds.
3. Inside an equal-key gap, expand to the maximal remaining tied run. Insert the selected group at the requested index, preserving selected order and remaining ID-tie order. Allocate this combined run between nearest outside neighbors. Write only keys that differ; outside neighbors guard the scope but MUST NOT be rewritten.
4. Preserve every non-order canonical field. Refuse cap overflow without truncation or moving to a different gap. Use the complete scope/byte journal guards in storage; a filtered UI list is not a scope snapshot.

Normative vector: `lower:a0, a:a1, b:a1(canceled), upper:a2, move:a3, tail:a4`; moving `move` before `b` yields `lower,a,move,b,upper,tail`, writes `a:a0V, move:a1, b:a1V` only. With `a:a0,b:a0,move:a1`, moving `move` before `b` writes only `b:a2`; **move's key stays a1 but its logical position changes**. Mutations MUST still advance its local version and group activity/undo.

Capture/new-parent move prepends through key allocation, never through a shared order file. Independent captures may choose the same key; the ID tie sorts them. Concurrent overlapping rekeys may conflict and cannot preserve both placement intentions. No automatic sync repair loop or CRDT promise.

The [bounded Linux relationship slice](conformance.md#guarded-parent-and-dependency-edits) now executes first-in-new-scope reparenting, including complete hidden/canceled/tied sibling observations and affected tokens without sibling rewrites. The later [bounded Linux ordering slice](conformance.md#recoverable-ordering-and-normalization) now implements `task.reorder`, normalization, tied-run repair and fixed multi-file recovery. Complete selected/incidental group history and conservative affected-scope token refresh are implemented; the later [guarded undo slice](conformance.md#guarded-status-and-grouped-undo) now restores eligible recorded ordering with complete scope/key postconditions and fresh logical selected tokens. Undo-of-undo/redo and native/provider acceptance remain separate. The candidate/transport evidence is not a substitute for these command tests.

## Normalization

`task.order.normalize` explicitly supplies parent ID and the full versioned sibling list in current order (empty allowed). Generate `generateNKeysBetween(null,null,count)` in that order. It preserves sequence and all non-order fields, with one grouped maintenance event/undo/journal. All keys already matching is a no-op; identical sequence alone is not. This is not an automatic overflow fallback and cannot silently repair malformed canonical records. Preview/execution guards must include arrivals, outside changes and exact bytes.

## Rationale

Per-task sparse keys avoid the shared order-file hotspot for independent captures; they do not preserve every concurrent placement intention. Explicit tied-run repair handles actual ties with the pinned algorithm and bounded routine writes, rather than a linked list, event log or sequence CRDT. Historical entropy rationale: naïve suffixing can escape a prefix upper bound (`a0` plus `f...` sorts after `a0V`); sophisticated unique-key schemes were not disproved, but entropy allocation was deferred unless measured repair/conflict frequency warrants reconsideration, not accepted as a key rule.

Normative cases: `key-vectors`, `key-invalid`, `key-limit`, `key-overflow`, `key-byte-order`, `reorder-tied`, `reorder-selected-unchanged`, `reorder-noop`, `reorder-hidden`, `normalize`, `normalize-noop`, `scope-arrival`, `scope-formatting`, `scope-delete`, `recover-prefix`, `recover-divergence`. Existing [model probes](../../scripts/taskdbV2Rekey.test.mjs) inform these vectors but do not establish production conformance.
