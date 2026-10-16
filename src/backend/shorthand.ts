import { CommandError } from "./errors.js";
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

export function parseShorthand(input: string): Pick<CanonicalTask, "title" | "category" | "tags"> {
  let decoded = "";
  const protectedUnits: boolean[] = [];
  const append = (value: string, protect: boolean): void => {
    decoded += value;
    for (let index = 0; index < value.length; index += 1) protectedUnits.push(protect);
  };
  for (let index = 0; index < input.length;) {
    if (input.startsWith("```", index)) {
      const close = input.indexOf("```", index + 3);
      const end = close === -1 ? input.length : close + 3;
      append(input.slice(index, end), true);
      index = end;
      continue;
    }
    if (input[index] === "`") {
      const close = input.indexOf("`", index + 1);
      if (close !== -1 && !input.slice(index, close).includes("\n")) {
        append(input.slice(index, close + 1), true);
        index = close + 1;
        continue;
      }
    }
    if (input[index] === "\\" && ["@", "#", "\\"].includes(input[index + 1])) {
      const escaped = input[index + 1];
      append(escaped, escaped === "@" || escaped === "#");
      index += 2;
      continue;
    }
    append(input[index++], false);
  }
  const categories = new Set<string>();
  const tags = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  // Escaped markers still participate in boundary checks after decoding.
  for (const match of decoded.matchAll(/(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b/g)) {
    const start = match.index + match[1].length;
    if (protectedUnits.slice(start, start + match[2].length + match[3].length).some(Boolean))
      continue;
    const slug = slugInput(match[3]);
    (match[2] === "@" ? categories : tags).add(slug);
    ranges.push({ start, end: start + 1 + match[3].length });
  }
  if (categories.size > 1)
    throw new CommandError("MULTIPLE_CATEGORIES", "shorthand contains multiple categories");
  let title = decoded;
  for (const range of ranges.reverse()) {
    // A marker between two spaces leaves one space, not two.
    const end =
      title[range.start - 1] === " " && title[range.end] === " " ? range.end + 1 : range.end;
    title = title.slice(0, range.start) + title.slice(end);
  }
  return { title: title.trim(), category: [...categories][0] ?? null, tags: [...tags].sort() };
}

/** The typed text, or null once a later change to title or classification no longer matches it. */
export function typedText(
  task: Pick<CanonicalTask, "title" | "text" | "category" | "tags">,
): string | null {
  if (task.text === null) return null;
  try {
    const parsed = parseShorthand(task.text);
    return parsed.title === task.title &&
      parsed.category === task.category &&
      parsed.tags.join() === task.tags.join()
      ? task.text
      : null;
  } catch {
    return null;
  }
}
