import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SearchDialog({ open, onClose, finalFocus, initialQuery, onSelect }: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  initialQuery: string;
  onSelect: (query: string) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  // Read the submitted value from the form, not from state: a fast
  // fill-then-Enter (or type-then-Enter) must apply what is on screen even if
  // a state update has not flushed yet.
  function apply(value: string): void {
    onSelect(value.trim());
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search tasks</DialogTitle>
      </DialogHeader>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogDescription>Titles and descriptions. No autocomplete; combines with every other filter.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            apply(String(data.get("search") ?? ""));
          }}
          className="flex flex-col gap-4"
        >
          <Field>
            <FieldLabel htmlFor="task-search-input">Search query</FieldLabel>
            <Input
              ref={searchInput}
              id="task-search-input"
              name="search"
              autoComplete="off"
              placeholder="Try “venue” or “accessibility”…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query.trim() === "") {
                  event.stopPropagation();
                  onSelect("");
                }
              }}
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={query.trim() === "" && initialQuery === ""}
              onClick={() => onSelect("")}
            >
              Clear search
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Apply search
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
