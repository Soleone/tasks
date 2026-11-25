/** A started backend: Tauri's shell child on desktop, the app's own runner on Android. */
export type BackendProcess = {
  write(data: string): Promise<void>;
  kill(): Promise<void>;
};

/** The parts of a shell command the session uses to start and watch a backend. */
export type BackendCommand = {
  stdout: { on(event: "data", listener: (data: string | Uint8Array) => void): unknown };
  on(event: "error", listener: (message: string) => void): unknown;
  on(
    event: "close",
    listener: (payload: { code: number | null; signal: number | null }) => void,
  ): unknown;
  spawn(): Promise<BackendProcess>;
};

type CorrelatedResponse = { requestId: string | null };

type PendingRequest<Response extends CorrelatedResponse> = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 120_000;

type SessionState =
  | { kind: "idle" }
  | { kind: "starting"; process: Promise<BackendProcess> }
  | { kind: "running"; child: BackendProcess }
  | { kind: "closing"; done: Promise<void> };

export class JsonLineSession<Response extends CorrelatedResponse> {
  private state: SessionState = { kind: "idle" };
  private stdoutBuffer = "";
  private readonly pending = new Map<string, PendingRequest<Response>>();
  private readonly exited = new WeakSet<BackendProcess>();

  constructor(
    private readonly makeCommand: () => Promise<BackendCommand>,
    private readonly decodeResponse: (value: unknown) => Response,
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  async request(request: { requestId: string }): Promise<Response> {
    const state = this.state;
    if (state.kind === "closing") throw new Error("backend session closed");
    const child = await (state.kind === "running"
      ? state.child
      : state.kind === "starting"
        ? state.process
        : this.start());
    if (this.state.kind !== "running" || this.state.child !== child)
      throw new Error("backend process is not available");

    if (this.pending.has(request.requestId)) {
      throw new Error("backend request ID is already pending");
    }
    return new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(request.requestId)) {
          this.fail(
            new Error(
              `backend request timed out after ${this.requestTimeoutMs} ms; retry uncertain writes with the same idempotency key`,
            ),
          );
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
    const state = this.state;
    if (state.kind === "idle") return;
    if (state.kind === "closing") return state.done;

    const done = Promise.resolve().then(async () => {
      const child =
        state.kind === "running" ? state.child : await state.process.catch(() => undefined);
      if (child) {
        await this.kill(child).catch((error: unknown) => {
          // Keep the failed-close child selected so a retry cannot forget it and reload.
          this.state = { kind: "running", child };
          throw error;
        });
      }
      this.state = { kind: "idle" };
    });
    this.state = { kind: "closing", done };
    this.rejectPending(new Error("backend session closed"));
    return done;
  }

  private start(): Promise<BackendProcess> {
    const process = this.spawnBackend().catch((error: unknown) => {
      if (this.state.kind === "starting") this.state = { kind: "idle" };
      throw error;
    });
    this.state = { kind: "starting", process };
    return process;
  }

  private async spawnBackend(): Promise<BackendProcess> {
    const command = await this.makeCommand();
    let spawnedChild: BackendProcess | null = null;
    const isCurrent = () => this.state.kind === "running" && this.state.child === spawnedChild;

    command.stdout.on("data", (data) => {
      if (isCurrent()) {
        this.consumeStdout(typeof data === "string" ? data : new TextDecoder().decode(data));
      }
    });
    command.on("error", (message) => {
      if (isCurrent()) this.fail(new Error(message));
    });
    command.on("close", ({ code, signal }) => {
      if (spawnedChild) this.exited.add(spawnedChild);
      if (!isCurrent()) return;
      const detail = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      this.fail(new Error(`backend process closed with ${detail}`));
    });

    spawnedChild = await command.spawn();
    if (this.state.kind === "starting") this.state = { kind: "running", child: spawnedChild };
    return spawnedChild;
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
        const request =
          typeof response.requestId === "string" ? this.pending.get(response.requestId) : undefined;
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
    const state = this.state;
    if (state.kind !== "running") return;
    this.state = { kind: "idle" };
    this.rejectPending(value);
    // Failure cleanup is best effort; an intentional close must report a live child's refusal.
    void this.kill(state.child).catch(() => undefined);
  }

  private rejectPending(value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value));
    this.stdoutBuffer = "";

    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private async kill(child: BackendProcess): Promise<void> {
    if (this.exited.has(child)) return;
    try {
      await child.kill();
    } catch (error) {
      if (!this.exited.has(child)) throw error;
    }
  }
}
