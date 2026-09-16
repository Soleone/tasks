import { randomUUID } from "node:crypto";
import { executeCommand } from "./commands.js";
import { getDatabasePath } from "./paths.js";
import type { ProtocolRequest, TaskRecord } from "./protocol.js";

const VERSION = 1 as const;

type GlobalOptions = {
  databasePath: string;
  json: boolean;
  dryRun: boolean;
  idempotencyKey?: string;
  expectedVersion?: number;
  actorKind: "human" | "agent";
  actorLabel: string;
};

type ParsedArgs = {
  command?: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
  globals: Partial<GlobalOptions> & { help?: boolean };
};

const MUTATION_COMMANDS = new Set([
  "task.create",
  "task.update",
  "task.delete",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
]);

const VERSIONED_COMMANDS = new Set([
  "task.update",
  "task.delete",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
]);

function usage(): string {
  return `tasks-cli: read and write tasks from any shell or agent

QUICKSTART (60 seconds):
  1. tasks-cli info                         confirm where your data lives
  2. tasks-cli add "Fix login @web #urgent"  capture; one @category and
     any number of #tags are parsed from the title automatically
  3. tasks-cli list --status open           see what is open
  4. tasks-cli show <id> --json             full record as JSON
  5. tasks-cli complete <id>                state changes need no version;
     the CLI looks it up for you

AGENTS: pass --json for machine-readable output on every command.
  tasks-cli list --status open --json

HOW IT WORKS:
  - No server, no daemon. Each invocation runs one command against the
    local workspace and exits. Exit 0 means it persisted.
  - The database resolves internally: --database, then TASKS_DATABASE_PATH,
    then the OS app-data directory. The sync root follows TASKS_SYNC_ROOT.
    Run \`tasks-cli info\` to see the resolved paths.
  - Every change is recorded in activity under your actor label
    (--actor-label, default: tasks-cli). Use one stable label per agent
    so the human can see who did what.
  - Safe retries: mutations accept --idempotency-key. Repeating a command
    with the same key replays the stored result instead of duplicating.
    Without one, a fresh key is generated on every run.
  - Conflicts are explicit, never silent: if a task changed since the CLI
    read it, you get STALE_TASK_VERSION (exit 3). Re-read with \`show\`
    and retry. Preview anything first with --dry-run.
  - Statuses are open, in_progress, paused, done, canceled. Inbox, Today,
    and overdue are views (use list filters), not statuses.

QUERIES:
  list [--status s] [--priority n] [--category slug] [--tag slug]
       [--search text] [--limit n] [--offset n] [--sort field]
       [--direction asc|desc] [--unblocked]
  show <id>
  activity [--task <id>] [--limit n]
  categories
  tags
  info

MUTATIONS:
  add <title...> [--description text] [--priority n] [--parent <id>]
  update <id> [--title text] [--description text] [--priority n]
  start|pause|complete|reopen|cancel|delete <id>
  undo <id>
  move <id> --parent <id> | --root
  dep-add <id> <depends-on-id>
  dep-remove <id> <depends-on-id>

GLOBAL OPTIONS:
  --database PATH          override the resolved database (rarely needed)
  --json                   print the raw result object for agents
  --dry-run                validate and preview without persisting
  --idempotency-key KEY    reuse for safe retries (auto-generated otherwise)
  --expected-version N     skip the automatic version lookup
  --actor-kind human|agent (default: agent)
  --actor-label LABEL      (default: tasks-cli)
  --help, -h               show this help

EXIT CODES:
  0 success. 1 error (CODE: message on stderr, or {ok:false} with --json).
  2 bad usage. 3 stale version: re-read with \`show\` and retry.

EXAMPLES:
  tasks-cli add "Plan launch @todo-app #planning"
  tasks-cli list --status open --limit 20
  tasks-cli show 3f9a2c1e-... --json
  tasks-cli complete 3f9a2c1e-...
  tasks-cli activity --limit 10
`;
}

