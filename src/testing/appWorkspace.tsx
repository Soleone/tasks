import { render, screen, waitFor, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, inject } from "vitest";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { closeMainWorkspace, selectMainWorkspace } from "@/platform/backendClient";
import { EditorClient, readEditorSelection, type EditorSelection } from "@/platform/editorClient";
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
};

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

  /** Renders the app and waits until the list has loaded. */
  async render(): Promise<{ user: UserEvent; view: RenderResult }> {
    const reader = new WorkspaceReader(this.selection, {
      url: this.url,
      selection: this.selection,
    });
    const workspace = new MainWorkspace(reader, new EditorClient(this.url, this.selection));
    closeMainWorkspace();
    selectMainWorkspace(workspace);
    const user = userEvent.setup();
    const view = render(
      <TooltipProvider>
        <App workspace={workspace} />
      </TooltipProvider>,
    );
    await waitFor(
      () =>
        expect(
          screen.queryByRole("listbox") ?? screen.queryByText("No active tasks"),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    return { user, view };
  }

  async stop(): Promise<void> {
    closeMainWorkspace();
    await fetch(`${inject("workspaceServerUrl")}/stop?url=${encodeURIComponent(this.url)}`);
  }
}
