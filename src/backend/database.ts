import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RuntimeProbeResult } from "./protocol.js";

function readString(value: unknown, field: string): string {
  if (typeof value !== "object" || value === null || !(field in value)) {
    throw new Error(`SQLite did not return ${field}`);
  }

  const result = (value as Record<string, unknown>)[field];
  if (typeof result !== "string") {
    throw new Error(`SQLite returned a non-string ${field}`);
  }

  return result;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "object" || value === null || !(field in value)) {
    throw new Error(`SQLite did not return ${field}`);
  }

  const result = (value as Record<string, unknown>)[field];
  if (typeof result !== "number") {
    throw new Error(`SQLite returned a non-number ${field}`);
  }

  return result;
}

export function runRuntimeProbe(databasePath: string): RuntimeProbeResult {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;");
    const journalMode = readString(database.prepare("PRAGMA journal_mode = WAL").get(), "journal_mode");
    const sqliteVersion = readString(database.prepare("SELECT sqlite_version() AS version").get(), "version");

    database.exec(
      "CREATE TABLE IF NOT EXISTS runtime_probe (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);" +
        "CREATE VIRTUAL TABLE IF NOT EXISTS runtime_probe_fts USING fts5(value);",
    );

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM runtime_probe; DELETE FROM runtime_probe_fts;");
      database.prepare("INSERT INTO runtime_probe (id, value) VALUES (1, ?)").run("capture a task");
      database.prepare("INSERT INTO runtime_probe_fts (value) VALUES (?)").run("capture a task");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const searchMatches = readNumber(
      database.prepare("SELECT COUNT(*) AS count FROM runtime_probe_fts WHERE runtime_probe_fts MATCH ?").get("task"),
      "count",
    );
    const probeValue = readString(database.prepare("SELECT value FROM runtime_probe WHERE id = 1").get(), "value");

    return {
      databasePath,
      nodeVersion: process.version,
      sqliteVersion,
      journalMode,
      fts5Enabled: true,
      searchMatches,
      probeValue,
    };
  } finally {
    database.close();
  }
}
