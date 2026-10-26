import type { UndoStorage } from "./undoHistory";

export type HomeDocumentName = "settings" | "undo";

/** Sends one home command through the selected backend and returns its result. */
export type HomeCommand = (
  command: "home.document.read" | "home.document.write",
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type Pending = { text: string; replaceDamaged: boolean; waiters: (() => void)[] };
type Failed = { text: string; replaceDamaged: boolean; error: unknown };

/**
 * The home's own documents, read and saved through the backend. Saves run one at a time per
 * document and only the newest waiting text is written, so typing in search doesn't queue a
 * durable write per keystroke.
 */
export class HomeDocuments {
  private readonly pending = new Map<HomeDocumentName, Pending>();
  private readonly running = new Set<HomeDocumentName>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly failures = new Map<HomeDocumentName, Failed>();
  private readonly failureListeners = new Set<(name: HomeDocumentName, error: unknown) => void>();

  constructor(private readonly send: HomeCommand) {}

  async read(name: HomeDocumentName): Promise<string | null> {
    const { text } = await this.send("home.document.read", { name });
    if (text !== null && typeof text !== "string")
      throw new Error("The backend returned an invalid document.");
    return text;
  }

  /** Resolves once this text or a newer one is saved; failures go to the failure listeners. */
  save(name: HomeDocumentName, text: string, replaceDamaged = false): Promise<void> {
    return new Promise((resolve) => {
      const waiting = this.pending.get(name);
      this.pending.set(name, {
        text,
        replaceDamaged: replaceDamaged || (waiting?.replaceDamaged ?? false),
        waiters: [...(waiting?.waiters ?? []), resolve],
      });
      if (!this.running.has(name)) void this.drain(name);
    });
  }

  onFailure(listener: (name: HomeDocumentName, error: unknown) => void): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  /**
   * Waits for both document queues, refusing to leave a home with an unsaved document. A save
   * that failed earlier is tried once more, so a passing storage fault doesn't block leaving.
   */
  async waitForIdle(): Promise<void> {
    await this.drained();
    await Promise.all(
      [...this.failures].map(([name, failed]) =>
        this.save(name, failed.text, failed.replaceDamaged),
      ),
    );
    await this.drained();
    if (this.failures.size > 0) {
      const [name, { error }] = this.failures.entries().next().value!;
      throw new Error(
        `Couldn't save ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async drained(): Promise<void> {
    while (this.running.size > 0)
      await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  private async drain(name: HomeDocumentName): Promise<void> {
    this.running.add(name);
    try {
      for (let next = this.pending.get(name); next; next = this.pending.get(name)) {
        this.pending.delete(name);
        try {
          await this.send("home.document.write", {
            name,
            text: next.text,
            ...(next.replaceDamaged ? { replaceDamaged: true } : {}),
          });
          this.failures.delete(name);
        } catch (error) {
          this.failures.set(name, { text: next.text, replaceDamaged: next.replaceDamaged, error });
          for (const listener of this.failureListeners) listener(name, error);
        }
        for (const resolve of next.waiters) resolve();
      }
    } finally {
      this.running.delete(name);
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }
}

/** This client's undo records, kept in the home's `local/undo.json` in the shape browser storage had. */
export function homeUndoStorage(documents: HomeDocuments, text: string | null): UndoStorage {
  let stored = text;
  return {
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
      void documents.save("undo", value);
    },
  };
}
