import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { beforeAll, expect, test, vi } from "vite-plus/test";
import { executeHomeLine } from "@/backend/homeGateway";
import { Buffer as WorkerBuffer } from "./shims/buffer";
import { provideSqlJs } from "./shims/sqlite";

// The backend runs on the same stand-ins as in the iOS app's worker.
vi.mock("node:fs", () => import("./shims/iosFs"));
vi.mock("node:sqlite", () => import("./shims/sqlite"));

const HOME = "/Tasks";
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
// The folder the shell would serve: the app's Documents.
const documents = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tasks-ios-")));

type Call = { call: string; path: string; to?: string; follow?: boolean; exclusive?: boolean };

/** The shell's side of src-tauri/src/ios_files.rs, on this machine's files. */
function shell({ call, path: inside, to, follow, exclusive }: Call, bytes: Uint8Array) {
  const file = path.join(documents, inside);
  if (call === "stat") {
    const found = (follow ? fs.statSync : fs.lstatSync)(file, { bigint: true });
    return JSON.stringify({
      kind: found.isFile() ? "file" : found.isDirectory() ? "directory" : "link",
      ...Object.fromEntries(
        (["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const).map((name) => [
          name,
          String(found[name]),
        ]),
      ),
    });
  }
  if (call === "list") return JSON.stringify(fs.readdirSync(file));
  if (call === "read") return fs.readFileSync(file);
  if (call === "write") fs.writeFileSync(file, bytes, { flag: exclusive ? "wx" : "w" });
  else if (call === "append") fs.appendFileSync(file, bytes);
  else if (call === "mkdir") fs.mkdirSync(file);
  else if (call === "rename") fs.renameSync(file, path.join(documents, to!));
  else if (call === "remove") fs.unlinkSync(file);
  else if (call === "realpath")
    return JSON.stringify(`/${path.relative(documents, fs.realpathSync(file))}`);
  else if (call !== "sync") throw new Error(`unknown call ${call}`);
  return "";
}

class ShellRequest {
  status = 0;
  response = new ArrayBuffer(0);
  responseType = "";
  open(): void {}
  send(body: Uint8Array): void {
    const line = body.indexOf(10);
    let answer: string | Uint8Array;
    try {
      answer = shell(
        JSON.parse(new TextDecoder().decode(body.subarray(0, line))) as Call,
        body.subarray(line + 1),
      );
      this.status = 200;
    } catch (error) {
      const { code, message } = error as NodeJS.ErrnoException;
      answer = JSON.stringify({ code, message });
      this.status = 400;
    }
    const bytes = typeof answer === "string" ? new TextEncoder().encode(answer) : answer;
    this.response = new Uint8Array(bytes).buffer;
  }
}

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
  vi.stubGlobal("XMLHttpRequest", ShellRequest);
  // As workerGlobals does: the backend compares its own buffers with the ones files are read into.
  vi.stubGlobal("Buffer", WorkerBuffer);
  provideSqlJs(await initSqlJs());
});

test("platform.open-workspace: the iOS home is real files in the app's documents", () => {
  send("home.create", {}, false);
  send("workspace.init");
  const { task } = send("task.create", { text: "Synced from the phone @demo" }).result as {
    task: { id: string; version: number };
  };

  const file = path.join(documents, "Tasks", "sync", "tasks", `${task.id}.json`);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).title).toBe("Synced from the phone");

  // Another device's edit arrives the way Syncthing delivers it: a new file renamed into place.
  const arriving = `${file}.arriving`;
  fs.writeFileSync(arriving, fs.readFileSync(file, "utf8").replace("the phone", "the desktop"));
  fs.renameSync(arriving, file);
  const titles = () =>
    (send("task.list", { sort: "manual" }, false).result.tasks as { title: string }[]).map(
      (listed) => listed.title,
    );
  expect(titles()).toEqual(["Synced from the desktop"]);
});

test("clear-done.export: the iOS home saves the export before deleting done tasks", () => {
  const { task } = send("task.create", { text: "Done on the phone" }).result as {
    task: { id: string; version: number };
  };
  send("task.complete", { id: task.id, expectedVersion: task.version });
  const { exportLocation } = send("task.clearDone", {
    closedBefore: null,
    scope: "tasks",
    export: true,
  }).result as { exportLocation: string };

  expect(exportLocation.startsWith(`${HOME}/exports/done-tasks-`)).toBe(true);
  expect(fs.statSync(path.join(documents, exportLocation)).size).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(documents, "Tasks", "sync", "tasks", `${task.id}.json`))).toBe(
    false,
  );
});
