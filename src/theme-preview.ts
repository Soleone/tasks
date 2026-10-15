import type { ThemeRecord } from "./legacy/backend/protocol";
import { listThemes } from "./platform/backendClient";
import "./styles.css";
import "./theme-preview.css";

function requiredPreviewElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`theme preview markup is missing ${selector}`);
  return element;
}

const themeSelect = requiredPreviewElement<HTMLSelectElement>("#theme-select");
const reloadButton = requiredPreviewElement<HTMLButtonElement>("#reload-themes");
const loadStatus = requiredPreviewElement<HTMLElement>("#load-status");
const themeMeta = requiredPreviewElement<HTMLElement>("#theme-meta");
const paletteCount = requiredPreviewElement<HTMLElement>("#palette-count");
const paletteGrid = requiredPreviewElement<HTMLElement>("#palette-grid");
const warning = requiredPreviewElement<HTMLElement>("#theme-warnings");

let themes: ThemeRecord[] = [];
let currentTheme: ThemeRecord | undefined;
let appliedProperties: string[] = [];
const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");

function modeLabel(mode: ThemeRecord["mode"]): string {
  if (mode === "system") return "system";
  return mode;
}

function slotProperty(slot: string): string {
  return `--om-${slot.replaceAll("_", "-")}`;
}

function labelForSlot(slot: string): string {
  return slot
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function applyPreviewTheme(theme: ThemeRecord): void {
  const root = document.documentElement;
  for (const property of appliedProperties) root.style.removeProperty(property);
  appliedProperties = [];

  for (const [slot, value] of Object.entries(theme.palette)) {
    const property = slotProperty(slot);
    root.style.setProperty(property, value);
    appliedProperties.push(property);
  }

  const dark = theme.mode === "dark" || (theme.mode === "system" && systemAppearance.matches);
  root.classList.toggle("dark", dark);
  const canvas = getComputedStyle(root).getPropertyValue("--background").trim();
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", canvas);
}

function colorCard(slot: string, value: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "palette-card";

  const swatch = document.createElement("div");
  swatch.className = "palette-swatch";
  swatch.style.backgroundColor = value;
  swatch.setAttribute("aria-hidden", "true");

  const info = document.createElement("div");
  info.className = "palette-card-info";

  const name = document.createElement("span");
  name.className = "palette-card-name";
  name.textContent = labelForSlot(slot);

  const color = document.createElement("span");
  color.className = "palette-card-value";
  color.textContent = value;

  info.append(name, color);
  card.append(swatch, info);
  return card;
}

function renderTheme(theme: ThemeRecord): void {
  currentTheme = theme;
  applyPreviewTheme(theme);
  themeMeta.textContent = `${theme.source} · ${modeLabel(theme.mode)} · preview only`;

  const entries = Object.entries(theme.palette);
  paletteCount.textContent = `${entries.length} slot${entries.length === 1 ? "" : "s"}`;
  paletteGrid.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "palette-empty";
    empty.textContent = "No explicit slots. This uses the app's neutral ramp for the current system mode.";
    paletteGrid.append(empty);
  } else {
    for (const [slot, value] of entries) paletteGrid.append(colorCard(slot, value));
  }

  warning.hidden = theme.warnings.length === 0;
  warning.textContent = theme.warnings.length > 0 ? theme.warnings.join(" ") : "";
}

function renderThemeOptions(selectedName: string): void {
  themeSelect.replaceChildren();
  for (const theme of themes) {
    const option = document.createElement("option");
    option.value = theme.name;
    option.textContent = theme.label;
    themeSelect.append(option);
  }
  themeSelect.value = selectedName;
}

async function loadThemes(): Promise<void> {
  reloadButton.disabled = true;
  loadStatus.textContent = "Loading themes…";
  try {
    const result = await listThemes();
    themes = result.themes;
    const preservedName = currentTheme && themes.some((theme) => theme.name === currentTheme?.name)
      ? currentTheme.name
      : result.selected;
    const selected = themes.find((theme) => theme.name === preservedName) ?? themes[0];
    if (!selected) throw new Error("No themes were returned");

    renderThemeOptions(selected.name);
    renderTheme(selected);
    loadStatus.textContent = `${themes.length} theme${themes.length === 1 ? "" : "s"} loaded from the app and workspace.`;
  } catch (error) {
    loadStatus.textContent = error instanceof Error ? error.message : String(error);
    paletteGrid.replaceChildren();
    themeMeta.textContent = "Theme data unavailable";
    paletteCount.textContent = "";
  } finally {
    reloadButton.disabled = false;
  }
}

themeSelect.addEventListener("change", () => {
  const selected = themes.find((theme) => theme.name === themeSelect.value);
  if (selected) renderTheme(selected);
});
reloadButton.addEventListener("click", () => void loadThemes());
systemAppearance.addEventListener("change", () => {
  if (currentTheme?.mode === "system") applyPreviewTheme(currentTheme);
});

void loadThemes();
