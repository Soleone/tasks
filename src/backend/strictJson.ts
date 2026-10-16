import { CommandError } from "./errors.js";

function invalidJson(): never {
  throw new CommandError(
    "INVALID_CANONICAL",
    "canonical JSON has invalid syntax, encoding or duplicate members",
  );
}

function validateUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xdc00 && unit <= 0xdfff) invalidJson();
    if (unit < 0xd800 || unit > 0xdbff) continue;
    const next = value.charCodeAt(++index);
    if (!(next >= 0xdc00 && next <= 0xdfff)) invalidJson();
  }
}

function validateDecodedJson(value: unknown): void {
  if (typeof value === "string") validateUnicode(value);
  if (typeof value === "number" && !Number.isFinite(value)) invalidJson();
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    validateUnicode(key);
    validateDecodedJson(child);
  }
}

// JSON.parse validates syntax but discards duplicate members, including escaped-name aliases.
function rejectDuplicateMembers(text: string): void {
  let position = 0;
  const whitespace = (): void => {
    while (/[\x20\t\r\n]/.test(text[position] ?? "x")) position += 1;
  };
  const stringToken = (): string => {
    const start = position++;
    while (text[position] !== '"') {
      if (text[position] === "\\") position += 1;
      position += 1;
    }
    position += 1;
    return JSON.parse(text.slice(start, position)) as string;
  };
  const valueToken = (): void => {
    whitespace();
    if (text[position] === '"') {
      stringToken();
      return;
    }
    if (text[position] === "{") {
      position += 1;
      whitespace();
      const keys = new Set<string>();
      while (text[position] !== "}") {
        const key = stringToken();
        if (keys.has(key)) invalidJson();
        keys.add(key);
        whitespace();
        position += 1;
        valueToken();
        whitespace();
        if (text[position] === ",") {
          position += 1;
          whitespace();
        }
      }
      position += 1;
      return;
    }
    if (text[position] === "[") {
      position += 1;
      whitespace();
      while (text[position] !== "]") {
        valueToken();
        whitespace();
        if (text[position] === ",") position += 1;
      }
      position += 1;
      return;
    }
    while (position < text.length && !/[\x20\t\r\n,}\]]/.test(text[position])) position += 1;
  };
  valueToken();
}

export function parseCanonicalJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    rejectDuplicateMembers(text);
    validateDecodedJson(value);
    return value;
  } catch {
    // Parser exceptions can include task text; expose only the stable boundary error.
    return invalidJson();
  }
}
