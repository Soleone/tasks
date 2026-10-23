import { executeLine } from "./gateway.js";
import { executeHomeLine } from "./homeGateway.js";
import type { Response } from "./protocol.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeResponse(response: Response): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function runStdio(execute: (line: Buffer) => Response): Promise<void> {
  let buffered = Buffer.alloc(0);
  const respond = (line: Buffer): void => {
    if (line.every((byte) => byte === 0x20 || byte === 0x09 || byte === 0x0d)) return;
    writeResponse(execute(line));
  };
  // Frame bytes before UTF-8 decoding so invalid input cannot become replacement characters.
  for await (const chunk of process.stdin) {
    buffered = Buffer.concat([buffered, chunk as Buffer]);
    let newline: number;
    while ((newline = buffered.indexOf(0x0a)) !== -1) {
      respond(buffered.subarray(0, newline));
      buffered = buffered.subarray(newline + 1);
    }
  }
  if (buffered.length > 0) respond(buffered);
}

function given(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "" && !value.startsWith("--");
}

/**
 * The app runs `--home PATH --client app`. `--root` and `--database` select a bare folder and cache
 * for tests and the old-folder conversion; they can't be mixed with a home.
 */
export async function runJsonLinesCli(args: string[]): Promise<void> {
  const homePath = optionValue(args, "--home");
  const client = optionValue(args, "--client");
  const rootPath = optionValue(args, "--root");
  const cachePath = optionValue(args, "--database");
  const homeForm = given(homePath) && (client === "app" || client === "cli");
  const folderForm = given(rootPath) && given(cachePath);
  if (
    !args.includes("--stdio") ||
    homeForm === folderForm ||
    (homeForm && (rootPath || cachePath))
  ) {
    process.stderr.write(
      "Usage: tasks-cli --stdio --home PATH --client app|cli\n" +
        "       tasks-cli --stdio --root PATH --database CACHE_OUTSIDE_ROOT\n",
    );
    process.exitCode = 2;
    return;
  }
  await runStdio((line) =>
    homeForm
      ? executeHomeLine(line, homePath!, client as "app" | "cli")
      : executeLine(line, rootPath!, cachePath!),
  );
}
