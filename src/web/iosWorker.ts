import "./workerGlobals";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { executeHomeLine } from "@/backend/homeGateway";
import { CLOSE_MESSAGE } from "./workerBackend";
import { provideSqlJs } from "./shims/sqlite";

const encoder = new TextEncoder();
const ready = initSqlJs({ locateFile: () => sqlWasmUrl }).then(provideSqlJs);

/**
 * The iOS app's backend, named after the Tasks home it serves. Every request ends with its files
 * saved, so closing has nothing to do.
 */
async function handle(message: string): Promise<void> {
  await ready;
  if (message === CLOSE_MESSAGE) return postMessage(CLOSE_MESSAGE);
  for (const line of message.split("\n").filter((text) => text.trim() !== ""))
    postMessage(`${JSON.stringify(executeHomeLine(encoder.encode(line), self.name, "app"))}\n`);
}

// Requests run one at a time, in order. A failure reaches the app, which fails its pending
// requests; its next request starts a new worker.
let queue = Promise.resolve();
onmessage = ({ data }: MessageEvent<string>) => {
  queue = queue
    .then(() => handle(data))
    .catch((error: unknown) => {
      reportError(error);
      close();
    });
};
