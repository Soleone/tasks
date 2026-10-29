import type { Plugin } from "vite";
// Relative on purpose: vite.config.ts loads this before Vite's `@` alias exists.
import type { PaletteTheme } from "../components/soleone/theme/head";
import { parseThemeFile, type ThemePalette } from "../components/soleone/theme/palette";

/** WCAG's floor for icons and other non-text marks. */
const ICON_CONTRAST = 3;

const rgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const fromLinear = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => toLinear(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Mixes in linear light: fraction 0 returns `from`, 1 returns `toward`. */
function mix(from: string, toward: string, fraction: number): string {
  const target = rgb(toward);
  const channels = rgb(from).map((channel, i) => {
    const start = toLinear(channel / 255);
    const value = fromLinear(start + (toLinear(target[i] / 255) - start) * fraction) * 255;
    return Math.round(value).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/**
 * The P4 icon color a palette can't give by itself: the icon's usual color faded toward the card as
 * far as it still holds 3:1, so a light theme, which has little room, fades less than a dark one.
 */
export function faintIconColor(color: string, palette: ThemePalette): string {
  const { background } = palette;
  const surfaces = [background, palette.dark_background, palette.lighter_background];

  let faint = color;
  for (let fraction = 0.01; fraction <= 1; fraction += 0.01) {
    const candidate = mix(color, background, fraction);
    if (!surfaces.every((surface) => contrastRatio(candidate, surface) >= ICON_CONTRAST)) break;
    faint = candidate;
  }
  return faint;
}

/** Inlines each theme's faint icon colors, for open and done P4 tasks, beside the palette tokens themeStyles writes. */
export function priorityColorsPlugin(themes: PaletteTheme[]): Plugin {
  const styles = themes
    .map(({ name, toml }) => {
      const { palette } = parseThemeFile(toml);
      const faint = faintIconColor(palette.muted_foreground, palette);
      const doneFaint = faintIconColor(palette.green, palette);
      return `[data-theme="${name}"]{--priority-faint:${faint};--success-faint:${doneFaint}}`;
    })
    .join("\n");

  return {
    name: "tasks-priority-colors",
    transformIndexHtml: () => [{ tag: "style", children: styles, injectTo: "head" }],
  };
}
