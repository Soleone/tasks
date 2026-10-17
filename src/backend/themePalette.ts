/**
 * Theme palettes in the omarchy `colors.toml` format.
 *
 * Pure module: no Node, DOM, or database imports, so the backend, the CLI, and
 * the web UI share one parser and one set of color rules. A resolved palette is
 * applied by the UI as `--om-*` custom properties; `src/styles.css` maps those
 * palette slots onto the region tokens the components consume.
 *
 * Palette keys are omarchy's, including the two name collisions worth knowing:
 * omarchy `accent` is the brand color (our `--primary` and focus ring), while
 * shadcn `--accent` is a quiet hover surface, and omarchy `muted` is a
 * de-emphasized ink used for dividers, not a surface.
 *
 * Two keys are ours rather than omarchy's: `on_accent` (ink on an accent fill),
 * `on_red` (ink on a destructive fill), and `muted_foreground` (secondary text).
 * All three are derived to stay readable, and a theme file may set any of them
 * directly.
 */

export type ThemeMode = "dark" | "light" | "system";

/** Canonical omarchy slot name to color, for example `dark_background`. */
type ThemePalette = Record<string, string>;

export type ResolvedTheme = {
  mode: ThemeMode;
  palette: ThemePalette;
  warnings: string[];
};

export type ThemeRecord = ResolvedTheme & {
  name: string;
  label: string;
  source: "builtin" | "workspace" | "omarchy";
};

/** The built-in theme selected when no workspace choice exists. */
export const GILT_THEME_NAME = "gilt";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ASSIGNMENT = /^([A-Za-z0-9_.-]+)[ \t]*=[ \t]*(.*)$/;
const MODES: readonly string[] = ["dark", "light", "system"];

/** Legacy omarchy short names; the canonical name wins when both appear. */
const LEGACY_KEYS: Record<string, string> = {
  bg: "background",
  dark_bg: "dark_background",
  darker_bg: "darker_background",
  lighter_bg: "lighter_background",
  fg: "foreground",
  dark_fg: "dark_foreground",
  light_fg: "light_foreground",
  bright_fg: "bright_foreground",
};

/**
 * Slots the regions are built from. A non-hex value here is reported as a
 * warning; decorative keys such as `orange` or a Hyprland gradient are other
 * apps' business and are skipped quietly.
 */
const REGION_SLOTS = new Set([
  "background",
  "foreground",
  "accent",
  "on_accent",
  "on_red",
  "selection",
  "muted",
  "muted_foreground",
  "dark_background",
  "darker_background",
  "lighter_background",
  "dark_foreground",
  "light_foreground",
  "bright_foreground",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "magenta",
  "brown",
]);

type Rgb = { r: number; g: number; b: number };

function parseHexColor(value: string): Rgb | null {
  if (!HEX_COLOR.test(value)) return null;
  const digits = value.slice(1);
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function requireRgb(value: string): Rgb {
  const rgb = parseHexColor(value);
  if (!rgb) throw new Error(`not a hex color: ${value}`);
  return rgb;
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Expands three-digit hex so palettes reach the UI in one shape. Alpha is kept. */
function normalizeHex(value: string): string {
  const digits = value.slice(1);
  if (digits.length !== 3) return value.toLowerCase();
  return `#${digits
    .split("")
    .map((digit) => digit + digit)
    .join("")}`.toLowerCase();
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function relativeLuminance(value: string): number {
  const { r, g, b } = requireRgb(value);
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mixes in linear light: fraction 0 returns `first`, 1 returns `second`. */
function mixHex(first: string, second: string, fraction: number): string {
  const left = requireRgb(first);
  const right = requireRgb(second);
  const weight = Math.min(1, Math.max(0, fraction));
  const channel = (a: number, b: number): number =>
    fromLinear(toLinear(a / 255) + (toLinear(b / 255) - toLinear(a / 255)) * weight) * 255;
  return toHex({
    r: channel(left.r, right.r),
    g: channel(left.g, right.g),
    b: channel(left.b, right.b),
  });
}

/**
 * Mixes `from` toward `toward` in tenths until the result reads against every
 * surface at `target` contrast. Palettes arrive from theme authors, so roles
 * that carry text are corrected here rather than trusted.
 */
function readableMix(from: string, toward: string, surfaces: string[], target: number): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(from, toward, step / 10);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= target)) return candidate;
  }
  return toward;
}

/**
 * Reads the flat `key = "value"` subset of TOML that omarchy palettes use.
 * Table headers are reported and skipped because a palette file has no sections.
 */
