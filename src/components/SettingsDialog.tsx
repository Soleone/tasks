import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { XIcon } from "lucide-react";
import { getWorkspaceInfo, selectedMainWorkspace } from "@/platform/backendClient";
import { runtimeKind } from "@/platform/runtime";
import { rememberFolder } from "@/platform/desktopWorkspace";
import type { ThemeRecord } from "@/backend/themePalette";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isKeyboardHelpMode, type KeyboardHelpMode } from "@/keyboardHelp";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { FONT_SIZE_INCREASES, type FontSizeIncrease } from "@/fontSize";
import { WorkspaceBackup } from "./WorkspaceBackup";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { ReadableTabsTrigger } from "@/components/variants/tabs";

type Failure = { title: string; detail: string };

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  helpMode: KeyboardHelpMode;
  onHelpModeChange: (mode: KeyboardHelpMode) => void;
  fontSizeIncrease: FontSizeIncrease;
  onFontSizeIncreaseChange: (increase: FontSizeIncrease) => void;
  themes: ThemeRecord[];
  selectedTheme: string;
  onSelectTheme: (name: string) => void;
};

function fontSizeLabel(increase: FontSizeIncrease): string {
  return increase === 0 ? "Default" : `+${increase}%`;
}

const settingsTabStopSelector =
  'button, input, textarea, select, a[href], [contenteditable="true"], [role="checkbox"], [role="tab"], [tabindex="0"]';

function settingsTabStops(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(settingsTabStopSelector)].filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.hasAttribute("hidden") ||
      element.closest("[hidden]") !== null
    )
      return false;
    if (
      element.hasAttribute("data-base-ui-focus-guard") ||
      element.getAttribute("aria-disabled") === "true"
    )
      return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

