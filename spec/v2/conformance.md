# V2 conformance and support

**Status: accepted target, not implemented.** [Overview](overview.md). The [declarative corpus](../../scripts/fixtures/taskdb-v2/README.md) is normative expected input/outcome data, not a v2 reference implementation. Its format is independent of schema/protocol 2.

## Profiles and evidence

| Claim/profile | Required contract/cases | Current evidence |
| --- | --- | --- |
| File reader | Model, root/identity, graph, key grammar/comparison; malformed/partial bytes and mixed-root refusal | Partial Node filesystem helper: 15 model corpus cases plus targeted JSON/key/graph/golden/entry checks in [reader tests](../../src/backend/v2CanonicalReader.test.ts), on disposable WSL2 Linux roots (Node v22.22.3, kernel 6.6.114.1-microsoft-standard-WSL2); not full file-profile/native evidence |
| Command/query reader | Protocol/envelope/projection/input/query cases applicable to advertised commands | No v2 gateway; current Node/Android v1 unchanged |
| Basic recoverable writer | Reader plus mutation/context/receipt/no-op/file-guard/journal cases for each supported write, including crash before/after local receipt commit and lost reply | Candidate ordering/byte-journal model only; not command conformance |
| Ordering maintenance | Exact vectors, ties, selected-key-unchanged versions, normalize, scope faults and grouped undo | Existing candidate tests; real two-peer Syncthing transport evidence, not app writer |
| Doctor/purge | Reviewed ambiguous/dangling links, preserved copies, plan/replay/cache-loss, cleanup interruption and referenced purge | Target cases only, no application proof |
| Migration/archive/restore | Full-field golden mapping, invalid sources, each stage interruption, destination/source guard, v1 rollback and fresh authority | Static golden root only; no converter/restore proof |
| CLI | Literal/shorthand flags, omitted-field updates, JSON/error output, original authority retained on retry | V1 CLI runs only; v2 target cases |
| Independent interoperability | A second implementation reads/writes the same complete files, reproduces keys and passes declared profiles | None; not a public standard claim |

Node/desktop, Windows 11 native, Omarchy native, Android standard SAF picker, third-party document providers and physical devices need separate reports. **V2 command, writable, native lifecycle and interoperability claims remain unproven.** The read-only Node helper below is bounded execution evidence, not a supported v2 gateway or complete provider profile. WSL2 model/transport runs do not establish native conformance; browser builds cannot close M1. Android cannot keep its v1 title+description requirement or shared sync-revision versions while claiming these input/authority profiles.

A bounded implementation MAY advertise only a subset of protocol commands. It MUST report unsupported commands and refuse unsupported writes; it cannot label an unsupported case passed. Supported creation/update requires full model validation, exact-byte guards and safe pending outcomes, not only happy-path JSON. Cache loss deliberately fails old context/retries; no separate receipt ledger is required. Storage providers must not relax the contract by inventing empty scans or silently overwriting partial bytes.

## Corpus checks versus execution

`node --test scripts/taskdbV2Spec.test.mjs` verifies case identities/profiles/anchors, required case references/error names, golden root structure/graph/field preservation/order and no canonical-local fields. It does NOT execute actions, implement a shorthand parser, run migration/doctor or call a v2 backend. Do not report its passing tests as “all v2 cases passed.” It only confirms that a corpus for those cases exists coherently.

`src/backend/v2CanonicalReader.ts` is an isolated read-only Node filesystem entry, with strict UTF-8/JSON and model/graph validation. It records exact byte observations, reports known conflict copies separately and refuses known escapes/mixed roots; it does not initialize data, project optimistic versions, negotiate protocol, write cache/canonical files, migrate or recover journals. `v2CanonicalReader.test.ts` materializes the 15 model corpus cases independently, preserving input bytes; additional focused checks cover the golden root, keys/ID ordering, duplicate escapes, BOM/non-finite values, entry refusal and a 10,000-node graph. Directory/file identity and repeated inventory/hash checks are best-effort observations, not a kernel-pinned cross-file snapshot or malicious directory-race sandbox. Static symlink refusal is not proof against every ancestor substitution/ABA race. Windows symlink tests explicitly skip if the privilege is absent; Android/provider behavior is not exercised.

Existing [candidate/rekey tests](../../scripts/taskdbV2Rekey.test.mjs) and [Syncthing transport probe](../../scripts/taskdbV2Transport.test.mjs) remain bounded experimental evidence. The proposal records their writer race/CRDT/power-loss limits. V1 regressions still run under `pnpm test`; they do not prove target compatibility without v2 execution.

For each future execution report record implementation/version, platform/provider, supported commands/profiles, fixture version and case IDs executed/passed/failed/unsupported, temporary-root setup, fault method/cut points, cache/recovery retention and residual limitations. Capture actual response/artifact evidence and verify original/target bytes. Keep expected fixture outcomes independent of implementation-generated values except declared opaque/time bindings.

Actual recovery proof must include interruption at every file prefix, after canonical verification but before receipt transaction, after receipt commit before reply, cleanup retirement, deletion and partial-byte writes; relevant preflight faults must leave zero operation writes. Actual conversion proof must verify v1 remains usable at every failed stage, full-field target equality, fresh-context adoption and rollback warnings about later v2 edits. Reusing the same code to produce expected and actual results is not independent conformance.

Promotion closes the spec/fixture gate only. The recoverable slice and native M1 gates remain open, with no production/personal-data conversion by these integrity tests.
