import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { Palette } from "lucide-react";
import type { ThemeMode, ThemeRecord } from "@/legacy/backend/protocol";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut, literalWordScore } from "@/components/ui/command";

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
      value={theme.name}
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
            className="size-4 shrink-0 rounded-full bg-(--theme-swatch) ring-1 ring-border"
            style={{ "--theme-swatch": theme.palette.accent } as CSSProperties}
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
  const activeTheme = themes.find((theme) => theme.name === selectedTheme);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, selectedTheme, themes.length]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Themes"
      description="Choose a theme."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
        {/* Reinitialize cmdk when the active theme arrives after an early open. */}
        <Command
          key={selectedTheme}
          defaultValue={activeTheme?.name}
          label="Search themes"
          filter={literalWordScore}
          loop
        >
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
    </CommandDialog>
  );
}
