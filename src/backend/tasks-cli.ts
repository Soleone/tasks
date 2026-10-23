import { runHumanCli } from "./friendlyCli.js";
import { runJsonLinesCli } from "./jsonLinesCli.js";

// One executable for the app and agents: `--stdio` speaks JSON lines, anything else is a verb.
const args = process.argv.slice(2);
if (args.includes("--stdio")) {
  runJsonLinesCli(args).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  runHumanCli(args);
}
