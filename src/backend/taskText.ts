export type ClassificationToken = {
  slug: string;
  label: string;
};

export type TaskClassification = {
  category: ClassificationToken | null;
  tags: ClassificationToken[];
};

export class TaskTextError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskTextError";
    this.code = code;
  }
}

function blankCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (code) => code.replace(/[^\n]/g, " "));
}

function token(slug: string): ClassificationToken {
  return { slug: slug.toLowerCase(), label: slug };
}

const classificationTokenPattern = /(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b/g;

function classificationTokenRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const searchableText = blankCode(text);

  for (const match of searchableText.matchAll(classificationTokenPattern)) {
    const boundary = match[1] ?? "";
    const marker = match[2] ?? "";
    const value = match[3] ?? "";
    const start = (match.index ?? 0) + boundary.length;
    ranges.push({ start, end: start + marker.length + value.length });
  }

  return ranges;
}

export function stripClassificationTokens(text: string): string {
  let stripped = text;
  for (const { start, end } of classificationTokenRanges(text).reverse()) {
    stripped = `${stripped.slice(0, start)}${stripped.slice(end)}`;
  }

  return stripped.replace(/[ \t]{2,}/g, " ").trim();
}

export function classifyTaskText(text: string): TaskClassification {
  const categories: ClassificationToken[] = [];
  const tags = new Map<string, ClassificationToken>();
  const searchableText = blankCode(text);

  for (const match of searchableText.matchAll(classificationTokenPattern)) {
    const marker = match[2];
    const value = match[3];
    if (!marker || !value) {
      continue;
    }

    const parsed = token(value);
    if (marker === "@") {
      if (!categories.some((category) => category.slug === parsed.slug)) {
        categories.push(parsed);
      }
      continue;
    }

    if (!tags.has(parsed.slug)) {
      tags.set(parsed.slug, parsed);
    }
  }

  if (categories.length > 1) {
    throw new TaskTextError("MULTIPLE_CATEGORIES", "a task can have only one @category");
  }

  return {
    category: categories[0] ?? null,
    tags: [...tags.values()],
  };
}
