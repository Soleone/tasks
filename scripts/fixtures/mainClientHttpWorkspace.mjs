import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const http = await build({
  stdin: {
    contents: `export * from './src/platform/backendClient'; export {MainWorkspace} from './src/platform/mainWorkspace'; export {WorkspaceReader} from './src/platform/workspaceReader'; export {readEditorSelection, EditorClient} from './src/platform/editorClient'; export {UndoHistory, UNDO_HISTORY_LIMIT} from './src/platform/undoHistory';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.env": JSON.stringify({}) },
});
export const httpClient = await import(
  `data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}`
);
export const { startDevServer } = await import("../../test-dist/backend/devServer.js");

export async function selectedHttpWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdb-main-http-"));
  const home = path.join(directory, "home"),
    root = path.join(home, "sync"),
    cache = path.join(home, "local", "app.db");
  cpSync("scripts/fixtures/workspace/root", root, { recursive: true });
  mkdirSync(path.join(home, "local"));
  const originalFetch = globalThis.fetch;
  let dev = await startDevServer({ port: 0, home });
  const calls = [];
  let loseNextWriteReply = false;
  globalThis.fetch = async (...args) => {
    const request = args[1]?.body ? JSON.parse(args[1].body) : null;
    if (request) calls.push(request);
    const response = await originalFetch(...args);
    if (request?.readOnly === false && request.dryRun === false && loseNextWriteReply) {
      loseNextWriteReply = false;
      throw new TypeError("Failed to fetch");
    }
    return response;
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => dev.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const confirm = async (storage) => {
    const selection = await httpClient.readEditorSelection(dev.url);
    return new httpClient.MainWorkspace(
      new httpClient.WorkspaceReader(selection, { url: dev.url, selection }),
      new httpClient.EditorClient(dev.url, selection),
      storage,
    );
  };
  // Restart the bridge with the cache set aside and reconfirm, as after losing the cache.
  const reopen = async () => {
    await new Promise((resolve) => dev.server.close(resolve));
    renameSync(cache, `${cache}.set-aside`);
    dev = await startDevServer({ port: 0, home });
    return confirm();
  };
  // Restart the bridge on the same home and cache, as after closing and reopening.
  const restart = async (storage) => {
    await new Promise((resolve) => dev.server.close(resolve));
    dev = await startDevServer({ port: 0, home });
    return confirm(storage);
  };
  return {
    directory,
    root,
    calls,
    workspace: await confirm(),
    confirm,
    reopen,
    restart,
    loseNextReply: () => {
      loseNextWriteReply = true;
    },
  };
}
