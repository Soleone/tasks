import { useRef, useState, type ReactElement } from "react";
import { XIcon } from "lucide-react";
import { selectedMainWorkspace } from "@/platform/backendClient";
import { isAndroid, runtimeKind } from "@/platform/runtime";
import { chooseHomeOnNextStart, revealHome } from "@/platform/desktopWorkspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { resetProgress, useLearning } from "@/learning/progress";
import { setQuestsShown, useQuests } from "@/learning/questProgress";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { FONT_SIZE_INCREASES, type FontSizeIncrease } from "@/fontSize";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { DeleteTasksSection } from "@/components/DeleteTasksSection";
import { ReadableTabsTrigger } from "@/components/variants/tabs";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  fontSizeIncrease: FontSizeIncrease;
  onFontSizeIncreaseChange: (increase: FontSizeIncrease) => void;
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

export function SettingsDialog({
  open,
  onOpenChange,
  finalFocus,
  fontSizeIncrease,
  onFontSizeIncreaseChange,
}: SettingsDialogProps): ReactElement {
  const workspace = selectedMainWorkspace();
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [progressReset, setProgressReset] = useState(false);
  const learning = useLearning();
  const questsShown = useQuests().shown;
  const settingsTab = useRef<HTMLButtonElement>(null);

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
            <DialogDescription>Adjust appearance, quests, and workspace data.</DialogDescription>
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
              <ReadableTabsTrigger value="workspace">Data</ReadableTabsTrigger>
              <ReadableTabsTrigger value="cleanup">Cleanup</ReadableTabsTrigger>
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
                    Help
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Short quests teach the keys a few at a time. Pause one whenever you like; it
                    keeps your place.
                  </p>
                </div>
                <Field orientation="horizontal">
                  <Checkbox
                    id="settings-show-quests"
                    checked={questsShown}
                    onCheckedChange={setQuestsShown}
                  />
                  <FieldLabel htmlFor="settings-show-quests">Show quests</FieldLabel>
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground" data-settings-learned>
                    {learning.learnedCount} of {learning.moves.length} moves learned
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetProgress();
                      setProgressReset(true);
                    }}
                  >
                    Reset progress
                  </Button>
                </div>
                {progressReset && learning.learnedCount === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Progress reset. Quests start over.
                  </p>
                ) : null}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="workspace" tabIndex={-1}>
            <div className="grid gap-4 md:grid-cols-2">
              <section
                aria-labelledby="settings-sync"
                className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
              >
                <div className="flex flex-col gap-1">
                  <h2 id="settings-sync" className="text-sm font-medium">
                    Tasks home
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Everything Tasks keeps on this device: tasks, settings, history and undo. For a
                    full backup, close Tasks and the CLI and copy the whole folder.
                  </p>
                </div>
                {workspace ? (
                  <>
                    <code className="wrap-anywhere text-xs">
                      {workspace.editor.selection.profilePath}
                    </code>
                    {runtimeKind() === "native" && !isAndroid() && (
                      <Button
                        variant="outline"
                        className="w-fit"
                        onClick={() =>
                          void revealHome().catch((error: unknown) =>
                            setPathNotice(error instanceof Error ? error.message : String(error)),
                          )
                        }
                      >
                        Open folder
                      </Button>
                    )}
                    <h3 className="text-sm font-medium">Sync folder</h3>
                    <code className="wrap-anywhere text-xs">
                      {workspace.editor.selection.rootPath}
                    </code>
                    <Button
                      variant="outline"
                      className="w-fit"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(workspace.editor.selection.rootPath)
                          .then(
                            () => setPathNotice("Sync folder path copied."),
                            () => setPathNotice("The path couldn't be copied; select it instead."),
                          )
                      }
                    >
                      Copy path
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Add only this sync folder to Syncthing, not the Tasks home. Syncing the home
                      would copy this device's database and locks to your other devices and can
                      damage them.
                    </p>
                    {pathNotice && (
                      <p role="status" className="text-sm text-muted-foreground">
                        {pathNotice}
                      </p>
                    )}
                  </>
                ) : null}
                {runtimeKind() === "native" && (
                  <Button
                    variant="outline"
                    className="w-fit"
                    onClick={() => {
                      chooseHomeOnNextStart();
                      window.location.reload();
                    }}
                  >
                    Open another home…
                  </Button>
                )}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="cleanup" tabIndex={-1}>
            {workspace && <DeleteTasksSection />}
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
      </AnchoredDialogContent>
    </Dialog>
  );
}
