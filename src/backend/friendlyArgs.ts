import path from "node:path";
import { CommandError } from "./errors.js";
import { localToday, parseDueWord } from "./dueDate.js";
import { parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";

const VALUE_FLAGS = new Set([
  "home",
  "root",
  "database",
  "write-context",
  "idempotency-key",
  "expected-version",
  "request-hash",
  "actor-kind",
  "actor-label",
  "title",
  "text",
  "description",
  "priority",
  "parent",
  "category",
  "tag",
  "due",
  "status",
  "search",
  "limit",
  "offset",
  "sort",
  "direction",
  "task",
]);
const BOOLEAN_FLAGS = new Set([
  "json",
  "dry-run",
  "read-only",
  "help",
  "no-parent",
  "clear-category",
  "clear-tags",
  "clear-due",
  "uncategorized",
  "unblocked",
  "include-ancestors",
]);
const GLOBAL_FLAGS = [
  "home",
  "root",
  "database",
  "write-context",
  "idempotency-key",
  "expected-version",
  "request-hash",
  "actor-kind",
  "actor-label",
  "json",
  "dry-run",
  "read-only",
  "help",
];
const VERSIONED_COMMANDS = new Set([
  "task.update",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.delete",
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
]);
type Flags = Map<string, (string | true)[]>;
export class HumanUsageError extends CommandError {
  constructor(message: string) {
    super("INVALID_ARGUMENT", message);
  }
}
function usage(message: string): never {
  throw new HumanUsageError(message);
}
/** A home (the documented form) or a bare folder and cache, which tests and conversion use. */
type HumanTarget = { homePath: string } | { rootPath: string; cachePath: string };
export type HumanInvocation = {
  help: false;
  target: HumanTarget;
  json: boolean;
  requestHash?: string;
  request: Request;
  mutation: boolean;
  versioned: boolean;
  /** `attach` writes this image first, then lists it with the prepared `task.update`. */
  attachFile?: string;
};
export type HumanArgs = HumanInvocation | { help: true; json: boolean };

/** Index of an actual --NAME option. A flag value or a word after -- never counts. */
export function humanOptionIndex(argv: readonly string[], name: string): number {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--") return -1;
    if (token === `--${name}` || token.startsWith(`--${name}=`)) return index;
    if (token.startsWith("--") && !token.includes("=") && VALUE_FLAGS.has(token.slice(2))) index++;
  }
  return -1;
}
function tokenize(argv: string[]): { flags: Flags; words: string[] } {
  const flags: Flags = new Map(),
    words: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--") {
      words.push(...argv.slice(index + 1));
      break;
    }
    if (token === "-h") {
      flags.set("help", [true]);
      continue;
    }
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    const equal = token.indexOf("="),
      name = token.slice(2, equal < 0 ? undefined : equal);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name))
      usage("unrecognized option; use --help for supported flags");
    if (flags.has(name) && name !== "tag" && name !== "status")
      usage(`--${name} may only be supplied once`);
    let supplied: string | true;
    if (VALUE_FLAGS.has(name)) {
      const text = equal < 0 ? argv[++index] : token.slice(equal + 1);
      if (text === undefined) usage(`--${name} requires a value`);
      supplied = text;
    } else {
      if (equal >= 0) usage(`--${name} does not take a value`);
      supplied = true;
    }
    flags.set(name, [...(flags.get(name) ?? []), supplied]);
  }
  return { flags, words };
}
function value(flags: Flags, name: string): string | undefined {
  return flags.get(name)?.[0] as string | undefined;
}
function integer(
  flags: Flags,
  name: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const raw = value(flags, name);
  if (raw === undefined) return undefined;
  const number = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(number) || number < min || number > max)
    usage(`--${name} requires an in-range safe integer`);
  return number;
}
function requirePositionals(words: string[], n: number, verb: string): void {
  if (words.length !== n) usage(`wrong arguments for ${verb}; use --help`);
}
function directoryArgument(text: string): string {
  if (!text.trim()) usage("directory arguments must be explicit and nonempty");
  return path.resolve(text);
}
function classification(flags: Flags, args: Record<string, unknown>): void {
  if (flags.has("category") && flags.has("clear-category"))
    usage("choose --category or --clear-category, not both");
  if (flags.has("tag") && flags.has("clear-tags")) usage("choose --tag or --clear-tags, not both");
  if (flags.has("category")) args.category = value(flags, "category");
  else if (flags.has("clear-category")) args.category = null;
  if (flags.has("tag")) args.tags = flags.get("tag");
  else if (flags.has("clear-tags")) args.tags = [];
}
function dueDate(flags: Flags, args: Record<string, unknown>): void {
  if (flags.has("due") && flags.has("clear-due")) usage("choose --due or --clear-due, not both");
  if (flags.has("clear-due")) args.due = null;
  if (!flags.has("due")) return;
  const due = parseDueWord(value(flags, "due")!, localToday());
  if (due === null) usage("--due takes a date such as 2026-10-31, today, tmr, fri, 3d or oct31");
  args.due = due;
}
function content(flags: Flags, args: Record<string, unknown>): void {
  if (flags.has("title") && flags.has("text"))
    usage("choose literal --title or shorthand --text, not both");
  if (
    flags.has("text") &&
    ["category", "clear-category", "tag", "clear-tags", "due", "clear-due"].some((name) =>
      flags.has(name),
    )
  )
    usage("shorthand --text cannot mix with classification or due overrides");
  for (const field of ["title", "text", "description"])
    if (flags.has(field)) args[field] = value(flags, field);
  const priority = integer(flags, "priority", 0, 4);
  if (priority !== undefined) args.priority = priority;
  classification(flags, args);
  dueDate(flags, args);
}
export function parseHumanArgs(argv: string[]): HumanArgs {
  const { flags, words } = tokenize(argv),
    [verb, ...positionals] = words;
  if (flags.has("help")) return { help: true, json: flags.has("json") };
  const homePath = value(flags, "home"),
    rootPath = value(flags, "root"),
    cachePath = value(flags, "database");
  if (homePath !== undefined && (rootPath !== undefined || cachePath !== undefined))
    usage("--home already selects the folder and cache; don't add --root or --database");
  if (!homePath?.trim() && (!rootPath?.trim() || !cachePath?.trim()))
    usage("tasks-cli requires explicit --home PATH; there is no default home");
  if (!verb) usage("no command; use tasks-cli --home PATH --help");
  let command: string,
    allowed: string[] = [],
    mutation = true,
    attachFile: string | undefined;
  const args: Record<string, unknown> = {};
  switch (verb) {
    case "list": {
      command = "task.list";
      mutation = false;
      allowed = [
        "status",
        "priority",
        "category",
        "uncategorized",
        "tag",
        "search",
        "limit",
        "offset",
        "sort",
        "direction",
        "unblocked",
        "include-ancestors",
      ];
      if (flags.has("search") && positionals.length)
        usage("choose --search or positional search, not both");
      if (flags.has("status"))
        args.status = (flags.get("status") as string[])
          .flatMap((text) => text.split(","))
          .map((text) => text.trim());
      for (const name of ["category", "search", "sort", "direction"])
        if (flags.has(name)) args[name] = value(flags, name);
      if (flags.has("category") && flags.has("uncategorized"))
        usage("choose --category or --uncategorized");
      if (flags.has("uncategorized")) args.categoryIsNull = true;
      if (flags.has("tag")) args.tags = flags.get("tag");
      for (const name of ["limit", "offset", "priority"]) {
        const n = integer(flags, name, 0, name === "priority" ? 4 : Number.MAX_SAFE_INTEGER);
        if (n !== undefined) args[name] = n;
      }
      if (positionals.length) args.search = positionals.join(" ");
      if (flags.has("unblocked")) args.unblocked = true;
      if (flags.has("include-ancestors")) args.includeAncestors = true;
      break;
    }
    case "show":
      command = "task.get";
      mutation = false;
      requirePositionals(positionals, 1, verb);
      args.id = positionals[0];
      break;
    case "add": {
      command = "task.create";
      allowed = [
        "title",
        "text",
        "description",
        "priority",
        "parent",
        "category",
        "clear-category",
        "tag",
        "clear-tags",
        "due",
        "clear-due",
      ];
      if (positionals.length && (flags.has("title") || flags.has("text")))
        usage("choose positional shorthand or explicit --title/--text");
      if (positionals.length) args.text = positionals.join(" ");
      if (!positionals.length && !flags.has("title") && !flags.has("text"))
        usage("add needs positional shorthand, --text or literal --title");
      content(flags, args);
      if ("text" in args && ["category", "tags", "due"].some((name) => name in args))
        usage("positional shorthand cannot mix with classification or due overrides");
      if (flags.has("parent")) args.parentId = value(flags, "parent");
      break;
    }
    case "update":
      command = "task.update";
      allowed = [
        "title",
        "text",
        "description",
        "priority",
        "category",
        "clear-category",
        "tag",
        "clear-tags",
        "due",
        "clear-due",
      ];
      requirePositionals(positionals, 1, verb);
      content(flags, args);
      if (!Object.keys(args).length) usage("nothing to update");
      args.id = positionals[0];
      break;
    case "start":
    case "pause":
    case "complete":
    case "reopen":
    case "cancel":
    case "delete":
      command = `task.${verb}`;
      requirePositionals(positionals, 1, verb);
      args.id = positionals[0];
      break;
    case "undo":
      command = "task.status.undo";
      requirePositionals(positionals, 1, verb);
      args.id = positionals[0];
      break;
    case "undo-operation":
    case "redo-operation":
      command = verb === "redo-operation" ? "operation.redo" : "operation.undo";
      requirePositionals(positionals, 1, verb);
      args.operationId = positionals[0];
      break;
    case "move":
      command = "task.move";
      allowed = ["parent", "no-parent"];
      requirePositionals(positionals, 1, verb);
      if (flags.has("parent") === flags.has("no-parent"))
        usage("move needs exactly --parent ID or --no-parent");
      args.id = positionals[0];
      args.parentId = flags.has("no-parent") ? null : value(flags, "parent");
      break;
    case "dep-add":
    case "dep-remove":
      command = verb === "dep-add" ? "task.dependency.add" : "task.dependency.remove";
      requirePositionals(positionals, 2, verb);
      args.id = positionals[0];
      args.dependsOnId = positionals[1];
      break;
    case "attach":
      command = "task.update";
      requirePositionals(positionals, 2, verb);
      // Two requests can't share one set of retry options.
      if (
        [
          "write-context",
          "idempotency-key",
          "expected-version",
          "request-hash",
          "dry-run",
          "read-only",
        ].some((name) => flags.has(name))
      )
        usage("attach takes no retry or preview options");
      args.id = positionals[0];
      attachFile = path.resolve(positionals[1]);
      break;
    case "purge-canceled":
      command = "task.purgeCanceled";
      requirePositionals(positionals, 0, verb);
      break;
    case "activity":
      command = "activity.list";
      mutation = false;
      allowed = ["task", "limit"];
      requirePositionals(positionals, 0, verb);
      if (flags.has("task")) args.taskId = value(flags, "task");
      if (flags.has("limit")) args.limit = integer(flags, "limit", 0);
      break;
    case "categories":
    case "tags":
    case "info":
      command = verb === "info" ? "workspace.info" : verb === "tags" ? "tag.list" : "category.list";
      mutation = false;
      requirePositionals(positionals, 0, verb);
      break;
    case "init":
    case "rebuild":
      command = `workspace.${verb}`;
      requirePositionals(positionals, 0, verb);
      break;
    case "migrate":
      command = "workspace.migrate";
      requirePositionals(positionals, 1, verb);
      args.destinationDirectory = directoryArgument(positionals[0]);
      break;
    case "recover":
      command = "workspace.recovery.resume";
      requirePositionals(positionals, 1, verb);
      args.operationId = positionals[0];
      break;
    case "rebind":
    case "new-history":
      command = verb === "rebind" ? "workspace.rebind" : "workspace.newHistory";
      requirePositionals(positionals, 0, verb);
      mutation = false;
      break;
    default:
      usage("unknown command; use --help or the documented JSON-lines advanced controls");
  }
  for (const name of flags.keys())
    if (!GLOBAL_FLAGS.includes(name) && !allowed.includes(name))
      usage(`--${name} is not allowed for ${verb}`);
  if (
    !mutation &&
    ["write-context", "idempotency-key", "expected-version", "request-hash"].some((name) =>
      flags.has(name),
    )
  )
    usage("retry authority options require a mutation");
  if (!VERSIONED_COMMANDS.has(command) && flags.has("expected-version"))
    usage("--expected-version requires an existing-task mutation");
  const actorKind = value(flags, "actor-kind") ?? "agent";
  if (!["human", "agent"].includes(actorKind)) usage("--actor-kind must be human or agent");
  const expectedVersion = integer(flags, "expected-version", 1);
  if (expectedVersion !== undefined) args.expectedVersion = expectedVersion;
  const request = parseRequest({
    version: 2,
    command,
    args,
    actor: { kind: actorKind, label: value(flags, "actor-label") ?? "tasks-cli" },
    writeContext: value(flags, "write-context"),
    idempotencyKey: value(flags, "idempotency-key"),
    dryRun: flags.has("dry-run"),
    readOnly: flags.has("read-only"),
  });
  const requestHash = value(flags, "request-hash");
  if (requestHash !== undefined && !/^[0-9a-f]{64}$/.test(requestHash))
    usage("--request-hash requires the retained SHA-256 hash");
  return {
    help: false,
    target: homePath?.trim()
      ? { homePath: path.resolve(homePath) }
      : { rootPath: path.resolve(rootPath!), cachePath: path.resolve(cachePath!) },
    json: flags.has("json"),
    requestHash,
    request,
    mutation,
    versioned: VERSIONED_COMMANDS.has(command),
    ...(attachFile === undefined ? {} : { attachFile }),
  };
}
export function humanUsage(): string {
  return `tasks-cli: work with one explicitly selected workspace folder

  tasks-cli --home PATH COMMAND [OPTIONS]
  PATH is a Tasks home: its sync folder holds the tasks, and the CLI keeps its own
  cache in its local folder. No environment, registry or default home.
  Pause other writers/sharing before destructive work.

QUERIES
  info | list [SEARCH] | show ID | categories | tags
  activity [--task ID] [--limit N]
  list: --status STATUS (repeat/comma), --priority 0..4, --category SLUG,
        --uncategorized, --tag SLUG (repeat), --search TEXT, --unblocked,
        --limit N, --offset N, --sort created|updated|priority|due|closed|manual,
        --direction asc|desc (not manual), --include-ancestors

WRITES
  add TEXT... | add --title LITERAL | add --text SHORTHAND
  update ID [--title LITERAL | --text SHORTHAND]
    content flags: --description TEXT, --priority 0..4, --category SLUG,
                   --clear-category, --tag SLUG (repeat), --clear-tags,
                   --due DATE (2026-10-31, today, tmr, fri, 3d, 2w, oct31), --clear-due
    add also allows --parent ID. Shorthand (^fri sets the due date) cannot mix
    classification or due overrides.
  start|pause|complete|reopen|cancel|delete|undo ID
  undo-operation OPERATION_ID | redo-operation UNDO_OPERATION_ID | purge-canceled
  move ID --parent ID | move ID --no-parent
  dep-add ID BLOCKER_ID | dep-remove ID BLOCKER_ID
  attach ID FILE (a PNG, JPEG, WebP or GIF image; show prints image paths)
  init (creates the home) | rebuild
  recover OPERATION_ID
  rebind: keep history after the home moved | new-history: set aside a cache that
  came with a copy of the home and start a new history here
  Old-version folders are converted with pnpm migrate.
  Ordering, batches, doctor, removing attachments and deleting done tasks remain
  advanced JSON-lines controls, not new verbs.

OUTPUT AND RETRIES
  --json prints result/error only. --dry-run / --read-only previews never execute.
  --actor-kind human|agent (default agent), --actor-label LABEL (default tasks-cli)
  First calls may fetch context/version and generate a key. Before an executing
  write, stderr synchronously reports retry metadata without task payload text.
  Record that line and retain the exact original arguments and home.
  Stable --idempotency-key KEY requires original --write-context CONTEXT and,
  for existing-task writes, --expected-version N. No automatic refresh/retry.
  --request-hash HASH verifies the retained request and selected home before
  dispatch. Reuse the original directory arguments and working directory.
  New keys after uncertain replies can duplicate effects. Inspect pending work;
  recover explicitly with fresh recovery authority, never silently reissue it.

EXIT: 0 success, 1 protocol/storage error, 2 CLI usage, 3 stale task version.
      Stale authority or version is not permission to refresh an uncertain retry.
`;
}
