import { useEffect, useRef, type ReactElement, type Ref } from "react";
import { X } from "lucide-react";
import { InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { InputGroup } from "@/components/variants/input-group";

// Long enough to skip a query per keystroke while typing a word.
const TYPING_PAUSE_MS = 150;

export function InlineSearch({
  ref,
  initialQuery,
  onType,
  onSelect,
}: {
  ref: Ref<HTMLInputElement>;
  initialQuery: string;
  onType: (query: string) => void;
  onSelect: (query: string) => void;
}): ReactElement {
  const typing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(typing.current), []);

  function select(form: HTMLFormElement): void {
    window.clearTimeout(typing.current);
    // Read the form so a fast fill-then-Enter applies the displayed value.
    const query = new FormData(form).get("search");
    onSelect(typeof query === "string" ? query.trim() : "");
  }

  return (
    <form
      role="search"
      aria-label="Search tasks"
      onSubmit={(event) => {
        event.preventDefault();
        select(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        select(event.currentTarget);
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
          onChange={(event) => {
            const query = event.currentTarget.value.trim();
            window.clearTimeout(typing.current);
            typing.current = window.setTimeout(() => onType(query), TYPING_PAUSE_MS);
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            tabIndex={-1}
            aria-label="Clear search"
            onClick={() => {
              window.clearTimeout(typing.current);
              onSelect("");
            }}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
