import { useRef, type ReactElement } from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "cn";
import type { TaskStatus } from "@/backend/taskModel";
import { EXACT_STATUS_META, taskStatusMeta, type StatusPreset } from "@/components/taskFilters";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  literalWordScore,
} from "@/components/ui/command";

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
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Filter by status"
      description="Choose Active, Inactive, or one exact status. F then S toggles presets; F then O, I, D, P, or X picks an exact status."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command label="Filter tasks by status" filter={literalWordScore} loop>
        <CommandInput ref={searchInput} placeholder="Search statuses…" />
        <CommandList label="Status results">
          <CommandEmpty>No matching status.</CommandEmpty>
          <CommandGroup heading="Presets">
            <CommandItem
              value="Preset Active"
              keywords={["f s active open in progress toggle"]}
              onSelect={() => onSelect("active", null)}
            >
              <Circle aria-hidden="true" />
              <span className="font-medium">Active</span>
              <span className="text-muted-foreground">Open, in progress</span>
              {exactStatus === null && preset === "active" ? (
                <Check aria-hidden="true" className="ml-auto" />
              ) : null}
            </CommandItem>
            <CommandItem
              value="Preset Inactive"
              keywords={["f s inactive paused done canceled toggle"]}
              onSelect={() => onSelect("inactive", null)}
            >
              <Circle aria-hidden="true" />
              <span className="font-medium">Inactive</span>
              <span className="text-muted-foreground">Paused, done, canceled</span>
              {exactStatus === null && preset === "inactive" ? (
                <Check aria-hidden="true" className="ml-auto" />
              ) : null}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Exact status">
            {EXACT_STATUS_META.map((entry) => {
              const status = taskStatusMeta[entry.status];
              const StatusIcon = status.Icon;
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
                      status.color,
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
    </CommandDialog>
  );
}
