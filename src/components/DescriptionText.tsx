import { Fragment, type ReactNode } from "react";
import { preventFocusSteal } from "@/navigation";
import { canOpenLinks, linkParts, openLink } from "@/platform/links";
import { showTaskToast } from "@/components/TaskToaster";

// A Markdown link, a bare web address, **bold**, *italic* or _italic_. Emphasis marks must hug
// their text and stand apart from words, so `2 * 3` and `snake_case` stay as typed.
const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+|\*\*(\S(?:.*?\S)?)\*\*|(?<!\w)\*(\S(?:.*?\S)?)\*(?!\w)|(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g;

const LIST_ITEM = /^(\s*[-*] )(.*)$/;

// The editor draws this over its own text, so nothing here may change a letter's width: bold is a
// stroke, not a weight.
const SOURCE_BOLD = "font-normal text-foreground [-webkit-text-stroke:0.4px_currentColor]";

function Mark({ children }: { children: string }) {
  return <span className="text-muted-foreground/60">{children}</span>;
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

/** A task's description with its basic Markdown shown: list items, bold, italic and links (`details.markdown`). */
export function DescriptionText({ text }: { text: string }): ReactNode {
  return text.split(/\r?\n/).map((line, index, lines) => {
    const item = LIST_ITEM.exec(line);
    return item ? (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <span key={index} className="block pl-3 -indent-3">
        <span className="inline-block w-3 indent-0">•</span>
        {inline(item[2] ?? "", false)}
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
    const item = LIST_ITEM.exec(line);
    return (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <Fragment key={index}>
        {item ? <Mark>{item[1] ?? ""}</Mark> : null}
        {inline(item ? (item[2] ?? "") : line, true)}
        {"\n"}
      </Fragment>
    );
  });
}
