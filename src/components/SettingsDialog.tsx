import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { selectedMainWorkspace, switchHome } from "@/platform/backendClient";
import { isDesktopApp, runtimeKind } from "@/platform/runtime";
import { revealHome } from "@/platform/desktopWorkspace";
import { Button } from "@/components/variants/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/variants/checkbox";
import { RangeInput } from "@/components/variants/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { resetProgress, useLearning } from "@/learning/progress";
import { setQuestsShown, useQuests } from "@/learning/questProgress";
import { Tabs } from "@/components/ui/tabs";
import { FONT_SIZE_INCREASES, type FontSizeIncrease } from "@/fontSize";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { DeleteTasksSection } from "@/components/DeleteTasksSection";
import { GlobalHotkeysSection } from "@/components/GlobalHotkeysSection";
import { CategoryColorsSection } from "@/components/CategoryColorsSection";
import { DaysSection, GoalsSection } from "@/components/GoalsSection";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import {
  PhoneFitTabsList,
  ReadableTabsTrigger,
  StackedTabsContent,
} from "@/components/variants/tabs";
import { Tooltip } from "@/components/variants/tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFlashTooltip } from "@/components/useFlashTooltip";
import { CopyButton, FLASH_FEEDBACK_DURATION_MS } from "@/components/CopyButton";
import { showTaskToast } from "@/components/TaskToaster";
import { version } from "../../package.json";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  fontSizeIncrease: FontSizeIncrease;
  onFontSizeIncreaseChange: (increase: FontSizeIncrease) => void;
  /** Replaces the Data tab's Tasks home section, for a build that keeps its home elsewhere. */
  homeSection?: ReactNode;
};

function fontSizeLabel(increase: FontSizeIncrease): string {
  return increase === 0 ? "Default" : `+${increase}%`;
}

const settingsTabStopSelector =
  'button, input, textarea, select, a[href], [contenteditable="true"], [role="checkbox"], [role="tab"], [tabindex="0"]';

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/** Controls that use arrows themselves: text fields, sliders, radios, tabs and lists. */
const ARROW_CONTROLS =
  'input, textarea, select, [contenteditable="true"], [role="radio"], [role="tab"], [role="slider"], [role="option"], [role="listbox"], [role="combobox"], [role^="menu"]';

