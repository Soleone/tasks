import "./workerGlobals";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { executeHomeLine } from "@/backend/homeGateway";
import type { Response } from "@/backend/protocol";
import { CLOSE_MESSAGE, WEB_HOME } from "./workerBackend";
import { restoreFiles, snapshotFiles } from "./homeSnapshot";
import { loadHome, saveHome } from "./homeStorage";
import { provideSqlJs } from "./shims/sqlite";

const encoder = new TextEncoder();

function execute(line: string): Response {
  return executeHomeLine(encoder.encode(line), WEB_HOME, "app");
}

/** A first visit gets a new, empty home; the example tasks wait for the visitor to ask. */
function createHome(): void {
  const send = (fields: Record<string, unknown>) => {
    const response = execute(
      JSON.stringify({
        version: 2,
        requestId: crypto.randomUUID(),
        actor: { kind: "human", label: "Tasks web" },
        dryRun: false,
        args: {},
        ...fields,
      }),
    );
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response;
  };
  send({ command: "home.create", readOnly: false });
  const { writeContext } = send({ command: "workspace.info", readOnly: true });
  send({
    command: "workspace.init",
    readOnly: false,
    writeContext,
    idempotencyKey: crypto.randomUUID(),
  });
}

async function start(): Promise<void> {
  provideSqlJs(await initSqlJs({ locateFile: () => sqlWasmUrl }));
  const saved = await loadHome();
  if (saved) {
    restoreFiles(saved);
    return;
  }
  createHome();
  await saveHome(snapshotFiles());
}

async function handle(message: string): Promise<void> {
  if (message === CLOSE_MESSAGE) {
    postMessage(CLOSE_MESSAGE);
    return;
  }
  for (const line of message.split("\n").filter((text) => text.trim() !== ""))
    postMessage(`${JSON.stringify(execute(line))}\n`);
  await saveHome(snapshotFiles());
}

/** Reports to the app, which fails its pending requests; its next request starts a new worker. */
function fail(error: unknown): void {
  reportError(error);
  close();
}

// Requests run one at a time, in order, after the home is ready.
let queue = start().catch(fail);
onmessage = ({ data }: MessageEvent<string>) => {
  queue = queue.then(() => handle(data)).catch(fail);
};
