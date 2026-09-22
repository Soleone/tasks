import {
  parseResponse,
  type ProtocolRequest,
  type ProtocolResponse,
} from "../backend/protocol";
import { BackendSession } from "./backendSession";
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
  request(): Promise<ProtocolResponse> {
    return Promise.reject(new Error("Android backend is not initialized: the Tasks-owned SQLite and workspace bridges are not available yet."));
  }

  async close(): Promise<void> {
    // The mobile transport has no native session until the Android bridge is implemented.
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

export function getBackendTransport(): BackendTransport {
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
