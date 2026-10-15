import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import type { ProtocolRequest, ThemeRecord } from "./protocol.js";
import {
  GILT_THEME_NAME,
  contrastRatio,
  mixHex,
  normalizeHex,
  parseColorsToml,
  readableMix,
  resolveTheme,
} from "../../backend/themePalette.js";
import { availableThemes, OMARCHY_SYSTEM_THEME_NAME, omarchyColorsPath } from "./themes.js";
import { builtinThemes } from "../../backend/builtinThemes.js";

function request(
  command: ProtocolRequest["command"],
  args: Record<string, unknown> = {},
  options: Partial<Pick<ProtocolRequest, "readOnly" | "dryRun">> = {},
): ProtocolRequest {
  return {
    version: 1,
    requestId: `${command}-${Math.random().toString(36).slice(2)}`,
    command,
    args,
    actor: { kind: "agent", label: "test" },
    ...options,
  };
}

function themeList(databasePath: string): { themes: ThemeRecord[]; selected: string } {
  return executeCommand(request("theme.list"), databasePath) as { themes: ThemeRecord[]; selected: string };
}

function temporaryWorkspace(): { directory: string; databasePath: string; themes: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-theme-"));
  const themes = path.join(directory, "themes");
  mkdirSync(themes, { recursive: true });
  return { directory, databasePath: path.join(directory, "tasks.db"), themes };
}

test("palette parsing accepts the shapes omarchy theme files use", () => {
  const parsed = parseColorsToml([
    "# a palette comment",
    'mode = "dark"',
    "",
    'accent = "#7AA2F7"  # trailing comment',
    'bg = "#1a1b26"',
    'background = "#1b1c27"',
    "fg = '#a9b1d6'",
    'orange = "rgba(33ccffee) rgba(00ff99ee) 45deg"',
    "[shell]",
    "border-width = 2",
    "broken line",
  ].join("\n"));

  assert.equal(parsed.mode, "dark");
  // Canonical names win over the legacy short names, and values keep their case
  // until resolution normalizes them.
  assert.equal(parsed.palette.background, "#1b1c27");
  assert.equal(parsed.palette.foreground, "#a9b1d6");
  assert.equal(parsed.palette.accent, "#7AA2F7");
  assert.equal(parsed.palette.orange, "rgba(33ccffee) rgba(00ff99ee) 45deg");
  assert.deepEqual(parsed.warnings, [
    "line 9: ignored table header [shell]",
    'line 11: expected key = "value"',
  ]);
});

test("palette resolution derives the ramp, the accent, and readable ink", () => {
  const resolved = resolveTheme(
    { background: "#1a1b26", foreground: "#a9b1d6", blue: "#7aa2f7", orange: "not-a-color" },
    undefined,
  );

  assert.equal(resolved.mode, "dark");
  assert.deepEqual(resolved.warnings, ['orange is not a hex color: "not-a-color"']);
  // An invalid hue is dropped rather than sent to the stylesheet.
  assert.equal(resolved.palette.orange, undefined);
  assert.equal(resolved.palette.accent, "#7aa2f7");
  // A valid hue forwards so the stylesheet can map it to success/warning/chart tokens.
  const withHues = resolveTheme(
    { background: "#1a1b26", foreground: "#a9b1d6", green: "#9ece6a", yellow: "#e0af68" },
    undefined,
  );
  assert.equal(withHues.warnings.length, 0);
  assert.equal(withHues.palette.green, "#9ece6a");
  assert.equal(withHues.palette.yellow, "#e0af68");
  assert.equal(normalizeHex(resolved.palette.darker_background), resolved.palette.darker_background);
  // A light accent takes the theme's darkest stop as ink; a dark accent on a
  // light theme takes its paper.
  assert.equal(resolved.palette.on_accent, resolved.palette.darker_background);
  const light = resolveTheme({ background: "#eff1f5", foreground: "#4c4f69", accent: "#1e66f5" }, undefined);
  assert.equal(light.mode, "light");
  assert.equal(light.palette.on_accent, "#eff1f5");

  const partial = resolveTheme({ accent: "#c2410c", background: "#zzzzzz" }, undefined);
  assert.equal(partial.mode, "system");
  assert.equal(partial.palette.accent, "#c2410c");
  assert.equal(partial.palette.background, undefined);
  assert.deepEqual(partial.warnings, [
    'background is not a hex color: "#zzzzzz"',
    "palette has no background and foreground, so unset slots use the app's neutral ramp",
  ]);
});

