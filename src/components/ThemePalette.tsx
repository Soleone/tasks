import { useRef, type ReactElement } from "react";
import { Palette } from "lucide-react";
import type { ThemeMode, ThemeRecord } from "@/backend/protocol";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function modeLabel(mode: ThemeMode): string {
  if (mode === "system") return "Follows system";
  return mode === "dark" ? "Dark" : "Light";
}

export function ThemeItem({ theme, selected, onSelect }: {
  theme: ThemeRecord;
  selected: boolean;
  onSelect: (name: string) => void;
}): ReactElement {
  return (
    <CommandItem
      value={`Theme ${theme.label}`}
      keywords={[
        theme.label,
        theme.mode,
        theme.source,
        "themes",
        "appearance",
        "colour",
        "color",
        "accent",
        // A system theme resolves to either ramp, so it answers to both queries.
        ...(theme.mode === "system" ? ["dark", "light"] : []),
      ]}
      onSelect={() => onSelect(theme.name)}
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
      {selected ? <CommandShortcut>Active</CommandShortcut> : null}
    </CommandItem>
  );
}

export function ThemePalette({ open, onOpenChange, finalFocus, themes, selectedTheme, onSelectTheme }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  themes: ThemeRecord[];
  selectedTheme: string;
  onSelectTheme: (name: string) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Themes</DialogTitle>
        <DialogDescription>Choose the workspace theme.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
      >
        <Command label="Search themes" loop>
          <CommandInput ref={searchInput} placeholder="Search themes…" />
          <CommandList label="Theme results">
            <CommandEmpty>No matching themes.</CommandEmpty>
            <CommandGroup heading="Theme">
              {themes.map((theme) => (
                <ThemeItem key={theme.name} theme={theme} selected={theme.name === selectedTheme} onSelect={onSelectTheme} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
