# Legacy runtime

These files belong to the old engine and are deleted at cutover. Don't add features to them, don't import them from new code, and don't copy their patterns. Fix them only to keep the legacy route working until then.

## Legacy only

Nothing in the current engine reaches these (import scan at `f10545c`).

- `backend/commands.ts`, `backend/tasks.ts`, `backend/taskQueries.ts`, `backend/taskRecords.ts`, `backend/taskArguments.ts`
- `backend/workspace.ts`, `backend/receiveWorkspace.ts`, `backend/sourceController.ts`, `backend/sourceRegistry.ts`, `backend/themes.ts`
- `backend/cli.ts`, `backend/tasks-cli.ts`, `backend/devServer.ts` (legacy entry points; the current CLI is `backend/v2HumanCli.ts`)

## Legacy, still reached through shared code

The current engine reaches these only through shared modules. Each edge must be cut before the file can move to `src/legacy/`.

| File | Reached through | Cut by |
| --- | --- | --- |
| `backend/database.ts` | `canonicalWorkspace.ts` | moving `canonicalWorkspace.ts` |
| `backend/canonicalWorkspace.ts` | `v2MigrationSource.ts`, `v2V1Conversion.ts` | giving the migration its own schema-1 reader |
| `backend/taskExport.ts` | `workspace.ts`, `platform/androidBackendEngine.ts` | the Android removal |
| `platform/backendTransport.ts` | `platform/backendClient.ts` | removing the legacy route from the client |
| `platform/android*.ts` | `backendTransport.ts`, `components/SettingsDialog.tsx` | the Android removal (dropped until ported) |

## Shared, partly legacy

- `backend/protocol.ts`: imported by legacy and current code alike. The parts the current engine uses move into its own protocol module; the rest leaves with legacy.
- `backend/taskText.ts`, `backend/requestHash.ts`: used by the UI or by the migration's schema-1 conversion. Check importers before moving.
