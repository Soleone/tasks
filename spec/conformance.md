# Conformance and evidence

This file maps current behavior to the automated checks that exercise it. A passing browser or Linux test is not evidence of native Windows, Omarchy, or Android acceptance.

| Area | Evidence |
| --- | --- |
| Canonical files, cache rebuild, recovery, task mutations, activity, and receipts | `src/backend/canonicalWorkspace.test.ts`, `src/backend/tasks.test.ts`, and other `src/backend/*.test.ts` files, run by `pnpm test`. |
| JSON-lines and CLI compatibility, disposable v1 fixtures, registry routing | `scripts/taskdbConformance.test.mjs`. |
| Desktop/Android shared behavior and Android-specific limitations | `scripts/platformParity.test.mjs` and `scripts/fixtures/platform-parity.json`. |
| UI keyboard/mouse paths, focus, persistence, and accessibility | `scripts/check-ui.mjs`, run by `pnpm test:ui` against temporary data. |
| Sidecar packaging/runtime and standalone CLI probe | `scripts/check-sidecar.mjs`, run by `pnpm test:sidecar`. This probe does not itself establish native UI acceptance. |

The v1 fixture under `scripts/fixtures/taskdb-v1/` is disposable test input with canonical workspace, task, and sibling-order records. Tests copy it before mutation.

The registry integration test creates two temporary TaskDB roots, checks aggregate queries and TaskRefs, routes protocol and CLI writes, confirms the other root stays unchanged, and verifies that mounting the same workspace twice fails closed. Registry-enabled first-party UI and Android behavior are not covered because they are not implemented.

Validation procedures and commands live in [Development and validation](../docs/development.md). Native acceptance and platform-specific evidence are tracked there, not inferred from this test list.
