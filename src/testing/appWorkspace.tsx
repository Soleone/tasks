import { cleanup, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, inject } from "vite-plus/test";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/soleone/theme";
import { themeOptions } from "virtual:theme-options";
import { THEME_STORAGE_KEY } from "@/theme/config";
import { closeMainWorkspace, selectMainWorkspace } from "@/platform/backendClient";
import { EditorClient, readEditorSelection, type EditorSelection } from "@/platform/editorClient";
import { openHomeWorkspace } from "@/platform/homeWorkspace";
import { MainWorkspace } from "@/platform/mainWorkspace";
import { WorkspaceReader } from "@/platform/workspaceReader";

export type SeededTask = {
  id: string;
  version: number;
  title: string;
  status: string;
  priority: number;
  parentId: string | null;
  blockedByIds: string[];
  dependencyIds: string[];
  description: string;
  category: string | null;
  tags: string[];
  due: string | null;
  effort: number;
  attachments: string[];
};

/** A tiny PNG whose last byte is `pixel`, so tests can tell images apart. */
export function pngBytes(pixel = 1): number[] {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, pixel];
}

/** A disposable workspace served by the dev bridge, with the real app rendered over it. */
export class AppWorkspace {
  private constructor(
    private readonly url: string,
    private readonly selection: EditorSelection,
  ) {}

  static async start(): Promise<AppWorkspace> {
    const reply = await fetch(`${inject("workspaceServerUrl")}/start`);
    const { url } = (await reply.json()) as { url: string };
    return new AppWorkspace(url, await readEditorSelection(url));
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.url}/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-taskdb-selection": this.selection.selectionToken,
      },
      body: JSON.stringify({
        version: 2,
        requestId: crypto.randomUUID(),
        actor: { kind: "agent", label: "client test" },
        ...body,
      }),
    });
    const reply = (await response.json()) as Record<string, unknown>;
    if (reply.ok !== true)
      throw new Error(`${String(body.command)} failed: ${JSON.stringify(reply)}`);
    return reply;
  }

  /** Writes through the same command path as an agent, outside the app. */
  async command<T = Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const { writeContext } = await this.post({ command: "workspace.info" });
    return (await this.post({ command, args, writeContext, idempotencyKey: crypto.randomUUID() }))
      .result as T;
  }

  async create(title: string, args: Record<string, unknown> = {}): Promise<SeededTask> {
    return (await this.command<{ task: SeededTask }>("task.create", { title, ...args })).task;
  }

  /** Creates `count` tasks on one write context, for tests that need more than a page of them. */
  async createMany(count: number, args: (index: number) => Record<string, unknown>): Promise<void> {
    const { writeContext } = await this.post({ command: "workspace.info" });
    for (let index = 0; index < count; index += 1) {
      await this.post({
        command: "task.create",
        args: args(index),
        writeContext,
        idempotencyKey: crypto.randomUUID(),
      });
    }
  }

  /** Stores `pngBytes(pixel)` through `attachment.write` and returns its name. */
  async storeImage(pixel = 1): Promise<string> {
    const data = btoa(String.fromCharCode(...pngBytes(pixel)));
    return (await this.command<{ name: string }>("attachment.write", { type: "image/png", data }))
      .name;
  }

  async task(id: string): Promise<SeededTask> {
    return (await this.command<{ task: SeededTask }>("task.get", { id })).task;
  }

  /** Runs a task command against the task's current version. */
  async change(
    command: string,
    id: string,
    args: Record<string, unknown> = {},
  ): Promise<SeededTask> {
    const task = await this.task(id);
    return (
      await this.command<{ task: SeededTask }>(command, {
        id,
        expectedVersion: task.version,
        ...args,
      })
    ).task;
  }

  /** Writes through `tasks-cli`'s path: the same home, with the CLI's own cache and context. */
  async cli<T = Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const send = async (request: Record<string, unknown>) => {
      const response = await fetch(
        `${inject("workspaceServerUrl")}/cli?url=${encodeURIComponent(this.url)}`,
        {
          method: "POST",
          body: JSON.stringify({
            version: 2,
            requestId: crypto.randomUUID(),
            actor: { kind: "human", label: "tasks-cli" },
            ...request,
          }),
        },
      );
      const reply = (await response.json()) as Record<string, unknown>;
      if (reply.ok !== true) throw new Error(`${command} failed: ${JSON.stringify(reply)}`);
      return reply;
    };
    const { writeContext } = await send({ command: "workspace.info" });
    return (await send({ command, args, writeContext, idempotencyKey: crypto.randomUUID() }))
      .result as T;
  }

  /** Delivers a fixture task file into the sync folder, as Syncthing would from another device. */
  async arrive(name: string): Promise<void> {
    const response = await fetch(
      `${inject("workspaceServerUrl")}/arrive?url=${encodeURIComponent(this.url)}&name=${encodeURIComponent(name)}`,
    );
    if (!response.ok) throw new Error(await response.text());
  }

  /** Removes an image file from the sync folder, as when it was removed on another device. */
  async loseImage(name: string): Promise<void> {
    const response = await fetch(
      `${inject("workspaceServerUrl")}/lose-image?url=${encodeURIComponent(this.url)}&name=${encodeURIComponent(name)}`,
    );
    if (!response.ok) throw new Error(await response.text());
  }

  /** The text of one of the home's own documents, or null when it doesn't exist. */
  async homeDocument(name: "settings" | "undo"): Promise<string | null> {
    const reply = await this.post({ command: "home.document.read", args: { name } });
    return (reply.result as { text: string | null }).text;
  }

  /**
   * Renders the app and waits until the list has loaded. With `home`, preferences and undo
   * records load from the Tasks home as in the app; otherwise they stay in browser storage.
   */
  async render({ home = false } = {}): Promise<{ user: UserEvent; view: RenderResult }> {
    const reader = new WorkspaceReader(this.selection, {
      url: this.url,
      selection: this.selection,
    });
    const editor = new EditorClient(this.url, this.selection);
    const workspace = home
      ? await openHomeWorkspace(reader, editor)
      : new MainWorkspace(reader, editor);
    closeMainWorkspace();
    selectMainWorkspace(workspace);
    const user = userEvent.setup();
    const view = render(
      <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
        <TooltipProvider>
          <App workspace={workspace} />
        </TooltipProvider>
      </ThemeProvider>,
    );
    // An empty Active view reads "All clear" once the done-today count arrives, which can be first.
    await waitFor(
      () =>
        expect(
          screen.queryByRole("listbox") ?? screen.queryByText(/^(No active tasks|All clear)$/),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    return { user, view };
  }

  async stop(): Promise<void> {
    // Unmount first so the app closes its reader while the workspace is still selected.
    cleanup();
    closeMainWorkspace();
    await fetch(`${inject("workspaceServerUrl")}/stop?url=${encodeURIComponent(this.url)}`);
  }
}
