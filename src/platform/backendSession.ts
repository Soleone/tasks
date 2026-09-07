import type { Child, Command } from "@tauri-apps/plugin-shell";
import {
  parseResponse,
  type ProtocolResponse,
  type RuntimeProbeRequest,
} from "../backend/protocol";

type PendingRequest = {
  resolve: (response: ProtocolResponse) => void;
  reject: (error: Error) => void;
};

function asText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class BackendSession {
  private child: Child | null = null;
  private starting: Promise<void> | null = null;
  private stdoutBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();

  async request(request: RuntimeProbeRequest): Promise<ProtocolResponse> {
    await this.ensureStarted();

    if (!this.child) {
      throw new Error("backend process is not available");
    }

    const child = this.child;
    return new Promise<ProtocolResponse>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      void child.write(`${JSON.stringify(request)}\n`).catch((error: unknown) => {
        this.pending.delete(request.requestId);
        this.fail(error);
        reject(asError(error));
      });
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.fail(new Error("backend session closed"));
    await child?.kill();
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) {
      return;
    }

    if (!this.starting) {
      this.starting = this.spawnBackend();
    }

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async spawnBackend(): Promise<void> {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const command: Command<string> = Command.sidecar("binaries/tasks-backend", ["--stdio"]);

    command.stdout.on("data", (data) => this.consumeStdout(asText(data)));
    command.on("error", (message) => this.fail(new Error(message)));
    command.on("close", ({ code, signal }) => {
      const detail = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      this.fail(new Error(`backend process closed with ${detail}`));
    });

    try {
      this.child = await command.spawn();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private consumeStdout(data: string): void {
    this.stdoutBuffer += data;

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line === "") {
        continue;
      }

      try {
        const response = parseResponse(JSON.parse(line));
        const request = this.pending.get(response.requestId);
        if (!request) {
          throw new Error(`backend returned an unknown request ID: ${response.requestId}`);
        }
        this.pending.delete(response.requestId);
        request.resolve(response);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  private fail(value: unknown): void {
    const error = asError(value);
    this.child = null;
    this.stdoutBuffer = "";

    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
