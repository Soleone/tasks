import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { adoptTaskFolder } from "./adoption.js";
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

/** The app's own files in the home: preferences beside `sync/`, undo records in `local/`. */
function documentPath(home: Home, name: unknown): string {
  if (name === "settings") return home.settingsPath;
  if (name === "undo") return home.undoPath;
  throw new CommandError("INVALID_ARGUMENT", "document must be settings or undo");
}

function readDocument(home: Home, request: Request): Record<string, unknown> {
  assertArgs(request.args, ["name"]);
  const file = documentPath(home, request.args.name);
  return { text: existsSync(file) ? readRegularFile(file).toString("utf8") : null };
}

/** A durable replace: stage, flush, rename, flush the folder. A damaged file is kept beside it. */
function writeDocument(home: Home, request: Request): Record<string, unknown> {
  assertArgs(request.args, ["name", "text", "replaceDamaged"]);
  const file = documentPath(home, request.args.name);
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
  const stage = `${file}.preparing`;
  // A stage left by a crash was never published, so the current file is still the saved one.
  rmSync(stage, { force: true });
  writeDurableFile(stage, Buffer.from(text));
  renameSync(stage, file);
  syncDirectory(path.dirname(file));
  return { keptPath };
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
 * One request against a Tasks home: home setup, adoption and the app's own documents are answered here,
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
    if (request.command === "home.adopt") {
      assertArgs(request.args, ["root", "cache", "profile"]);
      const { root, cache, profile } = request.args;
      if (
        typeof root !== "string" ||
        typeof cache !== "string" ||
        typeof profile !== "string" ||
        [root, cache, profile].includes("")
      )
        throw new CommandError("INVALID_ARGUMENT", "root, cache and profile must be paths");
      return homeResponse(request, adoptTaskFolder(selected, { root, cache, profile }), client, {});
    }
    const home = openHome(selected);
    if (request.command === "home.document.read")
      return homeResponse(request, home, client, readDocument(home, request));
    if (request.command === "home.document.write")
      return homeResponse(request, home, client, writeDocument(home, request));
    return executeLine(bytes, home.rootPath, homeCache(home, client));
  } catch (error) {
    return failureResponse(requestId, error);
  }
}
