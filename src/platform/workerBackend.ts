import type { BackendCommand } from "./backendSession";

/** Where the web build keeps its Tasks home, inside the worker's in-memory files. */
export const WEB_HOME = "/Tasks";
/** Sent both ways: asks the worker to finish saving, then confirms it has. */
export const CLOSE_MESSAGE = "close";

type Listeners = {
  data: (data: string) => void;
  error: (message: string) => void;
};

/** Runs the backend in a Web Worker, the web build's stand-in for the desktop sidecar. */
export function workerBackend(): BackendCommand {
  const listeners: Listeners = { data: () => {}, error: () => {} };
  return {
    stdout: {
      on: (_event, listener) => {
        listeners.data = listener as Listeners["data"];
      },
    },
    on: (event: "error" | "close", listener: unknown) => {
      if (event === "error") listeners.error = listener as Listeners["error"];
    },
    spawn() {
      const worker = new Worker(new URL("../web/backendWorker.ts", import.meta.url), {
        type: "module",
      });
      let markClosed = () => {};
      const closed = new Promise<void>((resolve) => (markClosed = resolve));
      worker.onmessage = ({ data }: MessageEvent<string>) => {
        if (data === CLOSE_MESSAGE) markClosed();
        else listeners.data(data);
      };
      // A failed worker has closed itself and has nothing left to save.
      worker.onerror = (event) => {
        markClosed();
        listeners.error(event.message);
      };
      return Promise.resolve({
        write: (data) => Promise.resolve(worker.postMessage(data)),
        async kill() {
          worker.postMessage(CLOSE_MESSAGE);
          await closed;
          worker.terminate();
        },
      });
    },
  };
}