function parseColorsToml(text: string): {
  palette: ThemePalette;
  mode?: ThemeMode;
  warnings: string[];
} {
  const canonical: ThemePalette = {};
  const legacy: ThemePalette = {};
  const warnings: string[] = [];
  let mode: ThemeMode | undefined;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "" || line.startsWith("#")) continue;
    const location = `line ${index + 1}`;
    if (line.startsWith("[")) {
      warnings.push(`${location}: ignored table header ${line}`);
      continue;
    }

    const assignment = ASSIGNMENT.exec(line);
    const value = assignment ? paletteValue(assignment[2]) : undefined;
    if (!assignment || value === undefined) {
      warnings.push(`${location}: expected key = "value"`);
      continue;
    }

    const key = assignment[1];
    if (key === "mode") {
      if (MODES.includes(value)) mode = value as ThemeMode;
      else warnings.push(`${location}: unsupported mode "${value}"`);
      continue;
    }

    const target = LEGACY_KEYS[key] ? legacy : canonical;
    target[LEGACY_KEYS[key] ?? key] = value;
  }

  return { palette: { ...legacy, ...canonical }, mode, warnings };
}

function paletteValue(rawValue: string): string | undefined {
  const value = rawValue.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end > 0 ? value.slice(1, end) : undefined;
  }
  const comment = value.indexOf("#");
  const bare = (comment === -1 ? value : value.slice(0, comment)).trim();
  return bare === "" ? undefined : bare;
}

/**
 * Fills the slots the regions need from the ones the theme declares. A theme
 * that omits `background` or `foreground` stays partial on purpose: unset slots
 * then fall back to the neutral ramp in `src/styles.css` for the active mode, so
 * a file with nothing but an accent is a valid theme.
 */
function resolveTheme(raw: ThemePalette, declaredMode: ThemeMode | undefined): ResolvedTheme {
  const warnings: string[] = [];
  const colors: ThemePalette = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!HEX_COLOR.test(value)) {
      if (REGION_SLOTS.has(key)) warnings.push(`${key} is not a hex color: "${value}"`);
      continue;
    }
    colors[key] = normalizeHex(value);
  }

  const background = colors.background;
  const foreground = colors.foreground;
  const mode =
    declaredMode ??
    (background ? (relativeLuminance(background) < 0.4 ? "dark" : "light") : "system");
  if (!background || !foreground) {
    if (Object.keys(raw).length > 0) {
      warnings.push(
        "palette has no background and foreground, so unset slots use the app's neutral ramp",
      );
    }
    return { mode, palette: colors, warnings };
  }

  const dark = mode === "dark";
  const accent = colors.accent ?? colors.blue ?? colors.color4 ?? foreground;
  const darkBackground =
    colors.dark_background ??
    (dark ? mixHex(background, "#000000", 0.25) : mixHex(background, foreground, 0.05));
  const darkerBackground =
    colors.darker_background ??
    (dark ? mixHex(background, "#000000", 0.45) : mixHex(background, foreground, 0.1));
  const lighterBackground =
    colors.lighter_background ?? mixHex(background, foreground, dark ? 0.12 : 0.06);
  const brightForeground = colors.bright_foreground ?? foreground;
  const darkForeground = colors.dark_foreground ?? mixHex(foreground, background, 0.45);
  // Ink on a fill is the theme's own darkest or lightest stop, whichever reads
  // better against the fill. A fixed lightness threshold misfires on mid-tone
  // accents (ethereal, miasma, osaka-jade, solitude, vantablack): the threshold
  // picks light ink under 3:1 while the dark stop clears 4.5:1. The same rule
  // covers ink on a destructive fill so `--destructive-foreground` stays readable.
  function inkOn(fill: string, darkStop: string, lightStop: string): string {
    return contrastRatio(fill, darkStop) >= contrastRatio(fill, lightStop) ? darkStop : lightStop;
  }
  const onAccent =
    colors.on_accent ??
    inkOn(accent, dark ? darkerBackground : foreground, dark ? brightForeground : background);
  const red = colors.red ?? colors.color1 ?? (dark ? "#f87171" : "#b91c1c");
  const onRed =
    colors.on_red ??
    inkOn(red, dark ? darkerBackground : foreground, dark ? brightForeground : background);

  return {
    mode,
    warnings,
    palette: {
      ...colors,
      accent,
      on_accent: onAccent,
      on_red: onRed,
      selection: colors.selection ?? mixHex(background, foreground, dark ? 0.18 : 0.12),
      muted: colors.muted ?? mixHex(background, foreground, dark ? 0.3 : 0.22),
      dark_background: darkBackground,
      darker_background: darkerBackground,
      lighter_background: lighterBackground,
      dark_foreground: darkForeground,
      light_foreground: colors.light_foreground ?? mixHex(foreground, background, 0.15),
      bright_foreground: brightForeground,
      // Secondary text lands on the card, the canvas, and raised chips, and
      // omarchy's `dark_foreground` is usually too dim for all three.
      muted_foreground:
        colors.muted_foreground ??
        readableMix(
          darkForeground,
          foreground,
          [background, darkBackground, lighterBackground],
          4.5,
        ),
      red,
    },
  };
}

/** Parses a palette file into the shape the UI applies. */
export function parseThemeFile(text: string): ResolvedTheme {
  const parsed = parseColorsToml(text);
  const resolved = resolveTheme(parsed.palette, parsed.mode);
  return { ...resolved, warnings: [...parsed.warnings, ...resolved.warnings] };
}
