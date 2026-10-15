import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** Reads the rendered task list the way a screen reader would. */
export function taskList(): HTMLElement {
  return screen.getByRole("listbox");
}

function titleOf(row: Element | null): string | null {
  return row?.querySelector("[data-slot=item-title]")?.textContent ?? null;
}

export function rowTitles(): string[] {
  return screen.queryAllByRole("option").map((row) => titleOf(row) ?? "");
}

export function row(title: string): HTMLElement {
  const found = screen.getAllByRole("option").find((option) => titleOf(option) === title);
  if (!found) throw new Error(`no row titled ${title}; rows: ${rowTitles().join(", ")}`);
  return found;
}

export function activeTitle(): string | null {
  return titleOf(document.getElementById(taskList().getAttribute("aria-activedescendant") ?? ""));
}

export function selectedTitles(): string[] {
  return screen.queryAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true").map((option) => titleOf(option) ?? "");
}

export async function expectRows(titles: string[]): Promise<void> {
  await waitFor(() => expect(rowTitles()).toEqual(titles));
}

export async function expectActive(title: string): Promise<void> {
  await waitFor(() => expect(activeTitle()).toBe(title));
}

export async function expectListFocused(): Promise<void> {
  await waitFor(() => expect(document.activeElement).toBe(taskList()));
}

/** The inline editor's title field, once it has focus. */
export async function focusedTitleField(): Promise<HTMLInputElement> {
  await waitFor(() => expect(document.activeElement?.getAttribute("placeholder")).toBe("What needs doing?"));
  return document.activeElement as HTMLInputElement;
}

/** Everything announced to screen readers so far. */
export function announcements(): string {
  return screen.queryAllByRole("status").map((element) => element.textContent ?? "").join(" ");
}
