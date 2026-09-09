import { Fragment, useRef, type ReactElement } from "react";
import {
  CircleHelp,
  FileText,
  Folder,
  ListChecks,
  ListPlus,
  MoveLeft,
  MoveRight,
  Palette,
  SaveCheck,
  Settings2,
  Tags,
  Trash2,
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
  /** Entries the palette runs itself, rather than explaining. */
  action?: "open-settings";
};

const helpGroups: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Task actions",
    entries: [
      { label: "Add, save, or open", icon: ListPlus, keys: ["Enter"], keywords: "enter title description new line list highlighted task" },
      { label: "Save from anywhere", icon: SaveCheck, keys: ["Ctrl/⌘", "Enter"], keywords: "ctrl cmd enter title description" },
      { label: "Change task status", icon: ListChecks, keys: ["Space"], keywords: "space open in progress paused done status cycle" },
      { label: "Cancel task", icon: Trash2, keys: ["Delete"], keywords: "delete remove cancel cancelled status confirmation enter escape" },
    ],
  },
  {
    heading: "Navigation",
    entries: [
      { label: "Next field or list", icon: MoveRight, keys: ["Tab"], keywords: "tab cycle description" },
      { label: "Previous field", icon: MoveLeft, keys: ["Shift", "Tab"], keywords: "shift backwards cycle" },
      { label: "Move through tasks", icon: ListChecks, keys: ["↑", "↓", "Home", "End"], keywords: "arrow keys up down first last highlight list" },
    ],
  },
  {
    heading: "Workspace",
    entries: [
      { label: "Settings", hint: "Storage and export", icon: Settings2, action: "open-settings", keywords: "data export json sqlite database storage path" },
      { label: "Themes", hint: "Workspace appearance", icon: Palette, keys: ["Alt", "T"], keywords: "alt theme colour color dark light accent palette" },
      { label: "Toggle this palette", icon: CircleHelp, keys: ["Ctrl/⌘", "K"], keywords: "ctrl cmd open close help syntax" },
      { label: "Close or go back", icon: Undo2, keys: ["Esc"], keywords: "escape palette focus title notes list edit" },
    ],
  },
  {
    heading: "Syntax",
    entries: [
      { label: "@category", hint: "One per task", icon: Folder, keywords: "@launch people mentions title description" },
      { label: "#tags", hint: "Any number of tags", icon: Tags, keywords: "#planning #calls title description" },
      { label: "Names & Markdown", hint: "Letters, numbers, _ -", icon: FileText, keywords: "case heading code backtick rendered text" },
    ],
  },
];

/** Search text that never shows up in the row but should still find it. */
function entryKeywords(entry: HelpEntry): string[] {
  return [entry.hint, entry.keys?.join(" "), entry.keywords].filter((part): part is string => Boolean(part));
}

/**
 * cmdk's default scorer is a fuzzy subsequence match, so a query like "theme" is
 * a hit anywhere its letters appear in order. Our values concatenate a long
 * keyword blob, which turns every group into a low-score match. Require each
 * query word to appear verbatim, and rank label matches above keyword-only ones.
 */
function helpScore(value: string, search: string, keywords?: string[]): number {
  const label = value.toLowerCase();
  const haystack = `${label} ${keywords?.join(" ").toLowerCase() ?? ""}`;
  const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  if (!words.every((word) => haystack.includes(word))) return 0;
  return words.reduce((score, word) => score + (label.includes(word) ? 2 : 1), 0);
}

export function HelpPalette({ open, onOpenChange, returnFocus, onOpenSettings }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: HTMLElement | null;
  onOpenSettings: () => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Shortcuts and syntax</DialogTitle>
        <DialogDescription>Keyboard help, @categories and #tags.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={() => returnFocus?.isConnected ? returnFocus : undefined}
      >
        <Command label="Search shortcuts and syntax" filter={helpScore} loop>
          <CommandInput ref={searchInput} placeholder="Search shortcuts or syntax…" />
          <CommandList label="Help results">
            <CommandEmpty>No matches. Try “Tab” or “@”.</CommandEmpty>
            {helpGroups.map((group, groupIndex) => (
              <Fragment key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <CommandItem
                        key={entry.label}
                        value={`${group.heading} ${entry.label}`}
                        keywords={entryKeywords(entry)}
                        onSelect={entry.action === "open-settings" ? onOpenSettings : undefined}
                      >
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
