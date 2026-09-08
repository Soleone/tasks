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

export function classifyTaskText(text: string): TaskClassification {
  const categories: ClassificationToken[] = [];
  const tags = new Map<string, ClassificationToken>();
  const searchableText = blankCode(text);
  const tokenPattern = /(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b/g;

  for (const match of searchableText.matchAll(tokenPattern)) {
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
