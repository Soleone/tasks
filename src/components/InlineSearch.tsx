import type { ReactElement, Ref } from "react";
import { X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function InlineSearch({
  ref,
  initialQuery,
  onSelect,
  onClose,
}: {
  ref: Ref<HTMLInputElement>;
  initialQuery: string;
  onSelect: (query: string) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <form
      role="search"
      aria-label="Search tasks"
      onSubmit={(event) => {
        event.preventDefault();
        // Read the form so a fast fill-then-Enter applies the displayed value.
        const query = new FormData(event.currentTarget).get("search");
        onSelect(typeof query === "string" ? query.trim() : "");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        const query = new FormData(event.currentTarget).get("search");
        if (typeof query === "string" && query.trim() === "") onSelect("");
        else onClose();
      }}
    >
      <InputGroup>
        <InputGroupInput
          ref={ref}
          id="task-search-input"
          name="search"
          aria-label="Search query"
          aria-controls="task-list"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search tasks…"
          defaultValue={initialQuery}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            tabIndex={-1}
            aria-label="Clear search"
            onClick={() => onSelect("")}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
