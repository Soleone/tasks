import type { UndoStorage } from "./undoHistory";

export type HomeDocumentName = "settings" | "undo";

/** Sends one home command through the selected backend and returns its result. */
export type HomeCommand = (
  command: "home.document.read" | "home.document.write",
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type Pending = { text: string; replaceDamaged: boolean; waiters: (() => void)[] };

/**
 * The home's own documents, read and saved through the backend. Saves run one at a time per
 * document and only the newest waiting text is written, so typing in search doesn't queue a
 * durable write per keystroke.
 */
export class HomeDocuments {
  private readonly pending = new Map<HomeDocumentName, Pending>();
  private readonly running = new Set<HomeDocumentName>();
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
        } catch (error) {
          for (const listener of this.failureListeners) listener(name, error);
        }
        for (const resolve of next.waiters) resolve();
      }
    } finally {
      this.running.delete(name);
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