function settingsTabStops(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(settingsTabStopSelector)].filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.hasAttribute("hidden") ||
      element.closest("[hidden], [inert]") !== null
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
  homeSection,
}: SettingsDialogProps): ReactElement {
  const workspace = selectedMainWorkspace();
  const [switching, setSwitching] = useState(false);
  const switchStarted = useRef(false);
  const [resets, setResets] = useState(0);
  const resetFeedback = useFlashTooltip(resets || undefined, FLASH_FEEDBACK_DURATION_MS);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const learning = useLearning();
  const questsShown = useQuests().shown;
  const settingsTab = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!switchStarted.current) onOpenChange(next);
      }}
    >
      <AnchoredDialogContent
        inert={switching}
        showCloseButton={false}
        // A column of minmax(0, 1fr) lets long content wrap instead of widening the dialog.
        className="grid-cols-1 overflow-y-auto sm:max-w-3xl"
        initialFocus={settingsTab}
        finalFocus={finalFocus}
        onKeyDown={(event) => {
          // An arrow no control used moves nothing: some webviews would otherwise walk a text
          // caret or focus into the copy around it.
          if (!ARROWS.has(event.key) || event.defaultPrevented) return;
          const target = event.target as HTMLElement;
          if (target.closest(ARROW_CONTROLS)) return;
          event.preventDefault();
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key === "ArrowDown" &&
            event.target instanceof HTMLElement &&
            event.target.getAttribute("role") === "tab"
          ) {
            // Down from a tab enters its section, as Tab does.
            const panel = event.currentTarget.querySelector<HTMLElement>(
              '[role="tabpanel"]:not([data-hidden])',
            );
            const first = [
              ...(panel?.querySelectorAll<HTMLElement>(settingsTabStopSelector) ?? []),
            ].find((stop) => stop.tabIndex >= 0 && stop.getAttribute("aria-disabled") !== "true");
            if (!first) return;
            event.preventDefault();
            first.focus();
            return;
          }
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

        <Tabs defaultValue="general">
          <div className="flex items-center justify-between gap-3">
            <PhoneFitTabsList
              aria-label="Settings sections"
              aria-describedby="settings-tabs-help"
              activateOnFocus
            >
              <ReadableTabsTrigger ref={settingsTab} value="general">
                General
              </ReadableTabsTrigger>
              <ReadableTabsTrigger value="categories">Categories</ReadableTabsTrigger>
              <ReadableTabsTrigger value="goals">Goals</ReadableTabsTrigger>
              {isDesktopApp() && <ReadableTabsTrigger value="hotkeys">Hotkeys</ReadableTabsTrigger>}
              <ReadableTabsTrigger value="workspace">Data</ReadableTabsTrigger>
              <ReadableTabsTrigger value="cleanup">Cleanup</ReadableTabsTrigger>
            </PhoneFitTabsList>
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

          <div className="grid grid-cols-1">
            <StackedTabsContent value="general" tabIndex={-1}>
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
                    <RangeInput
                      id="settings-font-size"
                      data-font-size-control
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
                      {/* Phones keep only the ends: all five overflow at larger sizes, and the output above names the current one. */}
                      {FONT_SIZE_INCREASES.map((increase, index) => (
                        <span
                          key={increase}
                          className={
                            index === 0 || index === FONT_SIZE_INCREASES.length - 1
                              ? undefined
                              : "max-sm:hidden"
                          }
                        >
                          {fontSizeLabel(increase)}
                        </span>
                      ))}
                    </div>
                    <p
                      id="settings-font-size-description"
                      className="text-sm text-muted-foreground"
                    >
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
                    <Tooltip
                      open={resetFeedback.open && resetFeedback.flashing}
                      onOpenChange={resetFeedback.onOpenChange}
                    >
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              resetProgress();
                              setResets((count) => count + 1);
                            }}
                          />
                        }
                      >
                        Reset progress
                      </TooltipTrigger>
                      <TooltipContent role="status">
                        Progress reset. Quests start over.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </section>
                <DaysSection />
              </div>
            </StackedTabsContent>

            <StackedTabsContent value="categories" tabIndex={-1}>
              <CategoryColorsSection open={open} />
            </StackedTabsContent>

            <StackedTabsContent value="goals" tabIndex={-1}>
              <GoalsSection open={open} />
            </StackedTabsContent>

            {isDesktopApp() && (
              <StackedTabsContent value="hotkeys" tabIndex={-1}>
                <GlobalHotkeysSection />
              </StackedTabsContent>
            )}

            <StackedTabsContent value="workspace" tabIndex={-1}>
              <div className="grid gap-4 md:grid-cols-2">
                {homeSection ?? (
                  <section
                    aria-labelledby="settings-sync"
                    className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
                  >
                    <div className="flex flex-col gap-1">
                      <h2 id="settings-sync" className="text-sm font-medium">
                        Tasks home
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Everything Tasks keeps on this device: tasks, settings, history and undo.
                        For a full backup, close Tasks and the CLI and copy the whole folder.
                      </p>
                    </div>
                    {workspace ? (
                      <>
                        <code className="wrap-anywhere text-xs">
                          {workspace.editor.selection.profilePath}
                        </code>
                        {isDesktopApp() && (
                          <Button
                            variant="outline"
                            className="w-fit"
                            onClick={() =>
                              void revealHome().catch((error: unknown) =>
                                showTaskToast(
                                  error instanceof Error ? error.message : String(error),
                                ),
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
                        <CopyButton
                          className="w-fit"
                          text={() => workspace.editor.selection.rootPath}
                          copied="Path copied"
                        >
                          Copy path
                        </CopyButton>
                        <p className="text-sm text-muted-foreground">
                          Add only this sync folder to Syncthing, not the Tasks home. Syncing the
                          home would copy this device's database and locks to your other devices and
                          can damage them.
                        </p>
                      </>
                    ) : null}
                    {runtimeKind() === "native" && (
                      <Button
                        variant="outline"
                        className="w-fit"
                        disabled={switching}
                        onClick={() => {
                          if (switchStarted.current) return;
                          switchStarted.current = true;
                          setSwitching(true);
                          void switchHome().catch((error: unknown) => {
                            switchStarted.current = false;
                            setSwitching(false);
                            showTaskToast(error instanceof Error ? error.message : String(error));
                          });
                        }}
                      >
                        {switching ? "Saving this home…" : "Open another home…"}
                      </Button>
                    )}
                  </section>
                )}
              </div>
            </StackedTabsContent>

            <StackedTabsContent value="cleanup" tabIndex={-1}>
              {workspace && <DeleteTasksSection />}
            </StackedTabsContent>
          </div>
        </Tabs>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Tasks {version}</p>
          <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(true)}>
            Send feedback
          </Button>
        </div>
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}

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
