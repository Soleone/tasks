import { fs } from "memfs";
import type { BindParams, Database, SqlJsStatic, SqlValue } from "sql.js";

let sqlJs: SqlJsStatic | null = null;

/** SQLite's WebAssembly loads asynchronously, so the worker provides it before the first request. */
export function provideSqlJs(module: SqlJsStatic): void {
  sqlJs = module;
}

type Parameter = SqlValue | Record<string, SqlValue>;

function bindings(parameters: Parameter[]): BindParams | undefined {
  const [first] = parameters;
  if (parameters.length === 1 && first && typeof first === "object" && !ArrayBuffer.isView(first))
    // node:sqlite binds { id } to :id, $id and @id; sql.js wants the prefix in the key.
    return Object.fromEntries(
      Object.entries(first).flatMap(([key, value]) =>
        [":", "$", "@"].map((prefix) => [prefix + key, value]),
      ),
    );
  return parameters.length === 0 ? undefined : (parameters as SqlValue[]);
}

/**
 * node:sqlite's DatabaseSync over sql.js, for the backend running in a browser worker. sql.js keeps
 * the database in memory, so opening reads the file from memfs and closing writes it back. Only
 * the calls the backend makes are here.
 */
export class DatabaseSync {
  private readonly database: Database;

  constructor(private readonly path: string) {
    if (!sqlJs) throw new Error("SQLite has not loaded.");
    const bytes = fs.existsSync(path) ? (fs.readFileSync(path) as Uint8Array) : null;
    if (!bytes) fs.writeFileSync(path, new Uint8Array());
    this.database = new sqlJs.Database(bytes?.length ? bytes : undefined);
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string) {
    const database = this.database;
    // An in-memory sql.js database has no file name; the backend checks its cache file by it.
    if (/^\s*PRAGMA database_list\s*$/i.test(sql))
      return { all: () => [{ seq: 0, name: "main", file: this.path }] };
    const step = <T>(
      parameters: Parameter[],
      read: (statement: ReturnType<Database["prepare"]>) => T,
    ): T => {
      const statement = database.prepare(sql, bindings(parameters));
      try {
        return read(statement);
      } finally {
        statement.free();
      }
    };
    return {
      get: (...parameters: Parameter[]) =>
        step(parameters, (statement) => (statement.step() ? statement.getAsObject() : undefined)),
      all: (...parameters: Parameter[]) =>
        step(parameters, (statement) => {
          const rows = [];
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        }),
      run: (...parameters: Parameter[]) => {
        step(parameters, (statement) => statement.step());
        const [rowid] = database.exec("SELECT last_insert_rowid()")[0].values[0];
        return { changes: database.getRowsModified(), lastInsertRowid: rowid };
      },
    };
  }

  /** Like closing a real connection, an unfinished transaction rolls back and is never saved. */
  close(): void {
    try {
      this.database.exec("ROLLBACK");
    } catch (error) {
      if (!String(error).includes("no transaction is active")) throw error;
    }
    fs.writeFileSync(this.path, this.database.export());
    this.database.close();
  }
}
