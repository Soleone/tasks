import { describe, expect, test } from "vite-plus/test";
import { BUILTIN_THEMES } from "../components/soleone/theme/palettes";
import { parseThemeFile } from "../components/soleone/theme/palette";
import { contrastRatio, faintIconColor } from "./priorityColors";

describe("faint icon color", () => {
  test("every theme's holds 3:1 on its surfaces and is dimmer than muted text", () => {
    for (const { name, toml } of BUILTIN_THEMES) {
      const { palette } = parseThemeFile(toml);
      const faint = faintIconColor(palette);
      for (const surface of [
        palette.background,
        palette.dark_background,
        palette.lighter_background,
      ]) {
        expect(contrastRatio(faint, surface), name).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(faint, palette.background), name).toBeLessThan(
        contrastRatio(palette.muted_foreground, palette.background),
      );
    }
  });
});
