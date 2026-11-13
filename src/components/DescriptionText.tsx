import { Fragment, type ReactNode } from "react";
import { Square, SquareCheck } from "lucide-react";
import { cn } from "cn";
import { preventFocusSteal } from "@/navigation";
import { canOpenLinks, linkParts, openLink } from "@/platform/links";
import { showTaskToast } from "@/components/TaskToaster";

// A Markdown link, a bare web address, **bold**, *italic* or _italic_. Emphasis marks must hug
// their text and stand apart from words, so `2 * 3` and `snake_case` stay as typed.
const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+|\*\*(\S(?:.*?\S)?)\*\*|(?<!\w)\*(\S(?:.*?\S)?)\*(?!\w)|(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g;

// A list item, or with `[ ]` or `[x]` after its dash a checklist item as GitHub writes them.
const LIST_ITEM = /^(?<indent>\s*)(?<dash>[-*]) (?:(?<box>\[[ xX]\]) )?(?<rest>.*)$/;

function listItem(line: string) {
  const item = LIST_ITEM.exec(line)?.groups;
  if (!item) return null;
  const { indent = "", dash = "", box, rest = "" } = item;
  return { indent, dash, box, rest, done: box !== undefined && box !== "[ ]" };
}

function Checkbox({ done, className }: { done: boolean; className: string }) {
  const Icon = done ? SquareCheck : Square;
  return <Icon aria-label={done ? "Done" : "To do"} className={cn("size-3", className)} />;
}

// The editor draws this over its own text, so nothing here may change a letter's width: bold is a
// stroke, not a weight.
const SOURCE_BOLD = "font-normal text-foreground [-webkit-text-stroke:0.4px_currentColor]";

function Mark({ children }: { children: string }) {
  return <span className="text-muted-foreground/60">{children}</span>;
}

/** Draws something else where typed characters are, in exactly their width. */
function Drawn({ typed, children }: { typed: string; children?: ReactNode }) {
  return (
    <span className="relative">
      <span className="invisible">{typed}</span>
      <span className="absolute inset-0 flex items-center">{children}</span>
    </span>
  );
}

function DescriptionLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      tabIndex={-1}
      className="underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground"
      onMouseDown={preventFocusSteal}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openLink(url).catch((error: unknown) =>
          showTaskToast(error instanceof Error ? error.message : String(error)),
        );
      }}
    >
      {children}
    </a>
  );
}

/** One line's inline Markdown. `source` keeps every character, with the marks dimmed. */
function inline(text: string, source: boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE);
  const mark = (value: string) => (source ? <Mark>{value}</Mark> : null);
  let end = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, label, target, bold, starred, underscored] = match;
    const key = match.index;
    let length = whole.length;
    let node: ReactNode;
    if (bold) {
      node = (
        <Fragment key={key}>
          {mark("**")}
          <strong className={source ? SOURCE_BOLD : "font-semibold"}>{inline(bold, source)}</strong>
          {mark("**")}
        </Fragment>
      );
    } else if (starred ?? underscored) {
      node = (
        <Fragment key={key}>
          {mark(whole.charAt(0))}
          <em>{inline(starred ?? underscored ?? "", source)}</em>
          {mark(whole.charAt(0))}
        </Fragment>
      );
    } else if (!canOpenLinks()) {
      continue;
    } else if (target) {
      node = (
        <Fragment key={key}>
          {mark("[")}
          <DescriptionLink url={target}>{label}</DescriptionLink>
          {mark(`](${target})`)}
        </Fragment>
      );
    } else {
      // The address without the punctuation that ends its sentence, which is read again as text.
      const address = linkParts(whole)[0];
      if (typeof address !== "object") continue;
      length = address.url.length;
      node = (
        <DescriptionLink key={key} url={address.url}>
          {address.url}
        </DescriptionLink>
      );
    }
    nodes.push(text.slice(end, match.index), node);
    end = match.index + length;
    pattern.lastIndex = end;
  }
  nodes.push(text.slice(end));
  return nodes;
}

/** A task's description with its basic Markdown shown: list and checklist items, bold, italic and links (`details.markdown`). */
export function DescriptionText({ text }: { text: string }): ReactNode {
  return text.split(/\r?\n/).map((line, index, lines) => {
    const item = listItem(line);
    return item ? (
      <span
        // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
        key={index}
        className={cn(
          "block",
          item.box ? "pl-4 -indent-4" : "pl-3 -indent-3",
          item.done && "text-muted-foreground",
        )}
      >
        {item.box ? (
          <span className="inline-block w-4 indent-0">
            <Checkbox done={item.done} className="inline align-[-0.125em]" />
          </span>
        ) : (
          <span className="inline-block w-3 indent-0">•</span>
        )}
        {inline(item.rest, false)}
      </span>
    ) : (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <Fragment key={index}>
        {inline(line, false)}
        {index < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

/** The description as typed, every character in place, styled as its Markdown reads (`edit.description-preview`). */
export function DescriptionSource({ text }: { text: string }): ReactNode {
  return text.split("\n").map((line, index) => {
    const item = listItem(line);
    return (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <Fragment key={index}>
        {item ? (
          <>
            {item.indent}
            <Drawn typed={item.dash}>
              {item.box ? null : <span className="before:content-['•']" />}
            </Drawn>{" "}
            {item.box ? (
              <>
                <Drawn typed={item.box}>
                  <Checkbox done={item.done} className="" />
                </Drawn>{" "}
              </>
            ) : null}
            <span className={cn(item.done && "text-muted-foreground")}>
              {inline(item.rest, true)}
            </span>
          </>
        ) : (
          inline(line, true)
        )}
        {"\n"}
      </Fragment>
    );
  });
}
