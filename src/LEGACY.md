# Legacy runtime

`src/legacy/` holds the old engine: `legacy/backend/` (commands, SQLite database, schema 1 workspace sync, source registry, old protocol) and `legacy/platform/` (the old Android runtime and the legacy transport). It is deleted at cutover. Don't add features to it, don't import it from new code, and don't copy its patterns. Fix it only to keep the legacy route working until then.

The only way in is explicit: `pnpm dev:web --legacy`, `tasks-cli --legacy`, the backend binary without `--root`, and native desktop and Android builds, which start the legacy app until cutover.

## Links still to cut

Current code still imports legacy code in these places. Each one goes away before or at cutover.

| Legacy module | Imported by | Goes away with |
| --- | --- | --- |
| `legacy/backend/protocol` | UI components, `App.tsx`, `theme.ts`, `platform/backendClient.ts`, `platform/backendSession.ts`, `backend/builtinThemes.ts` | Stage 4: UI moves to the current model types |
| `legacy/backend/commands`, `canonicalWorkspace`, `sourceRegistry` | the legacy branches of `backend/cli.ts`, `backend/tasks-cli.ts`, `backend/devServer.ts` | Cutover: the `--legacy` branches are deleted |
| `legacy/platform/backendTransport`, `androidSyncConflicts`, `androidWorkspace` | `platform/backendClient.ts`, `components/SettingsDialog.tsx` | Cutover: the legacy route and Android runtime are deleted |
| `legacy/backend/requestHash` | migration tests (hashing schema 1 fixtures) | Cutover, or earlier by hashing with `backend/canonicalJson` |