function errorMessage(error: unknown): { code: string; message: string } {
  if (error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    const message = error.message.startsWith(`${code}: `) ? error.message.slice(code.length + 2) : error.message;
    return { code, message };
  }
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let command: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.set(name, true);
      } else {
        flags.set(name, next);
        i += 1;
      }
      continue;
    }
    if (command === undefined) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  const globals: ParsedArgs["globals"] = { help };
  const databaseFlag = flags.get("database");
  if (typeof databaseFlag === "string") {
    globals.databasePath = databaseFlag;
    flags.delete("database");
  }
  if (flags.get("json") === true) {
    globals.json = true;
    flags.delete("json");
  }
  if (flags.get("dry-run") === true) {
    globals.dryRun = true;
    flags.delete("dry-run");
  }
  const idempotencyFlag = flags.get("idempotency-key");
  if (typeof idempotencyFlag === "string") {
    globals.idempotencyKey = idempotencyFlag;
    flags.delete("idempotency-key");
  }
  const versionFlag = flags.get("expected-version");
  if (typeof versionFlag === "string") {
    const parsed = Number(versionFlag);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error("--expected-version must be a positive integer");
    }
    globals.expectedVersion = parsed;
    flags.delete("expected-version");
  }
  const actorKind = flags.get("actor-kind");
  if (typeof actorKind === "string") {
    if (actorKind !== "human" && actorKind !== "agent") {
      throw new Error("--actor-kind must be human or agent");
    }
    globals.actorKind = actorKind;
    flags.delete("actor-kind");
  }
  const actorLabel = flags.get("actor-label");
  if (typeof actorLabel === "string") {
    globals.actorLabel = actorLabel;
    flags.delete("actor-label");
  }

  return { command, positionals, flags, globals };
}

function stringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function integerFlag(flags: Map<string, string | boolean>, name: string, min: number, max: number): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function repeatableFlag(flags: Map<string, string | boolean>, argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}` && typeof argv[i + 1] === "string" && !(argv[i + 1] as string).startsWith("--")) {
      values.push(argv[i + 1] as string);
    }
  }
  const single = flags.get(name);
  if (typeof single === "string" && !values.includes(single)) {
    values.push(single);
  }
  return values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

function ensureNoUnknownFlags(flags: Map<string, string | boolean>, allowed: string[]): void {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) {
      throw new Error(`unknown option --${name}`);
    }
  }
}

function currentVersion(databasePath: string, taskId: string, globals: GlobalOptions): number {
  const result = executeCommand(
    {
      version: VERSION,
      requestId: randomUUID(),
      command: "task.get",
      args: { id: taskId },
      actor: { kind: globals.actorKind, label: globals.actorLabel },
    },
    databasePath,
  );
  const task = (result as { task: TaskRecord }).task;
  if (!task || typeof task.version !== "number") {
    throw new Error(`task ${taskId} was not found`);
  }
  return task.version;
}

function runCommand(protocolCommand: string, args: Record<string, unknown>, globals: GlobalOptions): Record<string, unknown> {
  const request: ProtocolRequest = {
    version: VERSION,
    requestId: randomUUID(),
    command: protocolCommand as ProtocolRequest["command"],
    args,
    actor: { kind: globals.actorKind, label: globals.actorLabel },
    readOnly: undefined,
    dryRun: globals.dryRun || undefined,
  };
  if (MUTATION_COMMANDS.has(protocolCommand)) {
    request.idempotencyKey = globals.idempotencyKey ?? randomUUID();
  }
  if (VERSIONED_COMMANDS.has(protocolCommand) && globals.expectedVersion !== undefined) {
    request.args = { ...args, expectedVersion: globals.expectedVersion };
  }
  return executeCommand(request, globals.databasePath);
}

function runVersioned(protocolCommand: string, taskId: string, extraArgs: Record<string, unknown>, globals: GlobalOptions): Record<string, unknown> {
  const expectedVersion = globals.expectedVersion ?? currentVersion(globals.databasePath, taskId, globals);
  return runCommand(protocolCommand, { id: taskId, expectedVersion, ...extraArgs }, { ...globals, expectedVersion });
}

function formatTask(task: TaskRecord): string {
  const bits = [`${task.id.slice(0, 8)}`, `[${task.status}]`, task.title];
  bits.push(`(p${task.priority})`);
  if (task.category) bits.push(`@${task.category.slug}`);
  for (const tag of task.tags) bits.push(`#${tag.slug}`);
  if (task.blockedByIds.length > 0) bits.push(`blocked-by:${task.blockedByIds.length}`);
  bits.push(`v${task.version}`);
  return bits.join(" ");
}

