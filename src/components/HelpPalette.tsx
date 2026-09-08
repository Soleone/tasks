import { useRef, type ReactElement } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type HelpEntry = { title: string; description: string };

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Keyboard",
    entries: [
      { title: "Enter", description: "In the title, add the task or save your edit. In the description, insert a new line. On the task list, open the highlighted task." },
      { title: "Tab", description: "Cycle title, description, task list, then back to title. Tab never leaves the app." },
      { title: "Shift+Tab", description: "Cycle backwards. From the description, return to the title." },
      { title: "Arrow keys", description: "On the task list, move through tasks with Up and Down. Home jumps to the first task, End to the last." },
      { title: "Ctrl/Cmd+Enter", description: "Save from either the title or description." },
      { title: "Ctrl/Cmd+K", description: "Open or close this shortcuts and syntax palette, even while typing." },
      { title: "Escape", description: "Close this palette and return to where you were. In the description, focus the title without losing your notes; hide the description if empty. On the task list, jump back to the title. In the edit title, go back to the list." },
    ],
  },
  {
    heading: "Tasks",
    entries: [
      { title: "Open a task", description: "Tab to the task list, highlight a task with the arrow keys, and press Enter. Clicking still works." },
    ],
  },
  {
    heading: "Syntax",
    entries: [
      { title: "@category", description: "One optional category per task, in the title or description. Example: Book venue @launch. Categories are not people or mentions." },
      { title: "#tags", description: "Any number of tags, in the title or description. Example: Book venue #planning #calls." },
      { title: "Names and Markdown", description: "Start category and tag names with a letter, then use letters, numbers, _ or -. Matching ignores case. Use # followed by a space for a Markdown heading. Tokens inside backtick code are ignored. Markdown is saved as text, not rendered here." },
    ],
  },
];

export function HelpPalette({ open, onOpenChange, returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: HTMLElement | null;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Shortcuts & syntax</DialogTitle>
        <DialogDescription>Keyboard help, @categories and #tags.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-1/3 translate-y-0 max-h-full overflow-y-auto rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={() => returnFocus?.isConnected ? returnFocus : undefined}
      >
        <Command label="Search shortcuts and syntax">
          <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
          <CommandList label="Help results">
            <CommandEmpty>No matching help. Try “Tab”, “@” or “Markdown”.</CommandEmpty>
            {helpGroups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.entries.map((entry) => (
                  <CommandItem key={entry.title} onSelect={() => onOpenChange(false)}>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{entry.title}</span>
                      <span className="text-muted-foreground">{entry.description}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}