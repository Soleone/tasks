import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { readPhysicalRoot, readRegularFile } from "./canonicalReader.js";
import { CommandError } from "./errors.js";
import { executeLine, failureResponse } from "./gateway.js";
import { createHome, homeCache, openHome } from "./home.js";
import type { Home, HomeClient } from "./home.js";
import { syncDirectory, writeDurableFile } from "./localDomain.js";
import { assertArgs, decodeEnvelope, isRecord, parseRequest } from "./protocol.js";
import type { Request, Response } from "./protocol.js";
import { observeQueryAuthority } from "./queryCache.js";

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_THEME_BYTES = 64 * 1024;

/**
 * The app's own files in the home: preferences beside `sync/`, the shared ones inside it, undo
 * records in `local/`. Syncthing never syncs `.syncthing.*.tmp`, so the shared stage stays here.
 */
function documentPaths(home: Home, name: unknown): { file: string; stage: string } {
  if (name === "settings")
    return { file: home.settingsPath, stage: `${home.settingsPath}.preparing` };
  if (name === "shared")
    return {
      file: home.sharedSettingsPath,
      stage: path.join(home.rootPath, ".syncthing.settings.tmp"),
    };
  if (name === "undo") return { file: home.undoPath, stage: `${home.undoPath}.preparing` };
  throw new CommandError("INVALID_ARGUMENT", "document must be settings, shared or undo");
}

function readDocument(home: Home, request: Request): Record<string, unknown> {
  assertArgs(request.args, ["name"]);
  const { file } = documentPaths(home, request.args.name);
  return {
    text: existsSync(file) ? readRegularFile(file).toString("utf8") : null,
  };
}

/** A durable replace: stage, flush, rename, flush the folder. A damaged file is kept beside it. */
function writeDocument(home: Home, request: Request): Record<string, unknown> {
  assertArgs(request.args, ["name", "text", "replaceDamaged"]);
  const { file, stage } = documentPaths(home, request.args.name);
  const { text, replaceDamaged } = request.args;
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES)
    throw new CommandError("INVALID_ARGUMENT", "text must be a string of at most 1 MiB");
  try {
    if (!isRecord(JSON.parse(text))) throw new Error("not an object");
  } catch {
    throw new CommandError("INVALID_ARGUMENT", "text must be a JSON object");
  }
  if (replaceDamaged !== undefined && typeof replaceDamaged !== "boolean")
    throw new CommandError("INVALID_ARGUMENT", "replaceDamaged must be a boolean");
  let keptPath: string | null = null;
  if (replaceDamaged && existsSync(file)) {
    const stamp = new Date().toISOString().replaceAll(":", "-");
    keptPath = `${file.slice(0, -".json".length)}.damaged-${stamp}.json`;
    renameSync(file, keptPath);
  }
  // A stage left by a crash was never published, so the current file is still the saved one.
  rmSync(stage, { force: true });
  writeDurableFile(stage, Buffer.from(text));
  renameSync(stage, file);
  syncDirectory(path.dirname(file));
  return { keptPath };
}

/**
 * Palettes the owner dropped into the home's `themes/` folder, beside `sync/` so they stay on this
 * device: `<name>.toml`, or an omarchy theme folder holding `<name>/colors.toml`. The client
 * parses them; files it can't read as a theme are its to report.
 */
function listThemes(home: Home, request: Request): Record<string, unknown> {
  assertArgs(request.args, []);
  const folder = path.join(home.homePath, "themes");
  if (!existsSync(folder)) return { themes: [] };
  const themes = [];
  // Followed links are fine here: these are the owner's own files, never synced or written.
  for (const entry of readdirSync(folder)) {
    const isFolder = statSync(path.join(folder, entry), { throwIfNoEntry: false })?.isDirectory();
    const file = isFolder ? path.join(folder, entry, "colors.toml") : path.join(folder, entry);
    if (!file.endsWith(".toml")) continue;
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_THEME_BYTES) continue;
    const name = isFolder ? entry : path.basename(entry, ".toml");
    themes.push({ name, text: readFileSync(file, "utf8") });
  }
  return { themes };
}

function homeResponse(request: Request, home: Home, client: HomeClient, result: object): Response {
  const root = readPhysicalRoot(home.rootPath);
  const { writeContext } = observeQueryAuthority(homeCache(home, client), root);
  return {
    version: 2,
    requestId: request.requestId,
    ok: true,
    writeContext,
    result: { homePath: home.homePath, ...result },
  };
}

/**
 * One request against a Tasks home: home setup and the app's own documents are answered here,
 * everything else goes to the gateway with the home's `sync/` and this client's cache.
 */
export function executeHomeLine(bytes: Uint8Array, selected: string, client: HomeClient): Response {
  let requestId: string | null = null;
  try {
    const envelope = decodeEnvelope(bytes);
    if (isRecord(envelope) && typeof envelope.requestId === "string")
      requestId = envelope.requestId;
    const request = parseRequest(envelope);
    if (request.command === "home.create") {
      assertArgs(request.args, []);
      return homeResponse(request, createHome(selected), client, {});
    }
    const home = openHome(selected);
    if (request.command === "home.document.read")
      return homeResponse(request, home, client, readDocument(home, request));
    if (request.command === "home.document.write")
      return homeResponse(request, home, client, writeDocument(home, request));
    if (request.command === "home.themes.list")
      return homeResponse(request, home, client, listThemes(home, request));
    return executeLine(bytes, home.rootPath, homeCache(home, client));
  } catch (error) {
    return failureResponse(requestId, error);
  }
}
