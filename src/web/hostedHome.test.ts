import initSqlJs from "sql.js";
import { vol } from "memfs";
import { beforeAll, expect, test, vi } from "vite-plus/test";
import { executeHomeLine } from "@/backend/homeGateway";
import { restoreFiles, snapshotFiles } from "./homeSnapshot";
import { provideSqlJs } from "./shims/sqlite";

// The backend runs on the same stand-ins as in the hosted build's worker.
vi.mock("node:fs", () => import("./shims/fs"));
vi.mock("node:path", () => import("./shims/path"));
vi.mock("node:crypto", () => import("./shims/crypto"));
vi.mock("node:sqlite", () => import("./shims/sqlite"));
vi.mock("node:zlib", () => import("./shims/zlib"));

const HOME = "/Tasks";

function send(command: string, args: Record<string, unknown> = {}, write = true) {
  const request = (fields: Record<string, unknown>) => {
    const response = executeHomeLine(
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          requestId: crypto.randomUUID(),
          actor: { kind: "human", label: "test" },
          dryRun: false,
          ...fields,
        }),
      ),
      HOME,
      "app",
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

beforeAll(async () => {
  provideSqlJs(await initSqlJs());
});

test("platform.open-workspace: the hosted home keeps its tasks and undo history across reloads", () => {
  vol.reset();
  send("home.create", {}, false);
  send("workspace.init");
  const created = send("task.create", { text: "Kept across reloads @demo" });

  const snapshot = structuredClone(snapshotFiles());
  vol.reset();
  restoreFiles(snapshot);

  const titles = () =>
    (send("task.list", { sort: "manual" }, false).result.tasks as { title: string }[]).map(
      (task) => task.title,
    );
  expect(titles()).toEqual(["Kept across reloads"]);
  // A restored home that looked copied would refuse this until a new history started.
  send("operation.undo", { operationId: created.result.operationId });
  expect(titles()).toEqual([]);
});
