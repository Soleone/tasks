import { executeLine } from "./gateway.js";
import type { Response } from "./protocol.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeResponse(response: Response): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function runStdio(rootPath: string, cachePath: string): Promise<void> {
  let buffered = Buffer.alloc(0);
  const respond = (line: Buffer): void => {
    if (line.every((byte) => byte === 0x20 || byte === 0x09 || byte === 0x0d)) return;
    writeResponse(executeLine(line, rootPath, cachePath));
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootPath = optionValue(args, "--root");
  const cachePath = optionValue(args, "--database");
  if (
    !args.includes("--stdio") ||
    !rootPath?.trim() ||
    !cachePath?.trim() ||
    rootPath.startsWith("--") ||
    cachePath.startsWith("--")
  ) {
    process.stderr.write(
      "Usage: tasks-backend --stdio --root PATH --database CACHE_OUTSIDE_ROOT\n",
    );
    process.exitCode = 2;
    return;
  }
  await runStdio(rootPath, cachePath);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
