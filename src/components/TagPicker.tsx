import { useRef, type KeyboardEvent, type ReactElement } from "react";
import { Check, Tags } from "lucide-react";
import type { ClassificationOption } from "./taskView";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { listTags } from "@/platform/backendClient";
import { modKey } from "@/platform/runtime";
import { itemValue, useClassificationRename, type Renamed } from "./ClassificationRename";
import { APP_NAME } from "@/backend/branding";
import { literalWordScore } from "@/components/commandFilter";
import { Command, PaletteDialog } from "@/components/variants/command";

const loadTags = () => listTags().then((result) => result.tags);

export function TagPicker({
  open,
  onClose,
  finalFocus,
  selected,
  onChange,
  onRenamed,
}: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  selected: ClassificationOption[];
  /** Live updates; the picker stays open for multi-select. */
  onChange: (tags: ClassificationOption[]) => void;
  onRenamed: (renamed: Renamed) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const clearTagsItem = useRef<HTMLDivElement>(null);
  const rename = useClassificationRename({
    open,
    kind: "tag",
    load: loadTags,
    searchInput,
    onRenamed,
  });
  const { options: tags, loading, error } = rename;

  const emptyText = loading ? "Loading tags…" : (error ?? "No tags yet. Add #tag to a task.");
  const selectedSlugs = new Set(selected.map((tag) => tag.slug));

  function toggle(tag: ClassificationOption): void {
    if (rename.renaming) return;
    const exists = selectedSlugs.has(tag.slug);
    const next = exists ? selected.filter((entry) => entry.slug !== tag.slug) : [...selected, tag];
    onChange(next);
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const isSpace = event.key === " " || event.code === "Space";
    if (event.key !== "Enter" && !isSpace) return;

    const commandRoot = searchInput.current?.closest("[cmdk-root]");
    const activeItem = commandRoot?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
    if (event.key === "Enter") {
      event.preventDefault();
      if (
        (selected.length === 0 || activeItem === clearTagsItem.current) &&
        activeItem &&
        activeItem.getAttribute("aria-disabled") !== "true"
      ) {
        activeItem.click();
      }
      onClose();
      return;
    }
    if (!activeItem || activeItem.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    activeItem.click();
  }

  return (
    <PaletteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Filter by tags"
      description={`Select any number of tags. ${APP_NAME} must contain all selected tags. Space selects the highlighted tag; Enter selects it first when none are selected, then closes. F then T opens; Clear tags empties the filter, including with Enter. ${modKey}+R renames the highlighted tag on every task.`}
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
      <Command
        label="Filter tasks by tags"
        filter={literalWordScore}
        loop
        shouldFilter
        {...rename.commandProps}
      >
        <CommandInput
          ref={searchInput}
          {...rename.searchProps}
          placeholder="Search tags…"
          onKeyDown={handlePickerKeyDown}
        />
        <CommandList label="Tag results">
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandGroup
            heading={
              <span className="inline-flex items-center gap-1.5">
                <Tags aria-hidden="true" className="size-3.5" />
                Tags{selected.length > 0 ? ` (${selected.length} selected)` : ""}
              </span>
            }
          >
            {tags.map((tag) => {
              const checked = selectedSlugs.has(tag.slug);
              const field = rename.field(tag);
              return (
                <CommandItem
                  key={tag.slug}
                  value={itemValue(tag)}
                  keywords={[`${tag.taskCount} tasks`]}
                  onSelect={() => toggle(tag)}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-4 items-center justify-center rounded border"
                  >
                    {checked ? <Check aria-hidden="true" className="size-3" /> : null}
                  </span>
                  {field ?? <span className="font-medium">{tag.label}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {tag.taskCount} {tag.taskCount === 1 ? "task" : "tasks"}
                  </span>
                </CommandItem>
              );
            })}
            {selected.length > 0 ? (
              <CommandItem
                ref={clearTagsItem}
                value="Clear tags"
                keywords={["clear reset all"]}
                onSelect={() => {
                  if (!rename.renaming) onChange([]);
                }}
              >
                <span className="font-medium">Clear tags</span>
              </CommandItem>
            ) : null}
          </CommandGroup>
        </CommandList>
        {rename.footer}
      </Command>
    </PaletteDialog>
  );
}