// Storage is read every time the dialog opens: the workspace can differ
// between launches, and a stale path would misreport where data lives.
export function SettingsDialog({
  open,
  onOpenChange,
  finalFocus,
  helpMode,
  onHelpModeChange,
  fontSizeIncrease,
  onFontSizeIncreaseChange,
  themes,
  selectedTheme,
  onSelectTheme,
}: SettingsDialogProps): ReactElement {
  const workspace = selectedMainWorkspace();
  const settingsTab = useRef<HTMLButtonElement>(null);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Each opening starts fresh and reads the workspace again.
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDatabasePath(null);
      setFailure(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let stale = false;
    getWorkspaceInfo()
      .then((info) => {
        if (!stale) setDatabasePath(info.databasePath);
      })
      .catch((caught: unknown) => {
        if (!stale)
          setFailure({
            title: "Could not read the workspace",
            detail: caught instanceof Error ? caught.message : String(caught),
          });
      });
    return () => {
      stale = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnchoredDialogContent
        showCloseButton={false}
        className="h-[calc(100svh-6rem)] max-h-[40rem] content-start overflow-y-auto sm:max-w-3xl md:max-h-[40rem]"
        initialFocus={settingsTab}
        finalFocus={finalFocus}
        onKeyDownCapture={(event) => {
          if (
            event.key !== "Tab" ||
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const stops = settingsTabStops(event.currentTarget);
          if (stops.at(-1) !== target) return;
          const activeTab = event.currentTarget.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]',
          );
          if (!activeTab) return;
          event.preventDefault();
          activeTab.focus();
        }}
      >
        <div className="pr-8">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Adjust appearance, shortcuts, and workspace data.</DialogDescription>
          </DialogHeader>
        </div>

        <Tabs defaultValue="general" className="min-h-0">
          <div className="flex items-center justify-between gap-3">
            <TabsList
              aria-label="Settings sections"
              aria-describedby="settings-tabs-help"
              activateOnFocus
            >
              <ReadableTabsTrigger ref={settingsTab} value="general">
                General
              </ReadableTabsTrigger>
              <ReadableTabsTrigger value="shortcuts">Shortcuts</ReadableTabsTrigger>
              <ReadableTabsTrigger value="workspace">Data</ReadableTabsTrigger>
            </TabsList>
            <span id="settings-tabs-help" className="sr-only">
              Use the Left and Right Arrow keys to switch sections. Press Tab to enter the selected
              section.
            </span>
            <span
              className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
              aria-hidden="true"
            >
              ← → switch · Tab enter
            </span>
          </div>

          <TabsContent value="general" tabIndex={-1}>
            <div className="grid gap-4 md:grid-cols-2">
              <section
                aria-labelledby="settings-appearance"
                className="flex flex-col gap-4 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-1">
                  <h2 id="settings-appearance" className="text-sm font-medium">
                    Appearance
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Tune the interface for comfortable reading.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span id="settings-theme-label" className="text-sm font-medium">
                      Theme
                    </span>
                    <Select
                      value={selectedTheme || null}
                      onValueChange={(value) => {
                        if (value !== null) onSelectTheme(value);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="max-w-[70%]"
                        data-theme-control={selectedTheme}
                        disabled={themes.length === 0}
                        aria-labelledby="settings-theme-label"
                        aria-describedby="settings-theme-description"
                      >
                        <SelectValue>
                          {themes.find((theme) => theme.name === selectedTheme)?.label ??
                            "Loading themes…"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end">
                        {themes.map((theme) => (
                          <SelectItem key={theme.name} value={theme.name}>
                            <span
                              aria-hidden="true"
                              className="size-3 shrink-0 rounded-full bg-(--theme-swatch) ring-1 ring-border"
                              style={{ "--theme-swatch": theme.palette.accent } as CSSProperties}
                            />
                            <span>{theme.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p id="settings-theme-description" className="text-sm text-muted-foreground">
                    Choose from {themes.length} dark and light palettes. Changes apply immediately
                    and are saved locally.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="settings-font-size" className="text-sm font-medium">
                      Font size
                    </label>
                    <output
                      htmlFor="settings-font-size"
                      className="text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      {fontSizeLabel(fontSizeIncrease)}
                    </output>
                  </div>
                  <input
                    id="settings-font-size"
                    data-font-size-control
                    type="range"
                    min={0}
                    max={FONT_SIZE_INCREASES.length - 1}
                    step={1}
                    value={FONT_SIZE_INCREASES.indexOf(fontSizeIncrease)}
                    aria-valuetext={
                      fontSizeIncrease === 0
                        ? "Default font size"
                        : `Font size increased by ${fontSizeIncrease}%`
                    }
                    aria-describedby="settings-font-size-description"
                    className="w-full accent-primary"
                    onChange={(event) => {
                      const increase = FONT_SIZE_INCREASES[Number(event.target.value)];
                      if (increase !== undefined) onFontSizeIncreaseChange(increase);
                    }}
                  />
                  <div
                    className="flex justify-between gap-2 text-xs text-muted-foreground"
                    aria-hidden="true"
                  >
                    {FONT_SIZE_INCREASES.map((increase) => (
                      <span key={increase}>{fontSizeLabel(increase)}</span>
                    ))}
                  </div>
                  <p id="settings-font-size-description" className="text-sm text-muted-foreground">
                    Increase text and interface size. Changes apply immediately and are saved for
                    future launches.
                  </p>
                </div>
              </section>

              <section
                aria-labelledby="settings-help"
                className="flex flex-col gap-4 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-1">
                  <h2 id="settings-help" className="text-sm font-medium">
                    Keyboard help
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Choose how much keyboard guidance to show.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span id="settings-help-mode-label" className="text-sm font-medium">
                      Display
                    </span>
                    <Select
                      value={helpMode}
                      onValueChange={(value) => {
                        if (isKeyboardHelpMode(value)) onHelpModeChange(value);
                      }}
                    >
                      <SelectTrigger
                        id="settings-help-mode"
                        size="sm"
                        data-help-mode={helpMode}
                        aria-labelledby="settings-help-mode-label"
                        aria-describedby="settings-help-mode-description"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="full">Full</SelectItem>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p id="settings-help-mode-description" className="text-sm text-muted-foreground">
                    Full shows all keyboard help. Basic shows only the filter and sort shortcuts.
                    None hides automatic keyboard help. You can change this anytime.
                  </p>
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" tabIndex={-1}>
            <section
              aria-labelledby="settings-shortcut"
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <h2 id="settings-shortcut" className="text-sm font-medium">
                Global shortcut
              </h2>
              <p className="text-sm text-muted-foreground">
                Global window focus is not yet enabled for this selected workspace. In-app keyboard
                shortcuts remain available.
              </p>
            </section>
          </TabsContent>

          <TabsContent value="workspace" tabIndex={-1}>
            <div className="grid gap-4 md:grid-cols-2">
              <section
                aria-labelledby="settings-sync"
                className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
              >
                <div className="flex flex-col gap-1">
                  <h2 id="settings-sync" className="text-sm font-medium">
                    Task folder
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Each task is a file in this folder.
                  </p>
                </div>
                {workspace ? (
                  <code className="wrap-anywhere text-xs">
                    {workspace.editor.selection.rootPath}
                  </code>
                ) : null}
                {runtimeKind() === "desktop" && (
                  <Button
                    variant="outline"
                    className="w-fit"
                    onClick={() => {
                      // Setup asks for a folder again on the next start.
                      rememberFolder(null);
                      window.location.reload();
                    }}
                  >
                    Change folder…
                  </Button>
                )}
              </section>

              <section
                aria-labelledby="settings-data"
                className="flex flex-col gap-4 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-1">
                  <h2 id="settings-data" className="text-sm font-medium">
                    Local
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Inspect the selected task folder and local cache.
                  </p>
                </div>
                {databasePath ? (
                  <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-3">
                    {workspace ? (
                      <>
                        <p className="text-xs font-medium text-muted-foreground">Task folder</p>
                        <p className="wrap-anywhere font-mono text-xs text-muted-foreground">
                          {workspace.reader.selection.rootPath}
                        </p>
                      </>
                    ) : null}
                    <p className="text-xs font-medium text-muted-foreground">Local cache</p>
                    <p className="wrap-anywhere font-mono text-xs text-muted-foreground">
                      {databasePath}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Reading the workspace…</p>
                )}
              </section>
              {open && workspace?.supportsBackupRestore ? (
                <WorkspaceBackup workspace={workspace} />
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        <DialogClose
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
              tabIndex={-1}
            />
          }
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogClose>

        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription className="wrap-anywhere">{failure.detail}</AlertDescription>
          </Alert>
        ) : null}
      </AnchoredDialogContent>
    </Dialog>
  );
}
