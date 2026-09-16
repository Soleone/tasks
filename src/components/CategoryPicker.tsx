import { useEffect, useRef, useState, type ReactElement } from "react";
import { Folder } from "lucide-react";
import type { CategoryRecord } from "@/backend/protocol";
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
                >
                  <span className="font-medium">{category.label}</span>
                  <span className="ml-auto text-muted-foreground">{category.taskCount} {category.taskCount === 1 ? "task" : "tasks"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
    </CommandDialog>
  );
}
