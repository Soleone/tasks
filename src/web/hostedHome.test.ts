import initSqlJs from "sql.js";
import { vol } from "memfs";
import { beforeAll, expect, test, vi } from "vite-plus/test";
import { executeHomeLine } from "@/backend/homeGateway";
import type { Response } from "@/backend/protocol";
import type { JsonLineSession } from "@/platform/backendSession";
import { restoreFiles, snapshotFiles } from "./homeSnapshot";
import { addSampleTasks, removeSampleTasks } from "./sampleTasks";
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

test("theme.user: the hosted backend reads theme files from its browser filesystem", () => {
  vol.reset();
  send("home.create", {}, false);
  expect(send("home.themes.list", {}, false).result.themes).toEqual([]);
  vol.fromJSON({
    "/Tasks/themes/nord/colors.toml": 'background = "#2e3440"',
    "/Tasks/themes/plum.toml": 'background = "#2b1b2e"',
    "/Tasks/themes/notes.txt": "not a theme",
  });
  expect(send("home.themes.list", {}, false).result.themes).toEqual([
    { name: "nord", text: 'background = "#2e3440"' },
    { name: "plum", text: 'background = "#2b1b2e"' },
  ]);
});

test("platform.open-workspace: example tasks come and go without touching the visitor's own tasks", async () => {
  vol.reset();
  send("home.create", {}, false);
  send("workspace.init");
  const session = {
    request: (envelope: object) =>
      Promise.resolve(
        executeHomeLine(new TextEncoder().encode(JSON.stringify(envelope)), HOME, "app"),
      ),
  } as unknown as JsonLineSession<Response>;
  const own = (title: string) => {
    const { task } = send("task.create", { text: title }).result as {
      task: { id: string; version: number };
    };
    return task;
  };
  const listed = () =>
    (
      send("task.list", { status: ["open", "in_progress", "paused", "done", "canceled"] }, false)
        .result.tasks as { title: string }[]
    )
      .map((task) => task.title)
      .sort();

  own("Mine");
  await removeSampleTasks(session, await addSampleTasks(session));
  expect(listed()).toEqual(["Mine"]);

  const canceled = own("Mine, canceled");
  send("task.delete", { id: canceled.id, expectedVersion: canceled.version });
  const ids = await addSampleTasks(session);
  await removeSampleTasks(session, ids);
  // Purging would take the visitor's canceled task too, so the examples wait under Canceled.
  expect(listed()).toContain("Mine, canceled");
  expect(
    ids.every(
      (id) =>
        (send("task.get", { id }, false).result.task as { status: string }).status === "canceled",
    ),
  ).toBe(true);
});

test("settings.export: the hosted home hands its tasks out as a zip and keeps no file", () => {
  vol.reset();
  send("home.create", {}, false);
  send("workspace.init");
  const { task } = send("task.create", { text: "Taken along" }).result as { task: { id: string } };

  const { name, data } = send("workspace.export", { download: true }, false).result as {
    name: string;
    data: string;
  };
  expect(name).toMatch(/^tasks-[\d-]+\.zip$/);
  const zip = atob(data);
  expect(zip.startsWith("PK")).toBe(true);
  expect(zip).toContain(`sync/tasks/${task.id}.json`);
  expect(zip).toContain("Taken along");
  expect(vol.readdirSync(`${HOME}/exports`)).toEqual([]);
});
