import type { Response } from "@/backend/protocol";
import type { TaskPriority } from "@/backend/taskModel";
import type { JsonLineSession } from "@/platform/backendSession";

type SampleTask = {
  /** Composer shorthand: `@category`, `#tag` and `!due`, with due words relative to today. */
  text: string;
  priority: TaskPriority;
  status?: "in_progress" | "paused" | "done";
  children?: Omit<SampleTask, "priority" | "children">[];
};

/** The web build's example tasks, top to bottom. */
const SAMPLE_TASKS: SampleTask[] = [
  { text: "Record the 30-second demo loop @launch !today", priority: 1, status: "in_progress" },
  {
    text: "Review the agent's pull request for offline sync @app #agent #review !tomorrow",
    priority: 0,
    children: [
      { text: "Run the branch on a disposable home", status: "done" },
      { text: "Check the conflict copy on two devices" },
    ],
  },
  { text: "Fix the done count skipping its roll on macOS @app #bug", priority: 0 },
  {
    text: "Write the launch post @launch #writing !fri",
    priority: 1,
    children: [
      { text: "Outline: why local-first, why keyboard-first", status: "done" },
      { text: "Pick three screenshots" },
      { text: "Ask an agent to proofread it #agent" },
    ],
  },
  { text: "Let an agent triage the crash reports @app #agent !wed", priority: 2 },
  { text: "Back up the Tasks home before the OS upgrade @admin #backup", priority: 2 },
  { text: "Renew the domain @admin !2w", priority: 2 },
  { text: "Book a dentist appointment @personal !mon", priority: 3 },
  { text: "Plan Saturday's hike @personal !sat", priority: 3 },
  { text: "Buy coffee beans @errands", priority: 3 },
  {
    text: "Read the Ink & Switch essay on local-first software #reading",
    priority: 4,
    status: "paused",
  },
  { text: "Reply to beta tester feedback @launch", priority: 2, status: "done" },
  { text: "Ship v0.3.8 @app", priority: 1, status: "done" },
];

const STATUS_COMMANDS = { in_progress: "task.start", paused: "task.pause", done: "task.complete" };

/**
 * Adds the example tasks through the app's own backend session, as the CLI would; the list picks
 * them up when it next checks for changes. They stay out of the visitor's undo history.
 */
export async function addSampleTasks(session: JsonLineSession<Response>): Promise<void> {
  const send = async (command: string, args: Record<string, unknown>) => {
    const request = (fields: Record<string, unknown>) => {
      const envelope = {
        version: 2,
        requestId: crypto.randomUUID(),
        actor: { kind: "human", label: "Example tasks" },
        dryRun: false,
        ...fields,
      };
      return session.request(envelope);
    };
    const info = await request({ command: "workspace.info", args: {}, readOnly: true });
    if (!info.ok) throw new Error(info.error.message);
    const response = await request({
      command,
      args,
      readOnly: false,
      writeContext: info.writeContext,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  };
  const create = async (
    {
      text,
      priority,
      status,
    }: { text: string; priority?: TaskPriority; status?: SampleTask["status"] },
    parentId: string | null,
  ) => {
    const { task } = (await send("task.create", { text, priority, parentId })) as {
      task: { id: string; version: number };
    };
    if (status)
      await send("task.transitionMany", {
        tasks: [{ id: task.id, expectedVersion: task.version, command: STATUS_COMMANDS[status] }],
      });
    return task.id;
  };
  // New tasks go to the top, so the list is created from the bottom up.
  for (const sample of [...SAMPLE_TASKS].reverse()) {
    const id = await create(sample, null);
    for (const child of [...(sample.children ?? [])].reverse()) await create(child, id);
  }
}
