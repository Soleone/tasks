import { Fragment, type ReactNode } from "react";
import { preventFocusSteal } from "@/navigation";
import { canOpenLinks, linkParts, openLink } from "@/platform/links";
import { showTaskToast } from "@/components/TaskToaster";

// A Markdown link, a bare web address, **bold**, *italic* or _italic_. Emphasis marks must hug
// their text and stand apart from words, so `2 * 3` and `snake_case` stay as typed.
const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+|\*\*(\S(?:.*?\S)?)\*\*|(?<!\w)\*(\S(?:.*?\S)?)\*(?!\w)|(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g;

const LIST_ITEM = /^\s*[-*] (.*)$/;

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

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE);
  let end = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, label, target, bold, starred, underscored] = match;
    const key = match.index;
    let length = whole.length;
    let node: ReactNode;
    if (bold) {
      node = (
        <strong key={key} className="font-semibold">
          {inline(bold)}
        </strong>
      );
    } else if (starred ?? underscored) {
      node = <em key={key}>{inline(starred ?? underscored ?? "")}</em>;
    } else if (!canOpenLinks()) {
      continue;
    } else if (target) {
      node = (
        <DescriptionLink key={key} url={target}>
          {label}
        </DescriptionLink>
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
        {inline(item[1] ?? "")}
      </span>
    ) : (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <Fragment key={index}>
        {inline(line)}
        {index < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}
