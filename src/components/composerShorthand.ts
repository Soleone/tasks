import { localToday, parseDueWord } from "@/backend/dueDate";
import type { ClassificationOption } from "./taskView";

export type Marker = "@" | "#" | "^";

/**
 * A `@category`, `#tag` or `^due` in the title field, with its code-unit range. The slug of a due
 * marker is the date it names.
 */
type ShorthandToken = { marker: Marker; slug: string; start: number; end: number };

/** The pills under the title field. Tags keep the order they were added in. */
export type Classification = { category: string | null; tags: string[]; due: string | null };

type LiftChange = "added" | "replaced" | "removed" | "kept";

/** What the title field holds: its text, the caret and the pills. */
export type TitleDraft = { text: string; caret: number; classification: Classification };

export type Lift = {
  before: TitleDraft;
  draft: TitleDraft;
  token: ShorthandToken;
  change: LiftChange;
};

/** A category or tag marker and partial name right before the caret, with their range. */
export type PartialToken = { marker: "@" | "#"; query: string; start: number; end: number };

export type SuggestionRow = { slug: string; label: string; kind: "add" | "remove" | "new" };

// Same marker grammar as parseShorthand in the backend.
const TOKEN = /(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b(?![\w-]*[@#])/g;
const DUE_TOKEN = /(^|[^A-Za-z0-9_/@^])\^([A-Za-z0-9][A-Za-z0-9-]*)\b/g;
const TOKEN_BEFORE_CARET = /(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)?$/;

// Escapes and code spans never classify, as in parseShorthand.
function protectedUnits(text: string): boolean[] {
  const units = Array.from({ length: text.length }, () => false);
  for (let index = 0; index < text.length;) {
    if (text.startsWith("```", index)) {
      const close = text.indexOf("```", index + 3);
      const end = close === -1 ? text.length : close + 3;
      units.fill(true, index, end);
      index = end;
      continue;
    }
    if (text[index] === "`") {
      const close = text.indexOf("`", index + 1);
      if (close !== -1 && !text.slice(index, close).includes("\n")) {
        units.fill(true, index, close + 1);
        index = close + 1;
        continue;
      }
    }
    if (text[index] === "\\" && ["@", "#", "^", "\\"].includes(text[index + 1])) {
      units.fill(true, index, index + 2);
      index += 2;
      continue;
    }
    index += 1;
  }
  return units;
}

function shorthandTokens(text: string): ShorthandToken[] {
  const isProtected = protectedUnits(text);
  const tokens: ShorthandToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index + match[1].length;
    if (isProtected[start]) continue;
    const marker = match[2] as Marker;
    tokens.push({ marker, slug: match[3].toLowerCase(), start, end: start + 1 + match[3].length });
  }
  const today = localToday();
  for (const match of text.matchAll(DUE_TOKEN)) {
    const start = match.index + match[1].length;
    const due = isProtected[start] ? null : parseDueWord(match[2], today);
    if (due !== null)
      tokens.push({ marker: "^", slug: due, start, end: start + 1 + match[2].length });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

// A token is finished once whitespace follows it and the caret has moved past.
function finishedToken(text: string, caret: number): ShorthandToken | null {
  return (
    shorthandTokens(text).find((token) => token.end < caret && /\s/.test(text[token.end])) ?? null
  );
}

/** The marker and partial name right before the caret, for suggestions. */
export function tokenBeforeCaret(text: string, caret: number): PartialToken | null {
  const match = text.slice(0, caret).match(TOKEN_BEFORE_CARET);
  if (!match) return null;
  const query = match[3] ?? "";
  const start = caret - query.length - 1;
  if (protectedUnits(text)[start]) return null;
  return { marker: match[2] as "@" | "#", query: query.toLowerCase(), start, end: caret };
}

/**
 * Takes the token out of the text. A token between two spaces takes one of them with it; the space
 * before a trailing token stays so typing can continue.
 */
function removeToken(
  text: string,
  caret: number,
  token: Pick<ShorthandToken, "start" | "end">,
): { text: string; caret: number } {
  const end =
    text[token.end] === " " && (token.start === 0 || text[token.start - 1] === " ")
      ? token.end + 1
      : token.end;
  const removed = end - token.start;
  return {
    text: text.slice(0, token.start) + text.slice(end),
    caret: caret >= end ? caret - removed : Math.min(caret, token.start),
  };
}

/** With `toggle`, a pill that is already there comes off instead. */
function applyToken(
  classification: Classification,
  token: Pick<ShorthandToken, "marker" | "slug">,
  toggle: boolean,
): { classification: Classification; change: LiftChange } {
  const { category, tags, due } = classification;
  if (token.marker === "@" || token.marker === "^") {
    const field = token.marker === "@" ? "category" : "due";
    const current = token.marker === "@" ? category : due;
    if (current === token.slug)
      return toggle
        ? { classification: { ...classification, [field]: null }, change: "removed" }
        : { classification, change: "kept" };
    return {
      classification: { ...classification, [field]: token.slug },
      change: current === null ? "added" : "replaced",
    };
  }
  if (tags.includes(token.slug))
    return toggle
      ? {
          classification: { ...classification, tags: tags.filter((tag) => tag !== token.slug) },
          change: "removed",
        }
      : { classification, change: "kept" };
  return { classification: { ...classification, tags: [...tags, token.slug] }, change: "added" };
}

/** Moves one token from the text into the pills. */
export function liftToken(draft: TitleDraft, token: ShorthandToken, toggle: boolean): Lift {
  const removed = removeToken(draft.text, draft.caret, token);
  const applied = applyToken(draft.classification, token, toggle);
  return {
    before: draft,
    draft: { ...removed, classification: applied.classification },
    token,
    change: applied.change,
  };
}

/** Lifts every finished token, as after typing a space or pasting; returns the last lift. */
export function liftFinished(draft: TitleDraft, toggle: boolean): Lift | null {
  let last: Lift | null = null;
  for (let token = finishedToken(draft.text, draft.caret); token;) {
    last = liftToken(last?.draft ?? draft, token, toggle);
    token = finishedToken(last.draft.text, last.draft.caret);
  }
  return last;
}

/** Lifts every token left in the text, never removing a pill. Used on save and for prefilled text. */
export function liftAll(
  text: string,
  classification: Classification,
): { text: string; classification: Classification } {
  const tokens = shorthandTokens(text);
  let remaining = text;
  // From the end, so removing one token leaves the earlier ranges valid.
  for (const token of [...tokens].reverse())
    remaining = removeToken(remaining, remaining.length, token).text;
  return {
    text: remaining,
    classification: tokens.reduce(
      (current, token) => applyToken(current, token, false).classification,
      classification,
    ),
  };
}

/**
 * Rows for a partial marker: names to add, then pills already on the task (to remove), then the
 * typed name if it is new. An exact match moves to the top; the new name always stays last.
 */
export function suggestionRows(
  query: string,
  options: ClassificationOption[],
  current: string[],
): SuggestionRow[] {
  const adds: SuggestionRow[] = options
    .filter((option) => option.slug.startsWith(query) && !current.includes(option.slug))
    .map((option) => ({ slug: option.slug, label: option.label, kind: "add" }));
  const removes: SuggestionRow[] = current
    .filter((slug) => slug.startsWith(query))
    .map((slug) => ({ slug, label: slug, kind: "remove" }));
  const known = [...adds, ...removes].sort(
    (a, b) => Number(b.slug === query) - Number(a.slug === query),
  );
  const isNew = query !== "" && !known.some((row) => row.slug === query);
  return isNew ? [...known, { slug: query, label: query, kind: "new" }] : known;
}

/** Enter takes the highlighted row; a row that only repeats what is typed saves instead. */
export function enterAction(row: SuggestionRow, query: string): "select" | "save" | "remove" {
  if (row.kind === "remove") return "remove";
  return row.slug === query ? "save" : "select";
}

// A `^` in a saved title is escaped only where it would set a due date, so `x^2` reads as typed.
function isDueMarker(title: string, index: number): boolean {
  DUE_TOKEN.lastIndex = Math.max(0, index - 1);
  const match = DUE_TOKEN.exec(title);
  DUE_TOKEN.lastIndex = 0;
  return (
    match !== null &&
    match.index + match[1].length === index &&
    parseDueWord(match[2], localToday()) !== null
  );
}

/** A saved title as the title field shows it: literal markers escaped so they stay text. */
export function shorthandTitle(title: string): string {
  let escaped = "";
  for (let index = 0; index < title.length;) {
    const marker = title.startsWith("```", index) ? "```" : title[index] === "`" ? "`" : null;
    if (marker) {
      const close = title.indexOf(marker, index + marker.length);
      const protectedEnd = close < 0 ? title.length : close + marker.length;
      if (marker === "```" || (close >= 0 && !title.slice(index, close).includes("\n"))) {
        escaped += title.slice(index, protectedEnd);
        index = protectedEnd;
        continue;
      }
    }
    const character = title[index];
    const literalMarker =
      ["\\", "@", "#"].includes(character) || (character === "^" && isDueMarker(title, index));
    escaped += literalMarker ? `\\${character}` : character;
    index += 1;
  }
  return escaped;
}

/** The shorthand the backend parses back into this title and these pills. */
export function shorthandText(title: string, classification: Classification): string {
  const markers = [
    ...(classification.category ? [`@${classification.category}`] : []),
    ...classification.tags.map((tag) => `#${tag}`),
    ...(classification.due ? [`^${classification.due}`] : []),
  ];
  // Markers go first so an unclosed code fence in the title cannot swallow them.
  return [...markers, title.trim()].filter(Boolean).join(" ");
}
