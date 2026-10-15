import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";

export type CopyTestWorkspace = { directory: string; root: string; cache: string; destination: string };

export function createCopyTestWorkspace(t: TestContext, fixtureDirectory = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url))): CopyTestWorkspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-copy-"));
  const before = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(directory, "local");
  t.after(() => {
    if (before === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = before;
    rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "root");
  cpSync(fixtureDirectory, root, { recursive: true });
  return { directory, root, cache: path.join(directory, "cache.db"), destination: path.join(directory, "archive") };
}
