import { Channel, invoke } from "@tauri-apps/api/core";
import type { BackendCommand } from "./backendSession";

type BackendEvent =
  | { event: "stdout"; data: string }
  | { event: "error"; data: string }
  | { event: "close"; data: { code: number | null } };

type Listeners = {
  data: (data: string) => void;
  error: (message: string) => void;
  close: (payload: { code: number | null; signal: number | null }) => void;
};

/** Starts the backend through the Android shell, which runs it from the app's native library folder. */
export function androidBackend(root: string, database: string): BackendCommand {
  const listeners: Listeners = { data: () => {}, error: () => {}, close: () => {} };
  return {
    stdout: {
      on: (_event, listener) => {
        listeners.data = listener;
      },
    },
    on: (event: "error" | "close", listener: Listeners["error"] | Listeners["close"]) => {
      if (event === "error") listeners.error = listener as Listeners["error"];
      else listeners.close = listener as Listeners["close"];
    },
    async spawn() {
      const events = new Channel<BackendEvent>((message) => {
        if (message.event === "stdout") listeners.data(message.data);
        else if (message.event === "error") listeners.error(message.data);
        else listeners.close({ code: message.data.code, signal: null });
      });
      const pid = await invoke<number>("backend_start", { root, database, events });
      return {
        write: (data) => invoke("backend_write", { pid, data }),
        kill: () => invoke("backend_kill", { pid }),
      };
    },
  };
}
