import { render, screen, waitFor, within } from "@testing-library/react";
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

test("theme.favorites: favorites persist across mounts and a card's star does not select its theme", async () => {
  const user = userEvent.setup();
  const picker = (
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <ThemePicker favoriteKey="f" />
    </ThemeProvider>
  );
  const { unmount } = render(picker);
  await user.keyboard("t");
  const ring = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(ring));
  const front = ring.getAttribute("aria-activedescendant")!.replace("theme-card-", "");

  await user.keyboard("f");
  expect(JSON.parse(localStorage.getItem(`${THEME_STORAGE_KEY}.favorites`)!)).toEqual([front]);
  expect(within(ring).getByRole("option", { name: /, favorite$/ }).id).toBe(`theme-card-${front}`);

  unmount();
  render(picker);
  await user.keyboard("t");
  const restoredRing = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(restoredRing));
  expect(within(restoredRing).getByRole("option", { name: /, favorite$/ }).id).toBe(
    `theme-card-${front}`,
  );

  const other = within(restoredRing)
    .getAllByRole("option")
    .find((card) => card.id !== `theme-card-${front}`)!;
  const selectedTheme = document.documentElement.dataset.theme;
  await user.click(other.querySelector("[data-favorite]")!);
  expect(JSON.parse(localStorage.getItem(`${THEME_STORAGE_KEY}.favorites`)!)).toEqual([
    front,
    other.id.replace("theme-card-", ""),
  ]);
  expect(document.documentElement.dataset.theme).toBe(selectedTheme);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(restoredRing.getAttribute("aria-activedescendant")).toBe(`theme-card-${front}`);
});

test("theme.favorites: favorites-only handles an empty ring and resets on reopen", async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <ThemePicker />
    </ThemeProvider>,
  );
  await user.keyboard("t");
  const ring = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(ring));
  const count = within(ring).getAllByRole("option", { hidden: true }).length;

  await user.keyboard("!@");
  expect(within(ring).getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Favorites only", pressed: true })).toBeTruthy();

  await user.keyboard("!");
  expect(within(ring).queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText("No favorites yet · favorites")).toBeTruthy();
  expect(localStorage.getItem(`${THEME_STORAGE_KEY}.favorites`)).toBe("[]");
  await user.keyboard("!");
  expect(within(ring).queryAllByRole("option")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Favorites only" }));
  expect(within(ring).getAllByRole("option", { hidden: true })).toHaveLength(count);
  await user.keyboard("@");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.keyboard("t");
  const reopenedRing = await screen.findByRole("listbox", { name: "Themes" });
  expect(within(reopenedRing).getAllByRole("option", { hidden: true })).toHaveLength(count);
  expect(screen.getByRole("button", { name: "Favorites only", pressed: false })).toBeTruthy();
});
