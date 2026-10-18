import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vite-plus/test";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider } from "@/components/soleone/theme";
import { ThemePicker } from "@/components/soleone/theme-picker";
import { THEME_STORAGE_KEY } from "./config";

test("theme.picker: shared default button and T shortcut still work without a host", async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <ThemePicker />
    </ThemeProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Choose a theme" }));
  await screen.findByRole("listbox", { name: "Themes" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.keyboard("t");
  const ring = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(ring));
  await user.keyboard("cat{Escape}");
  expect(screen.getByRole("listbox", { name: "Themes" })).toBe(ring);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
