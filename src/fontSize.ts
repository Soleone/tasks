export const FONT_SIZE_INCREASES = [0, 10, 25, 33, 40] as const;

export type FontSizeIncrease = (typeof FONT_SIZE_INCREASES)[number];

const FONT_SIZE_STORAGE_KEY = "tasks.fontSizeIncrease";

function isFontSizeIncrease(value: number): value is FontSizeIncrease {
  return FONT_SIZE_INCREASES.includes(value as FontSizeIncrease);
}

export function readStoredFontSizeIncrease(): FontSizeIncrease {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    const value = stored === null ? 0 : Number(stored);
    return isFontSizeIncrease(value) ? value : 0;
  } catch {
    return 0;
  }
}

function applyFontSizeIncrease(increase: FontSizeIncrease): void {
  const root = document.documentElement;
  if (increase === 0) {
    root.style.removeProperty("font-size");
    return;
  }
  root.style.fontSize = `${100 + increase}%`;
}

export function storeFontSizeIncrease(increase: FontSizeIncrease): void {
  applyFontSizeIncrease(increase);
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(increase));
  } catch {
    // Without storage the choice lasts for this session.
  }
}

export function applyStoredFontSizeIncrease(): void {
  applyFontSizeIncrease(readStoredFontSizeIncrease());
}
