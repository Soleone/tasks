import "./workerGlobals";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { executeHomeLine } from "@/backend/homeGateway";
import type { Response } from "@/backend/protocol";
import { CLOSE_MESSAGE, WEB_HOME } from "@/platform/workerBackend";
import { restoreFiles, snapshotFiles } from "./homeSnapshot";
import { loadHome, saveHome } from "./homeStorage";
import { SAMPLE_TASKS } from "./sampleTasks";
import { provideSqlJs } from "./shims/sqlite";

const encoder = new TextEncoder();

function execute(line: string): Response {
  return executeHomeLine(encoder.encode(line), WEB_HOME, "app");
}

/** One backend request for seeding; writes ask for the current write context first. */
function send(command: string, args: Record<string, unknown> = {}, write = false) {
  const request = (fields: Record<string, unknown>) => {
    const response = execute(
      JSON.stringify({
        version: 2,
        requestId: crypto.randomUUID(),
        actor: { kind: "human", label: "Sample tasks" },
        dryRun: false,
        ...fields,
      }),
    );
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response;
  };
  if (!write) return request({ command, args, readOnly: true });
  const { writeContext } = request({ command: "workspace.info", args: {}, readOnly: true });
  return request({
    command,
    args,
    readOnly: false,
    writeContext,
    idempotencyKey: crypto.randomUUID(),
  });
}

const STATUS_COMMANDS = { in_progress: "task.start", paused: "task.pause", done: "task.complete" };

function createTask(
  {
    text,
    status,
    priority,
  }: { text: string; status?: keyof typeof STATUS_COMMANDS; priority?: number },
  parentId: string | null,
): string {
  const { task } = send("task.create", { text, priority, parentId }, true).result as {
    task: { id: string; version: number };
  };
  if (status)
    send(
      "task.transitionMany",
      {
        tasks: [{ id: task.id, expectedVersion: task.version, command: STATUS_COMMANDS[status] }],
      },
      true,
    );
  return task.id;
}

/** A first visit gets a new home with the sample tasks, created through the real commands. */
function seed(): void {
  send("home.create", {}, false);
  send("workspace.init", {}, true);
  // New tasks go to the top, so the list is created from the bottom up.
  for (const sample of [...SAMPLE_TASKS].reverse()) {
    const id = createTask(sample, null);
    for (const child of [...(sample.children ?? [])].reverse()) createTask(child, id);
  }
}

async function start(): Promise<void> {
  provideSqlJs(await initSqlJs({ locateFile: () => sqlWasmUrl }));
  const saved = await loadHome();
  if (saved) {
    restoreFiles(saved);
    return;
  }
  seed();
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
