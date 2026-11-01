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

type Session = JsonLineSession<Response>;
type SavedTask = { id: string; version: number; status: string };

/** Requests go through the app's own backend session, as the CLI's would. */
function request(session: Session, fields: Record<string, unknown>) {
  const envelope = {
    version: 2,
    requestId: crypto.randomUUID(),
    actor: { kind: "human", label: "Example tasks" },
    dryRun: false,
    ...fields,
  };
  return session.request(envelope);
}

/** The write context ties writes to this home and its cache, so one serves a whole batch. */
async function writeContext(session: Session): Promise<string> {
  const info = await request(session, { command: "workspace.info", args: {}, readOnly: true });
  if (!info.ok) throw new Error(info.error.message);
  return info.writeContext;
}

/** Writes stay out of the visitor's undo history; the list picks them up when it next checks. */
async function write(
  session: Session,
  context: string,
  command: string,
  args: Record<string, unknown>,
  dryRun = false,
): Promise<Record<string, unknown>> {
  const response = await request(session, {
    command,
    args,
    readOnly: false,
    dryRun,
    writeContext: context,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.result;
}

/**
 * Adds the example tasks and returns their IDs. Each wave of requests goes out without waiting on
 * replies, since the worker runs them in the order sent: the tasks, their subtasks, a fresh read of
 * the ones with a status (adding tasks moves their neighbors, changing their versions), then the
 * statuses.
 */
export async function addSampleTasks(session: Session): Promise<string[]> {
  const context = await writeContext(session);
  const ids: string[] = [];
  const statuses: [id: string, status: NonNullable<SampleTask["status"]>][] = [];
  const create = async (
    {
      text,
      priority,
      status,
    }: { text: string; priority?: TaskPriority; status?: SampleTask["status"] },
    parentId: string | null,
  ): Promise<string> => {
    const { task } = (await write(session, context, "task.create", {
      text,
      priority,
      parentId,
    })) as {
      task: SavedTask;
    };
    ids.push(task.id);
    if (status) statuses.push([task.id, status]);
    return task.id;
  };
  // New tasks go to the top, so each wave is sent from the bottom up.
  const samples = [...SAMPLE_TASKS].reverse();
  const parentIds = await Promise.all(samples.map((sample) => create(sample, null)));
  await Promise.all(
    samples.flatMap((sample, index) =>
      [...(sample.children ?? [])].reverse().map((child) => create(child, parentIds[index]!)),
    ),
  );
  const tasks = await Promise.all(statuses.map(([id]) => getTask(session, id)));
  await write(session, context, "task.transitionMany", {
    tasks: tasks.map((task, index) => ({
      id: task!.id,
      expectedVersion: task!.version,
      command: STATUS_COMMANDS[statuses[index]![1]],
    })),
  });
  return ids;
}

/** The task as saved now, or `undefined` once it's gone. */
async function getTask(session: Session, id: string): Promise<SavedTask | undefined> {
  const response = await request(session, { command: "task.get", args: { id }, readOnly: true });
  if (response.ok) return (response.result as { task: SavedTask }).task;
  if (response.error.code !== "TASK_NOT_FOUND") throw new Error(response.error.message);
  return undefined;
}

/**
 * Deletes the example tasks still in the home, edited or not, then purges them, unless that would
 * also purge the visitor's own canceled tasks; then they stay under Canceled.
 */
export async function removeSampleTasks(session: Session, ids: string[]): Promise<void> {
  const context = await writeContext(session);
  const tasks = await Promise.all(ids.map((id) => getTask(session, id)));
  const live = tasks.filter(
    (task): task is SavedTask => task !== undefined && task.status !== "canceled",
  );
  if (live.length > 0)
    await write(session, context, "task.transitionMany", {
      tasks: live.map(({ id, version }) => ({
        id,
        expectedVersion: version,
        command: "task.delete",
      })),
    });
  const { purgedIds } = (await write(session, context, "task.purgeCanceled", {}, true)) as {
    purgedIds: string[];
  };
  if (purgedIds.length > 0 && purgedIds.every((id) => ids.includes(id)))
    await write(session, context, "task.purgeCanceled", {});
}
