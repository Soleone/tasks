import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Folder } from "lucide-react";
import type { CategoryRecord } from "@/legacy/backend/protocol";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, literalWordScore } from "@/components/ui/command";
import { listCategories } from "@/platform/backendClient";

export function CategoryPicker({ open, onClose, finalFocus, onSelect }: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  onSelect: (category: CategoryRecord) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCategories()
      .then((result) => {
        if (cancelled) return;
        setCategories(result.categories);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setCategories([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const emptyText = loading ? "Loading categories…" : error ?? "No categories yet. Add @category to a task.";
  const countDigits = Math.max(2, ...categories.map((category) => String(category.taskCount).length));

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Filter by category"
      description="Choose a category to show only its tasks."
      initialFocus={searchInput}
      finalFocus={finalFocus}
    >
        <Command label="Filter tasks by category" filter={literalWordScore} loop>
          <CommandInput ref={searchInput} placeholder="Search categories…" />
          <CommandList label="Category results">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup
              style={{ "--category-count-width": `${countDigits}ch` } as CSSProperties}
              heading={(
                <span className="inline-flex items-center gap-1.5">
                  <Folder aria-hidden="true" className="size-3.5" />
                  Categories
                </span>
              )}
            >
              {categories.map((category) => (
                <CommandItem
                  key={category.slug}
                  value={`${category.label} ${category.slug}`}
                  keywords={[`${category.taskCount} tasks`]}
                  onSelect={() => onSelect(category)}
                  className="[&>svg:last-child]:hidden"
                >
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <span className="truncate font-medium">{category.label}</span>
                    <span data-category-count className="grid shrink-0 grid-cols-[auto_max-content] items-center gap-x-1 text-muted-foreground">
                      <span data-category-count-value className="w-[var(--category-count-width)] text-right tabular-nums">
                        {category.taskCount}
                      </span>
                      <span data-category-count-unit className="grid whitespace-nowrap">
                        <span aria-hidden="true" className="invisible col-start-1 row-start-1">tasks</span>
                        <span data-category-count-unit-label className="col-start-1 row-start-1">
                          {category.taskCount === 1 ? "task" : "tasks"}
                        </span>
                      </span>
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
    </CommandDialog>
  );
}
