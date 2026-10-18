import { BUILTIN_THEMES } from "../components/soleone/theme/palettes";

export const THEME_STORAGE_KEY = "tasks.selectedTheme";

export const THEME_CONFIG = {
  themes: BUILTIN_THEMES.filter((theme) => !theme.hidden),
  defaultTheme: "gilt",
  storageKey: THEME_STORAGE_KEY,
};
