import {
  parseResponse,
  type ProtocolRequest,
  type ProtocolResponse,
} from "../backend/protocol";
import { BackendSession } from "./backendSession";
import { handleAndroidRequest } from "./androidBackendEngine";
import { runtimeKind, type RuntimeKind } from "./runtime";

type BackendKind = RuntimeKind;

function backendKind(): BackendKind {
  return runtimeKind();
}

export interface BackendTransport {
  request(request: ProtocolRequest): Promise<ProtocolResponse>;
  close(): Promise<void>;
}

function devBackendUrl(): string {
  const configured = import.meta.env.VITE_DEV_BACKEND_URL as string | undefined;
  return (configured ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
}

class TauriBackendTransport implements BackendTransport {
  private readonly session = new BackendSession();

  request(request: ProtocolRequest): Promise<ProtocolResponse> {
    return this.session.request(request);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}

class AndroidBackendTransport implements BackendTransport {
  private queue: Promise<void> = Promise.resolve();

  request(request: ProtocolRequest): Promise<ProtocolResponse> {
    const next = this.queue.then(() => handleAndroidRequest(request));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async close(): Promise<void> {
    await this.queue;
  }
}

class HttpBackendTransport implements BackendTransport {
  async request(request: ProtocolRequest): Promise<ProtocolResponse> {
    const url = `${devBackendUrl()}/command`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error(
        `Dev backend is not reachable at ${url}. Run "pnpm dev:web" (or "pnpm dev:backend") and reload.`,
      );
    }
    if (!response.ok) {
      throw new Error(`Dev backend answered ${response.status} at ${url}.`);
    }
    return parseResponse((await response.json()) as unknown);
  }

  async close(): Promise<void> {
    // The dev server is shared across reloads; nothing per-page to shut down.
  }
}

let transport: BackendTransport | null = null;

/** Explicit replacement launches (browser bridge or native) must never reach a legacy backend. */
export function isSelectedWorkspaceLaunch(): boolean {
  return import.meta.env.VITE_TASKDB_V2 === "1" || !!import.meta.env.VITE_TASKDB_V2_NATIVE_SELECTION;
}

export function getBackendTransport(): BackendTransport {
  if (isSelectedWorkspaceLaunch()) throw new Error("The explicitly selected workspace cannot launch a legacy backend, including after a development reload.");
  if (!transport) {
    const kind = backendKind();
    transport = kind === "desktop"
      ? new TauriBackendTransport()
      : kind === "android"
        ? new AndroidBackendTransport()
        : new HttpBackendTransport();
  }
  return transport;
}
