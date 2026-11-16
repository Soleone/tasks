import { useRef, type ReactElement } from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "cn";
import type { TaskStatus } from "@/backend/taskModel";
import {
  EXACT_STATUS_META,
  STATUS_PRESET_LABELS,
  taskStatusMeta,
  type StatusPreset,
} from "@/components/taskFilters";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { literalWordScore } from "@/components/commandFilter";
import { Command, PaletteDialog } from "@/components/variants/command";

const PRESETS: Array<{ preset: StatusPreset; hint: string; keywords: string }> = [
  { preset: "active", hint: "Open, in progress", keywords: "f s active open in progress toggle" },
  {
    preset: "inactive",
    hint: "Paused, done, canceled",
    keywords: "f s inactive paused done canceled toggle",
  },
  { preset: "all", hint: "Every status", keywords: "f a all every status" },
];

export function StatusMenu({
  open,
  onClose,
  finalFocus,
  preset,
  exactStatus,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  preset: StatusPreset;
  exactStatus: TaskStatus | null;
  onSelect: (preset?: StatusPreset, exact?: TaskStatus | null) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <PaletteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Filter by status"
      description="Choose Active, Inactive, All, or one exact status. F then S toggles active and inactive; F then A shows all; F then O, I, D, P, or X picks an exact status."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command label="Filter tasks by status" filter={literalWordScore} loop>
        <CommandInput ref={searchInput} placeholder="Search statuses…" />
        <CommandList label="Status results">
          <CommandEmpty>No matching status.</CommandEmpty>
          <CommandGroup heading="Presets">
            {PRESETS.map(({ preset: option, hint, keywords }) => (
              <CommandItem
                key={option}
                value={`Preset ${STATUS_PRESET_LABELS[option]}`}
                keywords={[keywords]}
                onSelect={() => onSelect(option, null)}
              >
                <Circle aria-hidden="true" />
                <span className="font-medium">{STATUS_PRESET_LABELS[option]}</span>
                <span className="text-muted-foreground">{hint}</span>
                {exactStatus === null && preset === option ? (
                  <Check aria-hidden="true" className="ml-auto" />
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Exact status">
            {EXACT_STATUS_META.map((entry) => {
              const meta = taskStatusMeta[entry.status];
              const StatusIcon = meta.Icon;
              return (
                <CommandItem
                  key={entry.status}
                  value={`Status ${entry.label}`}
                  keywords={[`f ${entry.key.toLowerCase()} ${entry.label.toLowerCase()}`]}
                  onSelect={() => onSelect(undefined, entry.status)}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center",
                      meta.color,
                    )}
                  >
                    <StatusIcon aria-hidden="true" />
                  </span>
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-muted-foreground">F {entry.key}</span>
                  {exactStatus === entry.status ? (
                    <Check aria-hidden="true" className="ml-auto" />
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PaletteDialog>
  );
}
