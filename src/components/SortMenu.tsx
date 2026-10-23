import type { ComponentProps, ReactElement } from "react";
import {
  CalendarCheck,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Clock3,
  ListOrdered,
  RotateCcwClock,
  type LucideIcon,
} from "lucide-react";
import type { SortField } from "./taskFilters";
import type { Tooltip } from "./ui/tooltip";
import { ToolbarStateTrigger, ToolbarTooltip } from "./variants/toolbar";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ToolbarMenuContent } from "./variants/dropdown-menu";
import { preventFocusSteal } from "@/navigation";

type SortOption = { field: SortField; label: string; key: string; icon: LucideIcon };

// Menu order; the keys are the second key after S.
const SORT_OPTIONS: SortOption[] = [
  { field: "created", label: "Created", key: "C", icon: Clock3 },
  { field: "updated", label: "Updated", key: "U", icon: RotateCcwClock },
  { field: "priority", label: "Priority", key: "P", icon: ChartNoAxesColumnIncreasing },
  { field: "due", label: "Due date", key: "T", icon: CalendarDays },
  { field: "closed", label: "Completed", key: "D", icon: CalendarCheck },
  { field: "manual", label: "Manual order", key: "M", icon: ListOrdered },
];

/** One cell that shows the current sort and opens the others, so a new sort never reflows the toolbar. */
export function SortMenu({
  sortField,
  showCompleted,
  onSelect,
  finalFocus,
  tooltip,
}: {
  sortField: SortField;
  // Completed belongs to the Done filter, not the main sorts.
  showCompleted: boolean;
  onSelect: (field: SortField) => void;
  finalFocus: () => HTMLElement | false | null;
  tooltip: ComponentProps<typeof Tooltip>;
}): ReactElement {
  const options = SORT_OPTIONS.filter((option) => showCompleted || option.field !== "closed");
  const current = SORT_OPTIONS.find((option) => option.field === sortField) ?? SORT_OPTIONS[0];
  const CurrentIcon = current.icon;
  // The Done filter starts on Completed, so there that is the sort to leave untinted.
  const defaultField: SortField = showCompleted ? "closed" : "created";

  return (
    <DropdownMenu>
      <ToolbarTooltip
        tooltip={tooltip}
        hint={`Sort: ${current.label}`}
        render={
          <DropdownMenuTrigger
            render={
              <ToolbarStateTrigger
                selected={sortField !== defaultField}
                aria-label={`Sort: ${current.label}. Open sort menu or press S.`}
                aria-keyshortcuts="S"
                data-sort="task-sort-menu"
                data-sort-field={sortField}
                onMouseDown={preventFocusSteal}
              />
            }
          />
        }
      >
        <CurrentIcon aria-hidden="true" />
      </ToolbarTooltip>
      <ToolbarMenuContent align="start" finalFocus={finalFocus}>
        <DropdownMenuRadioGroup
          value={sortField}
          onValueChange={(field: SortField) => onSelect(field)}
        >
          {options.map(({ field, label, key, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={field}
              value={field}
              closeOnClick
              data-sort={`task-sort-${field}`}
            >
              <Icon aria-hidden="true" />
              {label}
              <DropdownMenuShortcut>S {key}</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ToolbarMenuContent>
    </DropdownMenu>
  );
}