function formatTaskDetail(task: TaskRecord): string {
  const lines = [
    `${task.id} [${task.status}] v${task.version}`,
    `title: ${task.title}`,
    `priority: ${task.priority}`,
  ];
  if (task.category) lines.push(`category: @${task.category.slug}`);
  if (task.tags.length > 0) lines.push(`tags: ${task.tags.map((tag) => `#${tag.slug}`).join(" ")}`);
  if (task.parentId) lines.push(`parent: ${task.parentId}`);
  if (task.dependencyIds.length > 0) lines.push(`depends-on: ${task.dependencyIds.join(", ")}`);
  if (task.blockedByIds.length > 0) lines.push(`blocked-by: ${task.blockedByIds.join(", ")}`);
  if (task.descriptionMarkdown) lines.push(`---\n${task.descriptionMarkdown}`);
  lines.push(`created: ${task.createdAt} updated: ${task.updatedAt}`);
  return lines.join("\n");
}

function printResult(command: string, result: Record<string, unknown>, globals: GlobalOptions): void {
  if (globals.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if ("tasks" in result && Array.isArray(result.tasks)) {
    const tasks = result.tasks as TaskRecord[];
    if (tasks.length === 0) {
      process.stdout.write("No tasks.\n");
    } else {
      for (const task of tasks) process.stdout.write(`${formatTask(task)}\n`);
    }
    if (typeof result.total === "number") {
      process.stdout.write(`(${tasks.length} of ${result.total})\n`);
    }
    return;
  }
  if ("task" in result && result.task !== undefined) {
    process.stdout.write(`${formatTaskDetail(result.task as TaskRecord)}\n`);
    return;
  }
  if ("activity" in result && Array.isArray(result.activity)) {
    const entries = result.activity as Array<{ seq: number; taskId: string; action: string; actor: { label: string }; createdAt: string }>;
    if (entries.length === 0) {
      process.stdout.write("No activity.\n");
    } else {
      for (const entry of entries) {
        process.stdout.write(`#${entry.seq} ${entry.createdAt} ${entry.taskId.slice(0, 8)} ${entry.action} (${entry.actor.label})\n`);
      }
    }
    return;
  }
  if (command === "categories" && Array.isArray((result as { categories: unknown }).categories)) {
    const categories = (result as { categories: Array<{ slug: string; label: string; taskCount: number }> }).categories;
    if (categories.length === 0) process.stdout.write("No categories.\n");
    for (const category of categories) process.stdout.write(`@${category.slug} (${category.taskCount})\n`);
    return;
  }
  if (command === "tags" && Array.isArray((result as { tags: unknown }).tags)) {
    const tags = (result as { tags: Array<{ slug: string; label: string; taskCount: number }> }).tags;
    if (tags.length === 0) process.stdout.write("No tags.\n");
    for (const tag of tags) process.stdout.write(`#${tag.slug} (${tag.taskCount})\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const LIST_FLAGS = ["status", "priority", "category", "tag", "search", "limit", "offset", "sort", "direction", "unblocked", "include-ancestors"];

function handleList(argv: string[], parsed: ParsedArgs, globals: GlobalOptions): void {
  ensureNoUnknownFlags(parsed.flags, LIST_FLAGS);
  const args: Record<string, unknown> = {};
  const statuses = repeatableFlag(parsed.flags, argv, "status");
  if (statuses.length > 0) args.status = statuses;
  const priority = integerFlag(parsed.flags, "priority", 0, 4);
  if (priority !== undefined) args.priority = priority;
  const category = stringFlag(parsed.flags, "category");
  if (category !== undefined) args.category = category;
  const tags = repeatableFlag(parsed.flags, argv, "tag");
  if (tags.length > 0) args.tags = tags;
  const search = stringFlag(parsed.flags, "search") ?? (parsed.positionals.length > 0 ? parsed.positionals.join(" ") : undefined);
  if (search !== undefined) args.search = search;
  const limit = integerFlag(parsed.flags, "limit", 1, 100);
  if (limit !== undefined) args.limit = limit;
  const offset = integerFlag(parsed.flags, "offset", 0, 1000000);
  if (offset !== undefined) args.offset = offset;
  const sort = stringFlag(parsed.flags, "sort");
  if (sort !== undefined) args.sort = sort;
  const direction = stringFlag(parsed.flags, "direction");
  if (direction !== undefined) args.direction = direction;
  if (parsed.flags.get("unblocked") === true) args.unblocked = true;
  if (parsed.flags.get("include-ancestors") === true) args.includeAncestors = true;
  printResult("list", runCommand("task.list", args, globals), globals);
}

function main(): void {
  const raw = process.argv.slice(2);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgv(raw);
  } catch (error) {
    process.stderr.write(`tasks-cli: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const globals: GlobalOptions = {
    databasePath: parsed.globals.databasePath ?? process.env.TASKS_DATABASE_PATH ?? getDatabasePath(),
    json: parsed.globals.json ?? false,
    dryRun: parsed.globals.dryRun ?? false,
    idempotencyKey: parsed.globals.idempotencyKey,
    expectedVersion: parsed.globals.expectedVersion,
    actorKind: parsed.globals.actorKind ?? "agent",
    actorLabel: parsed.globals.actorLabel ?? "tasks-cli",
  };

  if (parsed.command === undefined) {
    if (parsed.globals.help) {
      process.stdout.write(usage());
      return;
    }
    process.stderr.write("tasks-cli: no command given. Run `tasks-cli --help` for a quickstart.\n");
    process.exitCode = 2;
    return;
  }
  if (parsed.globals.help) {
    process.stdout.write(usage());
    return;
  }

  try {
    const command = parsed.command;
    switch (command) {
      case "list": {
        handleList(raw, parsed, globals);
        break;
      }
      case "show": {
        ensureNoUnknownFlags(parsed.flags, []);
        const id = parsed.positionals[0];
        if (!id || parsed.positionals.length !== 1) throw new Error("usage: tasks-cli show <id>");
        printResult("show", runCommand("task.get", { id }, globals), globals);
        break;
      }
      case "add": {
        ensureNoUnknownFlags(parsed.flags, ["description", "priority", "parent"]);
        if (parsed.positionals.length === 0) throw new Error("usage: tasks-cli add <title...> [--description text]");
        const args: Record<string, unknown> = { title: parsed.positionals.join(" ") };
        const description = stringFlag(parsed.flags, "description");
        if (description !== undefined) args.descriptionMarkdown = description;
        const priority = integerFlag(parsed.flags, "priority", 0, 4);
        if (priority !== undefined) args.priority = priority;
        const parent = stringFlag(parsed.flags, "parent");
        if (parent !== undefined) args.parentId = parent;
        printResult("add", runCommand("task.create", args, globals), globals);
        break;
      }
      case "update": {
        ensureNoUnknownFlags(parsed.flags, ["title", "description", "priority"]);
        const id = parsed.positionals[0];
        if (!id || parsed.positionals.length !== 1) throw new Error("usage: tasks-cli update <id> [--title text]");
        const extra: Record<string, unknown> = {};
        const title = stringFlag(parsed.flags, "title");
        if (title !== undefined) extra.title = title;
        const description = stringFlag(parsed.flags, "description");
        if (description !== undefined) extra.descriptionMarkdown = description;
        const priority = integerFlag(parsed.flags, "priority", 0, 4);
        if (priority !== undefined) extra.priority = priority;
        if (Object.keys(extra).length === 0) throw new Error("nothing to update: pass --title, --description, or --priority");
        printResult("update", runVersioned("task.update", id, extra, globals), globals);
        break;
      }
      case "start":
      case "pause":
      case "complete":
      case "reopen":
      case "cancel":
      case "delete": {
        ensureNoUnknownFlags(parsed.flags, []);
        const id = parsed.positionals[0];
        if (!id || parsed.positionals.length !== 1) throw new Error(`usage: tasks-cli ${command} <id>`);
        printResult(command, runVersioned(`task.${command}`, id, {}, globals), globals);
        break;
      }
      case "undo": {
        ensureNoUnknownFlags(parsed.flags, []);
        const id = parsed.positionals[0];
        if (!id || parsed.positionals.length !== 1) throw new Error("usage: tasks-cli undo <id>");
        printResult(command, runVersioned("task.status.undo", id, {}, globals), globals);
        break;
      }
      case "move": {
        ensureNoUnknownFlags(parsed.flags, ["parent", "root"]);
        const id = parsed.positionals[0];
        if (!id || parsed.positionals.length !== 1) throw new Error("usage: tasks-cli move <id> --parent <id> | --root");
        const parent = stringFlag(parsed.flags, "parent");
        const root = parsed.flags.get("root") === true;
        if ((parent === undefined) === !root) throw new Error("usage: tasks-cli move <id> --parent <id> | --root");
        printResult(command, runVersioned("task.move", id, { parentId: root ? null : parent }, globals), globals);
        break;
      }
      case "dep-add":
      case "dep-remove": {
        ensureNoUnknownFlags(parsed.flags, []);
        const [id, dependsOnId] = parsed.positionals;
        if (!id || !dependsOnId || parsed.positionals.length !== 2) {
          throw new Error(`usage: tasks-cli ${command} <id> <depends-on-id>`);
        }
        const protocolCommand = command === "dep-add" ? "task.dependency.add" : "task.dependency.remove";
        printResult(command, runVersioned(protocolCommand, id, { dependsOnId }, globals), globals);
        break;
      }
      case "activity": {
        ensureNoUnknownFlags(parsed.flags, ["task", "limit"]);
        const args: Record<string, unknown> = {};
        const task = stringFlag(parsed.flags, "task");
        if (task !== undefined) args.taskId = task;
        const limit = integerFlag(parsed.flags, "limit", 1, 100);
        if (limit !== undefined) args.limit = limit;
        printResult("activity", runCommand("activity.list", args, globals), globals);
        break;
      }
      case "categories": {
        ensureNoUnknownFlags(parsed.flags, []);
        printResult("categories", runCommand("category.list", {}, globals), globals);
        break;
      }
      case "tags": {
        ensureNoUnknownFlags(parsed.flags, []);
        printResult("tags", runCommand("tag.list", {}, globals), globals);
        break;
      }
      case "info": {
        ensureNoUnknownFlags(parsed.flags, []);
        printResult("info", runCommand("workspace.info", {}, globals), globals);
        break;
      }
      default:
        throw new Error(`unknown command "${command}". Run tasks-cli --help.`);
    }
  } catch (error) {
    const { code, message } = errorMessage(error);
    if (globals.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`tasks-cli: ${code}: ${message}\n`);
    }
    process.exitCode = code === "STALE_TASK_VERSION" ? 3 : 1;
  }
}

main();
