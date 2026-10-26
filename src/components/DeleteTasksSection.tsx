import { useEffect, useState, type ReactElement } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { ChoiceCard, ChoiceRadio } from "@/components/variants/radio-group";
import {
  clearDone,
  getTask,
  purgeCanceled,
  type ClearDoneResult,
  type ClearDoneScope,
} from "@/platform/backendClient";
import { revealExports } from "@/platform/desktopWorkspace";
import { EditorError } from "@/platform/editorClient";
import { isAndroid, runtimeKind } from "@/platform/runtime";

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function count(amount: number, noun: string): string {
  return `${amount.toLocaleString()} ${noun}${amount === 1 ? "" : "s"}`;
}

function size(bytes: number): string {
  const [amount, unit] =
    bytes >= 1e9
      ? [bytes / 1e9, "gigabyte"]
      : bytes >= 1e6
        ? [bytes / 1e6, "megabyte"]
        : [bytes / 1e3, "kilobyte"];
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit,
    maximumFractionDigits: amount < 10 ? 1 : 0,
  }).format(amount);
}

type Reference = { taskId: string; targetId: string; field: "parentId" | "dependencyIds" };

/** One line per link that keeps canceled tasks from being purged, by title. */
async function linkLines(error: EditorError): Promise<string[]> {
  const references = (error.details?.references ?? []) as Reference[];
  const titles = new Map<string, string>();
  for (const id of new Set(references.flatMap((link) => [link.taskId, link.targetId])))
    titles.set(id, (await getTask(id)).task.title);
  return references.map(
    (link) =>
      `“${titles.get(link.taskId)}” ${link.field === "parentId" ? "is a subtask of" : "is blocked by"} canceled “${titles.get(link.targetId)}”`,
  );
}

type CanceledState =
  | { kind: "loading" }
  | { kind: "ready"; ids: string[] }
  | { kind: "linked"; lines: string[] }
  | { kind: "failed"; message: string };

async function previewCanceled(): Promise<CanceledState> {
  try {
    return { kind: "ready", ids: (await purgeCanceled(true)).purgedIds };
  } catch (caught) {
    return caught instanceof EditorError && caught.code === "PURGE_REFERENCED"
      ? { kind: "linked", lines: await linkLines(caught) }
      : { kind: "failed", message: errorText(caught) };
  }
}

