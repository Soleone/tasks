import type { EditorClient } from "./editorClient";
import { HomeDocuments, homeUndoStorage } from "./homeDocuments";
import { MainWorkspace } from "./mainWorkspace";
import { loadPreferences, resetPreferences } from "./preferences";
import { browserUndoFor, undoScope } from "./undoHistory";
import type { WorkspaceReader } from "./workspaceReader";

/** A home without undo records takes the ones this browser kept for the same history, once. */
async function adoptBrowserUndo(
  editor: EditorClient,
  documents: HomeDocuments,
): Promise<string | null> {
  const { writeContext } = await editor.begin(undefined, "operation");
  const text = browserUndoFor(undoScope(editor.selection, writeContext), writeContext);
  if (text !== null) await documents.save("undo", text);
  return text;
}

/**
 * Opens a home's workspace with its own preferences and undo records loaded first, so the list
 * renders with them. Damaged settings stop here with a DamagedSettingsError unless the owner chose
 * to reset them, which keeps the damaged file beside the new one.
 */
export async function openHomeWorkspace(
  reader: WorkspaceReader,
  editor: EditorClient,
  resetDamagedSettings = false,
): Promise<MainWorkspace> {
  const documents = new HomeDocuments((command, args) => editor.homeCommand(command, args));
  if (resetDamagedSettings) await resetPreferences(documents);
  else await loadPreferences(documents);
  const undo = (await documents.read("undo")) ?? (await adoptBrowserUndo(editor, documents));
  return new MainWorkspace(reader, editor, homeUndoStorage(documents, undo), documents);
}
