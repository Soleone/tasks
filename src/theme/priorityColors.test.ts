import { describe, expect, test } from "vite-plus/test";
import { BUILTIN_THEMES } from "../components/soleone/theme/palettes";
import { parseThemeFile } from "../components/soleone/theme/palette";
import { contrastRatio, faintIconColor } from "./priorityColors";

describe("faint icon color", () => {
  test("every theme's holds 3:1 on its surfaces and is dimmer than its source", () => {
    for (const { name, toml } of BUILTIN_THEMES) {
      const { palette } = parseThemeFile(toml);
      const surfaces = [palette.background, palette.dark_background, palette.lighter_background];
      // Green is the done icon's color, and a light theme's green can sit at 3:1 already.
      for (const color of [palette.muted_foreground, palette.green]) {
        const faint = faintIconColor(color, palette);
        if (surfaces.some((surface) => contrastRatio(color, surface) < 3)) {
          expect(faint, name).toBe(color);
          continue;
        }
        for (const surface of surfaces) {
          expect(contrastRatio(faint, surface), name).toBeGreaterThanOrEqual(3);
        }
        expect(contrastRatio(faint, palette.background), name).toBeLessThanOrEqual(
          contrastRatio(color, palette.background),
        );
      }
    }
  });
});
