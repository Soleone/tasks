import { type ComponentProps, Fragment, type ReactNode } from "react"
import { Square, SquareCheck } from "lucide-react"
import { cn } from "cn"

// A Markdown link, a bare web address, **bold**, *italic* or _italic_. Emphasis marks must hug
// their text and stand apart from words, so `2 * 3` and `snake_case` stay as typed.
const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+|\*\*(\S(?:.*?\S)?)\*\*|(?<!\w)\*(\S(?:.*?\S)?)\*(?!\w)|(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g

// A list item, or with `[ ]` or `[x]` after its dash a checklist item as GitHub writes them.
const LIST_ITEM = /^(\s*)([-*]) (?:(\[[ xX]\]) )?(.*)$/

function listItem(line: string) {
  const match = LIST_ITEM.exec(line)
  if (!match) return null
  const [, indent = "", dash = "", box, rest = ""] = match
  return { indent, dash, box, rest, done: box !== undefined && box !== "[ ]" }
}

/** A bare address without the punctuation that ends its sentence or closes a bracket opened before it. */
function trimAddress(address: string): string {
  let url = address.replace(/[.,;:!?]+$/, "")
  while (/[)\]}]$/.test(url) && !/[([{]/.test(url)) url = url.slice(0, -1).replace(/[.,;:!?]+$/, "")
  return url
}

/** What Enter types at `caret` in a list item: the next item's marker, or on an empty item the marker's removal, ending the list. */
function listEnter(text: string, caret: number) {
  const start = text.lastIndexOf("\n", caret - 1) + 1
  const end = text.indexOf("\n", caret)
  const item = listItem(text.slice(start, caret))
  if (!item) return null
  if (!listItem(text.slice(start, end === -1 ? undefined : end))?.rest.trim())
    return { start, end: caret, insert: "" }
  return { start: caret, end: caret, insert: `\n${item.indent}${item.dash} ${item.box ? "[ ] " : ""}` }
}

/** The text with the checklist box on line `index` ticked or unticked. */
function toggled(text: string, index: number, done: boolean): string {
  const lines = text.split(/(?<=\n)/)
  lines[index] = lines[index]!.replace(/\[[ xX]\]/, done ? "[ ]" : "[x]")
  return lines.join("")
}

function Checkbox({ done }: { done: boolean }) {
  const Icon = done ? SquareCheck : Square
  return <Icon aria-label={done ? "Done" : "To do"} className="size-[1em]" />
}

// The editor draws this over its own text, so nothing here may change a letter's width: bold is a
// stroke, not a weight.
const SOURCE_BOLD = "font-normal text-foreground [-webkit-text-stroke:0.4px_currentColor]"

function Mark({ children }: { children: string }) {
  return <span className="text-muted-foreground/60">{children}</span>
}

/** Draws something else where typed characters are, in exactly their width, from their left edge. */
function Drawn({ typed, children }: { typed: string; children?: ReactNode }) {
  return (
    <span className="relative">
      <span className="invisible">{typed}</span>
      <span className="absolute inset-0 flex items-center">{children}</span>
    </span>
  )
}

/**
 * A bullet's dot, or a checklist box standing where the dot would, over the dash and the brackets.
 * The dot is drawn by CSS, so the editor's copy keeps exactly the field's text.
 */
function ListMarker({ item }: { item: NonNullable<ReturnType<typeof listItem>> }) {
  return item.box ? (
    <Drawn typed={`${item.dash} ${item.box}`}>
      <Checkbox done={item.done} />
    </Drawn>
  ) : (
    <Drawn typed={item.dash}>
      <span className="before:content-['•']" />
    </Drawn>
  )
}

function Link({ url, onOpen, children }: { url: string; onOpen: (url: string) => void; children: ReactNode }) {
  return (
    <a
      href={url}
      tabIndex={-1}
      className="underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground"
      // Opening a link leaves focus where it was.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(url)
      }}
    >
      {children}
    </a>
  )
}

/** One line's inline Markdown. In `source`, every character stays, with the marks dimmed. */
function inline(text: string, source: boolean, onOpenLink?: (url: string) => void): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = new RegExp(INLINE)
  const mark = (value: string) => (source ? <Mark>{value}</Mark> : null)
  let end = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, label, target, bold, starred, underscored] = match
    const key = match.index
    let length = whole.length
    let node: ReactNode
    if (bold) {
      node = (
        <Fragment key={key}>
          {mark("**")}
          <strong className={source ? SOURCE_BOLD : "font-semibold"}>{inline(bold, source, onOpenLink)}</strong>
          {mark("**")}
        </Fragment>
      )
    } else if (starred ?? underscored) {
      node = (
        <Fragment key={key}>
          {mark(whole.charAt(0))}
          <em>{inline(starred ?? underscored ?? "", source, onOpenLink)}</em>
          {mark(whole.charAt(0))}
        </Fragment>
      )
    } else if (!onOpenLink) {
      continue
    } else if (target) {
      node = (
        <Fragment key={key}>
          {mark("[")}
          <Link url={target} onOpen={onOpenLink}>
            {label}
          </Link>
          {mark(`](${target})`)}
        </Fragment>
      )
    } else {
      // The punctuation after the address is read again as text.
      const url = trimAddress(whole)
      if (!URL.canParse(url)) continue
      length = url.length
      node = (
        <Link key={key} url={url} onOpen={onOpenLink}>
          {url}
        </Link>
      )
    }
    nodes.push(text.slice(end, match.index), node)
    end = match.index + length
    pattern.lastIndex = end
  }
  nodes.push(text.slice(end))
  return nodes
}

