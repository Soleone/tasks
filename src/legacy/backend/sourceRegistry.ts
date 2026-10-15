import { readFileSync } from "node:fs";
import path from "node:path";
import { CommandError } from "../../backend/errors.js";

export type TaskDbV1Source = {
  key: string;
  label: string;
  databasePath: string;
  syncRoot: string;
};

export type TaskSourceRegistry = {
  path: string;
  defaultSourceKey?: string;
  sources: TaskDbV1Source[];
};

type JsonRecord = Record<string, unknown>;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SOURCES = 32;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError("INVALID_SOURCE_REGISTRY", `${field} must be a non-empty string`);
  }
  return value.trim();
}

function sourcePath(value: unknown, field: string, registryPath: string): string {
  const candidate = requiredText(value, field);
  return path.resolve(path.dirname(registryPath), candidate);
}

export function readSourceRegistry(filePath: string): TaskSourceRegistry {
  const registryPath = path.resolve(filePath);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CommandError("INVALID_SOURCE_REGISTRY", `could not read ${registryPath}: ${detail}`);
  }

  if (!isRecord(value) || value.format !== "tasks.source-registry" || value.formatVersion !== 1) {
    throw new CommandError("INVALID_SOURCE_REGISTRY", "registry must use tasks.source-registry format version 1");
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > MAX_SOURCES) {
    throw new CommandError("INVALID_SOURCE_REGISTRY", `registry must contain 1–${MAX_SOURCES} sources`);
  }

  const keys = new Set<string>();
  const databasePaths = new Set<string>();
  const syncRoots = new Set<string>();
  const sources = value.sources.map((entry, index): TaskDbV1Source => {
    if (!isRecord(entry)) {
      throw new CommandError("INVALID_SOURCE_REGISTRY", `sources[${index}] must be an object`);
    }
    const key = requiredText(entry.key, `sources[${index}].key`);
    if (!SOURCE_KEY_PATTERN.test(key) || keys.has(key)) {
      throw new CommandError("INVALID_SOURCE_REGISTRY", `sources[${index}].key must be unique and use letters, digits, dot, underscore, or hyphen`);
    }
    keys.add(key);
    const databasePath = sourcePath(entry.databasePath, `sources[${index}].databasePath`, registryPath);
    const syncRoot = entry.syncRoot === undefined
      ? path.join(path.dirname(databasePath), "sync")
      : sourcePath(entry.syncRoot, `sources[${index}].syncRoot`, registryPath);
    if (databasePaths.has(databasePath) || syncRoots.has(syncRoot)) {
      throw new CommandError("DUPLICATE_SOURCE_MOUNT", `sources[${index}] repeats a database or canonical root already mounted`);
    }
    databasePaths.add(databasePath);
    syncRoots.add(syncRoot);
    return {
      key,
      label: requiredText(entry.label, `sources[${index}].label`),
      databasePath,
      syncRoot,
    };
  });

  const defaultSourceKey = value.defaultSourceKey === undefined
    ? undefined
    : requiredText(value.defaultSourceKey, "defaultSourceKey");
  if (defaultSourceKey !== undefined && !keys.has(defaultSourceKey)) {
    throw new CommandError("INVALID_SOURCE_REGISTRY", "defaultSourceKey must name a registered source");
  }

  return {
    path: registryPath,
    ...(defaultSourceKey === undefined ? {} : { defaultSourceKey }),
    sources,
  };
}