test("color helpers mix in linear light and report contrast", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#ff0000", "#ff0000", 0.5), "#ff0000");
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.001);
  assert.ok(contrastRatio("#565f89", "#1a1b26") < 4.5, "omarchy's dim ink needs correcting");

  const corrected = readableMix("#565f89", "#a9b1d6", ["#1a1b26", "#24283b"], 4.5);
  assert.ok(contrastRatio(corrected, "#1a1b26") >= 4.5);
  assert.ok(contrastRatio(corrected, "#24283b") >= 4.5);
  // An unreachable target stops at the destination color instead of looping.
  assert.equal(readableMix("#ffffff", "#ffffff", ["#ffffff"], 21), "#ffffff");
});

test("Android's built-in theme list matches the desktop palettes", () => {
  const { directory, databasePath } = temporaryWorkspace();
  try {
    const builtin = builtinThemes();
    assert.ok(builtin.some((theme) => theme.name === GILT_THEME_NAME));
    assert.deepEqual(builtin, availableThemes(databasePath, { HOME: directory }).filter((theme) => theme.source === "builtin"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("built-in themes parse cleanly and keep text readable", () => {
  const { directory, databasePath } = temporaryWorkspace();
  try {
    const themes = availableThemes(databasePath);
    assert.ok(!themes.some((theme) => theme.name === "default"), "the removed default theme is not selectable");
    assert.equal(themeList(databasePath).selected, GILT_THEME_NAME);

    const gilt = themes.find((theme) => theme.name === GILT_THEME_NAME);
    assert.equal(gilt?.label, "Gilt");
    assert.equal(gilt?.source, "builtin");
    assert.equal(gilt?.palette.accent, "#d4af37");
    assert.equal(gilt?.palette.background, "#0d0f12");

    for (const theme of themes.slice(1)) {
      const palette = theme.palette;
      assert.deepEqual(theme.warnings, [], `${theme.name} should parse without warnings`);
      assert.ok(["dark", "light"].includes(theme.mode), `${theme.name} declares a mode`);
      assert.ok(contrastRatio(palette.foreground, palette.background) >= 6, `${theme.name} body text`);
      for (const surface of [palette.background, palette.dark_background, palette.lighter_background]) {
        assert.ok(
          contrastRatio(palette.muted_foreground, surface) >= 4.5,
          `${theme.name} secondary text on ${surface} is ${contrastRatio(palette.muted_foreground, surface)}`,
        );
      }
      // Rose Pine Dawn ships a mid-tone accent, so its button ink clears the
      // 3:1 non-text floor rather than 4.5:1. Themes stay faithful over corrected.
      assert.ok(
        contrastRatio(palette.on_accent, palette.accent) >= 3,
        `${theme.name} button ink on its accent`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Omarchy System theme reads the live installed palette", () => {
  const { directory, databasePath } = temporaryWorkspace();
  const environment = { HOME: directory };
  const colorsPath = omarchyColorsPath(environment, directory);
  mkdirSync(path.dirname(colorsPath), { recursive: true });
  try {
    writeFileSync(colorsPath, 'mode = "dark"\naccent = "#123456"\nbackground = "#101010"\nforeground = "#eeeeee"\n');
    const first = availableThemes(databasePath, environment, directory);
    const system = first.find((theme) => theme.name === OMARCHY_SYSTEM_THEME_NAME);
    assert.equal(system?.source, "omarchy");
    assert.equal(system?.label, "Omarchy System");
    assert.equal(system?.palette.accent, "#123456");

    writeFileSync(colorsPath, 'mode = "light"\naccent = "#abcdef"\nbackground = "#ffffff"\nforeground = "#111111"\n');
    const refreshed = availableThemes(databasePath, environment, directory);
    assert.equal(refreshed.find((theme) => theme.name === OMARCHY_SYSTEM_THEME_NAME)?.palette.accent, "#abcdef");

    rmSync(colorsPath);
    assert.ok(!availableThemes(databasePath, environment, directory).some((theme) => theme.name === OMARCHY_SYSTEM_THEME_NAME));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("workspace theme files join the built-ins and override them by name", () => {
  const { directory, databasePath, themes } = temporaryWorkspace();
  try {
    writeFileSync(
      path.join(themes, "sunset.toml"),
      'mode = "light"\naccent = "#c2410c"\nbackground = "#fff7ed"\nforeground = "#431407"\n',
    );
    writeFileSync(path.join(themes, "notes.txt"), "not a theme");
    writeFileSync(path.join(themes, "tokyo-night.toml"), 'accent = "#ff0000"\n');

    const listed = themeList(databasePath);
    const names = listed.themes.map((theme) => theme.name);
    assert.ok(names.includes("sunset"));
    assert.ok(!names.includes("notes"), "only .toml files are themes");
    assert.ok(listed.themes.some((theme) => theme.name === listed.selected));

    const sunset = listed.themes.find((theme) => theme.name === "sunset");
    assert.equal(sunset?.label, "Sunset");
    assert.equal(sunset?.source, "workspace");
    assert.equal(sunset?.mode, "light");
    assert.equal(sunset?.palette.accent, "#c2410c");
    assert.ok(sunset?.palette.on_accent, "a full palette resolves the accent ink");

    // A file named after a built-in replaces it in place; a new file is appended.
    const overridden = listed.themes.find((theme) => theme.name === "tokyo-night");
    assert.equal(overridden?.source, "workspace");
    assert.equal(overridden?.palette.accent, "#ff0000");
    assert.ok(overridden?.warnings.length, "an accent-only file reports the slots it leaves to the ramp");
    assert.ok(names.indexOf("tokyo-night") < names.indexOf("sunset"), "an override keeps the built-in position");
    if (names.includes(OMARCHY_SYSTEM_THEME_NAME)) {
      assert.equal(names[names.length - 1], OMARCHY_SYSTEM_THEME_NAME);
      assert.ok(names.indexOf("sunset") < names.indexOf(OMARCHY_SYSTEM_THEME_NAME));
    } else {
      assert.equal(names[names.length - 1], "sunset");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the selected theme persists, previews, and rejects unknown names", () => {
  const { directory, databasePath, themes } = temporaryWorkspace();
  try {
    writeFileSync(path.join(themes, "sunset.toml"), 'accent = "#c2410c"\nbackground = "#fff7ed"\nforeground = "#431407"\n');

    const initialSelection = themeList(databasePath).selected;
    const preview = executeCommand(request("theme.set", { name: "sunset" }, { dryRun: true }), databasePath);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.changed, initialSelection !== "sunset");
    assert.equal(themeList(databasePath).selected, initialSelection, "a dry run writes nothing");

    const set = executeCommand(request("theme.set", { name: "sunset" }), databasePath) as { theme: ThemeRecord; selected: string; changed: boolean };
    assert.equal(set.selected, "sunset");
    assert.equal(set.changed, true);
    assert.equal(set.theme.palette.accent, "#c2410c");
    assert.equal(themeList(databasePath).selected, "sunset", "the choice survives a reopened database");
    assert.equal((executeCommand(request("theme.set", { name: "sunset" }), databasePath)).changed, false);

    const readOnly = executeCommand(request("theme.set", { name: GILT_THEME_NAME }, { readOnly: true }), databasePath);
    assert.equal(readOnly.readOnly, true);
    assert.equal(themeList(databasePath).selected, "sunset", "a read-only request writes nothing");

    assert.throws(() => executeCommand(request("theme.set", { name: "nope" }), databasePath), /UNKNOWN_THEME/);
    assert.throws(() => executeCommand(request("theme.set", {}), databasePath), /INVALID_ARGUMENT/);

    // A stored theme whose file disappears falls back to Gilt.
    rmSync(path.join(themes, "sunset.toml"));
    assert.equal(themeList(databasePath).selected, GILT_THEME_NAME);
    assert.equal((executeCommand(request("theme.set", { name: GILT_THEME_NAME }), databasePath)).changed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
