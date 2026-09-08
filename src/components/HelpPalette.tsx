import { Fragment, useRef, type ReactElement } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpDown,
  AtSign,
  Command as CommandIcon,
  CornerDownLeft,
  Hash,
  Search,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

type HelpEntry = {
  label: string;
  hint?: string;
  icon: LucideIcon;
  keys?: string[];
  keywords?: string;
};

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Shortcuts",
    entries: [
      { label: "Add, save, or open", icon: CornerDownLeft, keys: ["Enter"], keywords: "enter title description list highlighted task" },
      { label: "Next field or list", icon: ArrowRightToLine, keys: ["Tab"], keywords: "tab cycle description" },
      { label: "Previous field", icon: ArrowLeftToLine, keys: ["Shift", "Tab"], keywords: "shift backwards cycle" },
      { label: "Move through tasks", icon: ArrowUpDown, keys: ["↑", "↓", "Home", "End"], keywords: "arrow keys up down first last highlight list" },
      { label: "Save from anywhere", icon: CommandIcon, keys: ["Ctrl/⌘", "Enter"], keywords: "ctrl cmd enter title description" },
      { label: "Toggle this palette", icon: Search, keys: ["Ctrl/⌘", "K"], keywords: "ctrl cmd open close help syntax" },
      { label: "Close or go back", icon: Undo2, keys: ["Esc"], keywords: "escape palette focus title notes list edit" },
    ],
  },
  {
    heading: "Syntax",
    entries: [
      { label: "@category", hint: "One per task", icon: AtSign, keywords: "@launch people mentions title description" },
      { label: "#tags", hint: "Any number of tags", icon: Hash, keywords: "#planning #calls title description" },
      { label: "Names & Markdown", hint: "Letters, numbers, _ -", icon: Type, keywords: "case heading code backtick rendered text" },
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
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={() => returnFocus?.isConnected ? returnFocus : undefined}
      >
        <Command label="Search shortcuts and syntax">
          <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
          <CommandList label="Help results">
            <CommandEmpty>No matching help. Try “Tab”, “@” or “Markdown”.</CommandEmpty>
            {helpGroups.map((group, groupIndex) => (
              <Fragment key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <CommandItem key={entry.label} value={`${group.heading} ${entry.label} ${entry.hint ?? ""} ${entry.keys?.join(" ") ?? ""} ${entry.keywords ?? ""}`}>
                        <Icon aria-hidden="true" />
                        <span className="font-medium">{entry.label}</span>
                        {entry.hint ? <span className="text-muted-foreground">{entry.hint}</span> : null}
                        {entry.keys ? (
                          <CommandShortcut className="flex shrink-0 items-center tracking-normal">
                            <KbdGroup>
                              {entry.keys.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </KbdGroup>
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