/**
 * Text with its basic Markdown shown and its marks hidden: list and checklist items, bold, italic
 * and, with `onOpenLink`, links. With `onChange`, clicking a checklist box ticks or unticks it.
 * Renders inline content: place it in an element that keeps line breaks, such as `whitespace-pre-line`.
 */
function MarkdownText({
  text,
  onChange,
  onOpenLink,
}: {
  text: string
  onChange?: (text: string) => void
  onOpenLink?: (url: string) => void
}): ReactNode {
  return text.split(/\r?\n/).map((line, index, lines) => {
    const item = listItem(line)
    if (!item)
      return (
        // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
        <Fragment key={index}>
          {inline(line, false, onOpenLink)}
          {index < lines.length - 1 ? "\n" : null}
        </Fragment>
      )
    // The marker takes the width of its typed characters, so items line up as in the editor.
    const marker = (
      <span className="shrink-0 whitespace-pre">
        {item.indent}
        {item.box && onChange ? (
          <span
            role="checkbox"
            aria-checked={item.done}
            aria-label={item.rest}
            tabIndex={-1}
            className="cursor-pointer"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              onChange(toggled(text, index, item.done))
            }}
          >
            <ListMarker item={item} />
          </span>
        ) : (
          <ListMarker item={item} />
        )}{" "}
      </span>
    )
    return (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <span key={index} className={cn("flex", item.done && "text-muted-foreground")}>
        {marker}
        <span className="min-w-0">{inline(item.rest, false, onOpenLink)}</span>
      </span>
    )
  })
}

/** The text as typed, every character in place, styled as its Markdown reads. Boxes carry their offset in `data-box`. */
function MarkdownSource({ text }: { text: string }): ReactNode {
  let lineStart = 0
  return text.split("\n").map((line, index) => {
    const item = listItem(line)
    const start = lineStart
    lineStart += line.length + 1
    return (
      // eslint-disable-next-line react/no-array-index-key -- lines of one string never reorder
      <Fragment key={index}>
        {item ? (
          <>
            {item.indent}
            {item.box ? (
              <span data-box={start + item.indent.length + item.dash.length + 1} className="pointer-events-auto cursor-pointer">
                <ListMarker item={item} />
              </span>
            ) : (
              <ListMarker item={item} />
            )}{" "}
            <span className={cn(item.done && "text-muted-foreground")}>{inline(item.rest, true)}</span>
          </>
        ) : (
          inline(line, true)
        )}
        {"\n"}
      </Fragment>
    )
  })
}

/**
 * A plain textarea whose Markdown is styled as you type, every character kept: a styled copy lies
 * over the field's invisible text, so caret, selection, undo, spellcheck and phone keyboards stay
 * native. Enter continues a list, Enter on an empty item ends it, and clicking a checklist box
 * ticks it. `className` styles the field's box and type; both layers inherit the type.
 */
function MarkdownTextarea({
  className,
  value,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"textarea">, "value"> & { value: string }) {
  return (
    <div
      data-slot="markdown-textarea"
      className={cn(
        "grid w-full overflow-y-auto rounded-lg border border-input px-2.5 py-2 text-base transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm",
        className,
      )}
    >
      <textarea
        className="col-start-1 row-start-1 field-sizing-content min-h-0 resize-none overflow-hidden bg-transparent text-transparent outline-none selection:text-transparent placeholder:text-muted-foreground"
        value={value}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return
          const field = event.currentTarget
          const plainEnter =
            event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
          const edit =
            plainEnter && field.selectionStart === field.selectionEnd ? listEnter(field.value, field.selectionStart) : null
          if (!edit) return
          event.preventDefault()
          field.setRangeText(edit.insert, edit.start, edit.end, "end")
          field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
        }}
        {...props}
      />
      {/* Only its checklist boxes take the pointer: a press ticks or unticks one in the field's
          text, keeping focus and the caret where they were. */}
      <div
        aria-hidden
        className="pointer-events-none col-start-1 row-start-1 wrap-break-word whitespace-pre-wrap"
        onMouseDown={(event) => {
          const box = (event.target as Element).closest<HTMLElement>("[data-box]")
          const field = event.currentTarget.parentElement?.querySelector("textarea")
          if (!box || !field || field.readOnly) return
          event.preventDefault()
          const start = Number(box.dataset.box)
          const done = field.value.slice(start, start + 3) !== "[ ]"
          field.setRangeText(done ? "[ ]" : "[x]", start, start + 3, "preserve")
          field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
        }}
      >
        <MarkdownSource text={value} />
      </div>
    </div>
  )
}

export { MarkdownText, MarkdownTextarea }
