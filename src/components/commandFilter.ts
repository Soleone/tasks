/**
 * Keeps palette searches literal: every typed word must appear in the label or keywords, and label
 * hits rank first. cmdk's default scorer treats any ordered letter subsequence as a match, which is
 * surprising for keyword-rich rows.
 */
export function literalWordScore(value: string, search: string, keywords?: string[]): number {
  const label = value.toLowerCase();
  const haystack = `${label} ${keywords?.join(" ").toLowerCase() ?? ""}`;
  const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  if (!words.every((word) => haystack.includes(word))) return 0;
  return words.reduce((score, word) => score + (label.includes(word) ? 2 : 1), 0);
}
