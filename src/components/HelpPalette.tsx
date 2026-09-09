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
  Tags,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { ThemeMode, ThemeRecord } from "@/backend/protocol";
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
    heading: "Task actions",
    entries: [
      { label: "Add, save, or open", icon: ListPlus, keys: ["Enter"], keywords: "enter title description new line list highlighted task" },
      { label: "Save from anywhere", icon: SaveCheck, keys: ["Ctrl/⌘", "Enter"], keywords: "ctrl cmd enter title description" },
      { label: "Delete task", icon: Trash2, keys: ["Delete"], keywords: "delete remove permanent task confirmation enter escape" },
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

function modeLabel(mode: ThemeMode): string {
  if (mode === "system") return "Follows system";
  return mode === "dark" ? "Dark" : "Light";
}

export function HelpPalette({ open, onOpenChange, returnFocus, themes, selectedTheme, onSelectTheme }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: HTMLElement | null;
  themes: ThemeRecord[];
  selectedTheme: string;
  onSelectTheme: (name: string) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Shortcuts, syntax, and themes</DialogTitle>
        <DialogDescription>Keyboard help, @categories and #tags, and the workspace theme.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={() => returnFocus?.isConnected ? returnFocus : undefined}
      >
        <Command label="Search shortcuts, syntax, and themes">
          <CommandInput ref={searchInput} placeholder="Search shortcuts, syntax, or themes…" />
          <CommandList label="Help results">
            <CommandEmpty>No matches. Try “Tab”, “@”, or “theme”.</CommandEmpty>
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
            {themes.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Theme">
                  {themes.map((theme) => (
                    <CommandItem
                      key={theme.name}
                      value={`theme ${theme.label} ${theme.mode} ${theme.source} appearance colour color accent`}
                      onSelect={() => onSelectTheme(theme.name)}
                    >
                      {theme.palette.accent
                        ? <span
                            aria-hidden="true"
                            className="size-4 shrink-0 rounded-full ring-1 ring-border"
                            style={{ backgroundColor: theme.palette.accent }}
                          />
                        : <Palette aria-hidden="true" />}
                      <span className="font-medium">{theme.label}</span>
                      <span className="text-muted-foreground">{theme.warnings[0] ?? modeLabel(theme.mode)}</span>
                      {theme.name === selectedTheme ? <CommandShortcut>Active</CommandShortcut> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
