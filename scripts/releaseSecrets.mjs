import os from "node:os";
import path from "node:path";
import process from "node:process";

// Every release secret lives in this one folder outside the repo, so backing it up or restoring it
// is one step; its README.md says what each file is. See docs/development.md.
export const releaseSecrets = path.join(
  process.env.DATA ?? path.join(os.homedir(), "data"),
  "secrets/tasks",
);
