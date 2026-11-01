import type { TaskPriority } from "@/backend/taskModel";

type SampleTask = {
  /** Composer shorthand: `@category`, `#tag` and `!due`, with due words relative to today. */
  text: string;
  priority: TaskPriority;
  status?: "in_progress" | "paused" | "done";
  children?: Omit<SampleTask, "priority" | "children">[];
};

/** The web demo's first list, top to bottom. */
export const SAMPLE_TASKS: SampleTask[] = [
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
