import type { BackendCommand } from "@/platform/backendSession";
import { workerBackend } from "./workerBackend";

/** The iOS app's backend for a Tasks home, which its worker learns from its name. */
export function iosBackend(home: string): BackendCommand {
  return workerBackend(
    () => new Worker(new URL("./iosWorker.ts", import.meta.url), { type: "module", name: home }),
  );
}
