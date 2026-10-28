import { CommandError } from "./errors.js";
import { localToday, parseDueWord } from "./dueDate.js";
import type { CanonicalTask } from "./taskModel.js";

const slugPattern = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;

export function invalidInput(field: string): never {
  throw new CommandError("INVALID_ARGUMENT", `invalid task ${field}`);
}

export function slugInput(value: unknown): string {
  if (typeof value !== "string") invalidInput("classification");
  const slug = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (!slugPattern.test(slug)) invalidInput("classification");
  return slug;
}

export type ParsedShorthand = Pick<CanonicalTask, "title" | "category" | "tags"> & {
  due: string | null;
  /** The input, trimmed, with each due word replaced by its date so it reads the same later. */
  text: string;
};

export function parseShorthand(input: string, today = localToday()): ParsedShorthand {
  let decoded = "";
  const protectedUnits: boolean[] = [];
  // Where each decoded unit starts in the input, to rewrite due words in place.
  const inputIndex: number[] = [];
  const append = (value: string, protect: boolean, from: number): void => {
    decoded += value;
    for (let index = 0; index < value.length; index += 1) {
      protectedUnits.push(protect);
      inputIndex.push(from + index);
    }
  };
  for (let index = 0; index < input.length;) {
    if (input.startsWith("```", index)) {
      const close = input.indexOf("```", index + 3);
      const end = close === -1 ? input.length : close + 3;
      append(input.slice(index, end), true, index);
      index = end;
      continue;
    }
    if (input[index] === "`") {
      const close = input.indexOf("`", index + 1);
      if (close !== -1 && !input.slice(index, close).includes("\n")) {
        append(input.slice(index, close + 1), true, index);
        index = close + 1;
        continue;
      }
    }
    if (input[index] === "\\" && ["@", "#", "!", "\\"].includes(input[index + 1])) {
      const escaped = input[index + 1];
      append(escaped, escaped !== "\\", index);
      index += 2;
      continue;
    }
    append(input[index], false, index);
    index += 1;
  }
  const categories = new Set<string>();
  const tags = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  // Escaped markers still participate in boundary checks after decoding.
  for (const match of decoded.matchAll(
    /(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b(?![\w-]*[@#])/g,
  )) {
    const start = match.index + match[1].length;
    if (protectedUnits.slice(start, start + match[2].length + match[3].length).some(Boolean))
      continue;
    const slug = slugInput(match[3]);
    (match[2] === "@" ? categories : tags).add(slug);
    ranges.push({ start, end: start + 1 + match[3].length });
  }
  const dues = new Set<string>();
  let text = input;
  for (const match of [
    ...decoded.matchAll(/(^|[^A-Za-z0-9_/@!])!([A-Za-z0-9][A-Za-z0-9-]*)\b/g),
  ].reverse()) {
    const start = match.index + match[1].length;
    const end = start + 1 + match[2].length;
    if (protectedUnits.slice(start, end).some(Boolean)) continue;
    const due = parseDueWord(match[2], today);
    if (due === null) continue;
    dues.add(due);
    ranges.push({ start, end });
    text = `${text.slice(0, inputIndex[start] + 1)}${due}${text.slice(inputIndex[end - 1] + 1)}`;
  }
  if (categories.size > 1)
    throw new CommandError("MULTIPLE_CATEGORIES", "shorthand contains multiple categories");
  if (dues.size > 1) throw new CommandError("INVALID_ARGUMENT", "shorthand contains two due dates");
  let title = decoded;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    // A marker between two spaces leaves one space, not two.
    const end =
      title[range.start - 1] === " " && title[range.end] === " " ? range.end + 1 : range.end;
    title = title.slice(0, range.start) + title.slice(end);
  }
  return {
    title: title.trim(),
    category: [...categories][0] ?? null,
    tags: [...tags].sort(),
    due: [...dues][0] ?? null,
    text: text.trim(),
  };
}

/** The typed text, or null once a later edit to what it sets no longer matches it. */
export function typedText(
  task: Pick<CanonicalTask, "title" | "text" | "category" | "tags" | "due">,
): string | null {
  if (task.text === null) return null;
  try {
    const parsed = parseShorthand(task.text);
    return parsed.title === task.title &&
      parsed.category === task.category &&
      parsed.tags.join() === task.tags.join() &&
      parsed.due === (task.due ?? null)
      ? task.text
      : null;
  } catch {
    return null;
  }
}