function DeleteCanceled(): ReactElement {
  const [state, setState] = useState<CanceledState>({ kind: "loading" });
  const [purges, setPurges] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void previewCanceled().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [purges]);

  async function purge(): Promise<void> {
    setConfirming(false);
    try {
      const { purgedIds } = await purgeCanceled(false);
      setNotice(`Deleted ${count(purgedIds.length, "canceled task")}.`);
    } catch (caught) {
      setNotice(`Nothing was deleted. ${errorText(caught)}`);
    }
    setPurges((done) => done + 1);
  }

  const ids = state.kind === "ready" ? state.ids : [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Canceled tasks</h3>
      <p className="text-sm text-muted-foreground">
        {state.kind === "loading"
          ? "Counting canceled tasks…"
          : state.kind === "failed"
            ? `Canceled tasks couldn't be counted. ${state.message}`
            : state.kind === "linked"
              ? "Other tasks link to canceled ones, so nothing can be deleted until those links are removed:"
              : ids.length === 0
                ? "There are no canceled tasks."
                : `${count(ids.length, "canceled task")}, kept until you delete them.`}
      </p>
      {state.kind === "linked" && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {state.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Delete {count(ids.length, "canceled task")} for good? This can't be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={() => void purge()}>
              Delete {count(ids.length, "task")}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-fit"
          disabled={ids.length === 0}
          onClick={() => {
            setNotice(null);
            setConfirming(true);
          }}
        >
          Delete canceled tasks
        </Button>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}

const AGES = [
  { value: "1m", label: "more than 1 month ago", months: 1 },
  { value: "3m", label: "more than 3 months ago", months: 3 },
  { value: "1y", label: "more than 1 year ago", months: 12 },
  { value: "all", label: "any time", months: null },
] as const;
type Age = (typeof AGES)[number]["value"];

function closedBefore(age: Age): string | null {
  const months = AGES.find((option) => option.value === age)!.months;
  if (months === null) return null;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff.toISOString();
}

function choiceSummary(scope: ClearDoneScope, preview: ClearDoneResult | undefined): string {
  if (!preview) return "Counting…";
  const images = count(preview.removedAttachments.length, "image");
  return scope === "attachments"
    ? `${images} · ${size(preview.bytes)}`
    : `${count(preview.clearedIds.length, "task")} · ${images} · ${size(preview.bytes)}`;
}

type Finished = { scope: ClearDoneScope; result: ClearDoneResult };

type Previews = { age: Age } & (
  | { results: Record<ClearDoneScope, ClearDoneResult> }
  | { error: string }
);

/** Mounted only while open, so every opening counts afresh. */
function DeleteDoneDialog({
  onClose,
  onFinished,
}: {
  onClose: () => void;
  onFinished: (finished: Finished) => void;
}): ReactElement {
  const [age, setAge] = useState<Age>("3m");
  const [scope, setScope] = useState<ClearDoneScope>("tasks");
  const [loaded, setLoaded] = useState<Previews | null>(null);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const cutoff = closedBefore(age);
    Promise.all([
      clearDone(cutoff, "attachments", { preview: true }),
      clearDone(cutoff, "tasks", { preview: true }),
    ]).then(
      ([attachments, tasks]) => {
        if (current) setLoaded({ age, results: { attachments, tasks } });
      },
      (caught: unknown) => {
        if (current) setLoaded({ age, error: errorText(caught) });
      },
    );
    return () => {
      current = false;
    };
  }, [age]);

  async function run(exporting: boolean): Promise<void> {
    setBusy(true);
    setRunError(null);
    try {
      const result = await clearDone(closedBefore(age), scope, { export: exporting });
      onFinished({ scope, result });
      onClose();
    } catch (caught) {
      setRunError(`Nothing was deleted. ${errorText(caught)}`);
      setBusy(false);
    }
  }

  const current = loaded?.age === age ? loaded : null;
  const previews = current && "results" in current ? current.results : undefined;
  const error = runError ?? (current && "error" in current ? current.error : null);
  const preview = previews?.[scope];
  const empty = !preview || preview.clearedIds.length + preview.removedAttachments.length === 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnchoredDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete done tasks</DialogTitle>
          <DialogDescription>
            Free up space from tasks you finished a while ago. Deleting can't be undone; Export and
            delete saves a zip of everything it deletes first.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <span id="delete-done-age-label" className="text-sm font-medium">
            Done
          </span>
          <Select items={AGES} value={age} onValueChange={(value) => setAge(value as Age)}>
            <SelectTrigger size="sm" aria-labelledby="delete-done-age-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {AGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <RadioGroup
          aria-label="What to delete"
          value={scope}
          onValueChange={(value) => setScope(value as ClearDoneScope)}
        >
          {(
            [
              ["attachments", "Images only", "The tasks stay, without their images."],
              ["tasks", "Tasks and images", "Tasks other tasks link to are kept."],
            ] as const
          ).map(([value, title, hint]) => (
            <ChoiceCard key={value} htmlFor={`delete-done-${value}`}>
              <Field orientation="horizontal">
                <ChoiceRadio value={value} id={`delete-done-${value}`} />
                <FieldContent>
                  <FieldTitle>{title}</FieldTitle>
                  <FieldDescription>
                    {choiceSummary(value, previews?.[value])}. {hint}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </ChoiceCard>
          ))}
        </RadioGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy || empty} onClick={() => void run(false)}>
            Delete
          </Button>
          <Button variant="destructive" disabled={busy || empty} onClick={() => void run(true)}>
            Export and delete
          </Button>
        </DialogFooter>
      </AnchoredDialogContent>
    </Dialog>
  );
}

function finishedText({ scope, result }: Finished): string {
  const images = count(result.removedAttachments.length, "image");
  const deleted =
    scope === "attachments"
      ? `Deleted ${images} (${size(result.bytes)}) from ${count(result.clearedIds.length, "done task")}.`
      : `Deleted ${count(result.clearedIds.length, "done task")} and ${images} (${size(result.bytes)}).`;
  return result.keptIds.length
    ? `${deleted} ${count(result.keptIds.length, "task")} kept because other tasks link to them.`
    : deleted;
}

function DeleteDone(): ReactElement {
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const exportLocation = finished?.result.exportLocation;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Done tasks</h3>
      <p className="text-sm text-muted-foreground">
        Delete tasks finished a while ago, or only their images, optionally exporting them first.
      </p>
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => {
          setFinished(null);
          setOpen(true);
        }}
      >
        Delete done tasks…
      </Button>
      {finished && (
        <div role="status" className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>{finishedText(finished)}</p>
          {exportLocation && (
            <>
              <p>Exported to:</p>
              <code className="wrap-anywhere text-xs">{exportLocation}</code>
              {runtimeKind() === "native" && !isAndroid() && (
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() =>
                    void revealExports().catch((caught: unknown) => setNotice(errorText(caught)))
                  }
                >
                  Open folder
                </Button>
              )}
            </>
          )}
          {notice && <p>{notice}</p>}
        </div>
      )}
      {open && <DeleteDoneDialog onClose={() => setOpen(false)} onFinished={setFinished} />}
    </div>
  );
}

/** Settings > Cleanup's one place for deleting tasks for good. */
export function DeleteTasksSection(): ReactElement {
  return (
    <section
      aria-labelledby="settings-delete"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-delete" className="text-sm font-medium">
          Delete tasks
        </h2>
        <p className="text-sm text-muted-foreground">
          Deleted tasks and images leave every synced device.
        </p>
      </div>
      <DeleteCanceled />
      <DeleteDone />
    </section>
  );
}
