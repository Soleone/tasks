import {
  parseResponse,
  type ProtocolRequest,
  type ProtocolResponse,
} from "../backend/protocol";
import { BackendSession } from "./backendSession";

type BackendKind = "desktop" | "browser";

function backendKind(): BackendKind {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? "desktop"
    : "browser";
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
    transport = backendKind() === "desktop"
      ? new TauriBackendTransport()
      : new HttpBackendTransport();
  }
  return transport;
}
