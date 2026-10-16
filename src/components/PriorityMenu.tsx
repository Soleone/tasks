import { useRef, type ReactElement } from "react";
import { Check, Flag } from "lucide-react";
import type { TaskPriority } from "@/backend/taskModel";
import { PRIORITY_META } from "@/components/taskFilters";
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

export function PriorityMenu({
  open,
  onClose,
  finalFocus,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  selected: TaskPriority | null;
  onSelect: (priority: TaskPriority | null) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Filter by priority"
      description="Press 0 through 4 to filter. Choosing the active priority again clears it."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command label="Filter tasks by priority" filter={literalWordScore} loop>
        <CommandInput ref={searchInput} placeholder="Search priorities…" />
        <CommandList label="Priority results">
          <CommandEmpty>No matching priority.</CommandEmpty>
          <CommandGroup heading="Priority">
            {PRIORITY_META.map((meta) => (
              <CommandItem
                key={meta.value}
                value={`Priority ${meta.shortLabel} ${meta.label}`}
                keywords={[
                  String(meta.value),
                  meta.shortLabel.toLowerCase(),
                  meta.label.toLowerCase(),
                ]}
                onSelect={() => onSelect(selected === meta.value ? null : meta.value)}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-2.5 rounded-full ${meta.dot}`}
                />
                <span className="font-medium">{meta.shortLabel}</span>
                <span className="text-muted-foreground">{meta.label}</span>
                {selected === meta.value ? <Check aria-hidden="true" className="ml-auto" /> : null}
              </CommandItem>
            ))}
            <CommandItem
              value="All priorities"
              keywords={["all clear any reset"]}
              onSelect={() => onSelect(null)}
            >
              <Flag aria-hidden="true" />
              <span className="font-medium">All priorities</span>
              {selected === null ? <Check aria-hidden="true" className="ml-auto" /> : null}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
