import process from "node:process";
import release from "release-it";

// release-it bumps, writes the changelog and pushes the tag. Actions builds and publishes it.
// release-it has already printed the reason when it rejects.
await release({ "dry-run": process.argv.includes("--dry-run") }).catch(() => {
  process.exitCode = 1;
});
