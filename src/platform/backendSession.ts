import type { Child, Command } from "@tauri-apps/plugin-shell";
import {
  parseResponse,
  type ProtocolRequest,
  type ProtocolResponse,
} from "../legacy/backend/protocol";

type CorrelatedResponse = { requestId: string | null };

type PendingRequest<Response extends CorrelatedResponse> = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 120_000;

function asText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class JsonLineSession<Response extends CorrelatedResponse> {
  private child: Child | null = null;
  private starting: Promise<void> | null = null;
  private stdoutBuffer = "";
  private readonly pending = new Map<string, PendingRequest<Response>>();

  constructor(
    private readonly makeCommand: () => Promise<Command<string>>,
    private readonly decodeResponse: (value: unknown) => Response,
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  async request(request: { requestId: string }): Promise<Response> {
    await this.ensureStarted();

    if (!this.child) {
      throw new Error("backend process is not available");
    }

    if (this.pending.has(request.requestId)) {
      throw new Error("backend request ID is already pending");
    }
    const child = this.child;
    return new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(request.requestId)) {
          this.fail(new Error(`backend request timed out after ${this.requestTimeoutMs} ms; retry uncertain writes with the same idempotency key`));
        }
      }, this.requestTimeoutMs);
      this.pending.set(request.requestId, { resolve, reject, timeout });
      void child.write(`${JSON.stringify(request)}\n`).catch((error: unknown) => {
        if (!this.pending.has(request.requestId)) return;
        this.fail(error);
      });
    });
  }

  async close(): Promise<void> {
    const starting = this.starting;
    const child = this.rejectPending(new Error("backend session closed"));
    await starting?.catch(() => undefined);

    const spawnedAfterClose = this.child;
    this.child = null;
    await this.kill(child);
    if (spawnedAfterClose !== child) {
      await this.kill(spawnedAfterClose);
    }
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
    const command = await this.makeCommand();
    let spawnedChild: Child | null = null;
    const isCurrent = () => spawnedChild !== null && this.child === spawnedChild;

    command.stdout.on("data", (data) => {
      if (isCurrent()) this.consumeStdout(asText(data));
    });
    command.on("error", (message) => {
      if (isCurrent()) this.fail(new Error(message));
    });
    command.on("close", ({ code, signal }) => {
      if (!isCurrent()) return;
      const detail = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      this.fail(new Error(`backend process closed with ${detail}`));
    });

    try {
      spawnedChild = await command.spawn();
      this.child = spawnedChild;
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
        const response = this.decodeResponse(JSON.parse(line));
        const request = typeof response.requestId === "string" ? this.pending.get(response.requestId) : undefined;
        if (!request) {
          throw new Error(`backend returned an unknown request ID: ${response.requestId}`);
        }
        this.pending.delete(response.requestId!);
        clearTimeout(request.timeout);
        request.resolve(response);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  private fail(value: unknown): void {
    const child = this.rejectPending(value);
    void this.kill(child);
  }

  private rejectPending(value: unknown): Child | null {
    const error = asError(value);
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = "";

    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    return child;
  }

  private async kill(child: Child | null): Promise<void> {
    if (!child) {
      return;
    }
    try {
      await child.kill();
    } catch {
      // The process may have exited between the failure and cleanup.
    }
  }
}

export class BackendSession extends JsonLineSession<ProtocolResponse> {
  constructor(
    makeCommand: () => Promise<Command<string>> = async () => {
      const { Command } = await import("@tauri-apps/plugin-shell");
      return Command.sidecar("binaries/tasks-backend", ["--stdio"]);
    },
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    super(makeCommand, parseResponse, requestTimeoutMs);
  }

  override request(request: ProtocolRequest): Promise<ProtocolResponse> {
    return super.request(request);
  }
}
