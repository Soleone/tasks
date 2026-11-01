import { useState, type ReactElement } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/variants/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { AnchoredDialogContent } from "@/components/variants/dialog";
import { FieldTextarea, Input } from "@/components/variants/input";
import { ChoiceCard, ChoiceRadio } from "@/components/variants/radio-group";
import type { FeedbackKind, FeedbackReport } from "@/feedback/worker";
import { platformName } from "@/platform/runtime";
import { version } from "../../package.json";

/** The Worker in `src/feedback`, which files reports as GitHub issues. */
const FEEDBACK_URL = "https://tasks-feedback.login-ccf.workers.dev";

const KINDS: [FeedbackKind, string][] = [
  ["bug", "Bug"],
  ["idea", "Feedback"],
];

async function send(report: FeedbackReport): Promise<string> {
  const response = await fetch(FEEDBACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error ?? "The report couldn't be sent.");
  return body.url;
}

/** Mounted only while open, so every opening starts a fresh report. */
export function FeedbackDialog({ onClose }: { onClose: () => void }): ReactElement {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const source = `Tasks ${version} on ${platformName()}`;

  async function submit(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      setIssueUrl(await send({ kind, title, description, source }));
    } catch (caught) {
      // fetch throws a TypeError when it gets no response at all.
      setError(
        caught instanceof TypeError
          ? "Tasks couldn't reach the internet. Your report is still here; try again."
          : (caught as Error).message,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnchoredDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Reports become public issues on GitHub, so leave out anything private.
          </DialogDescription>
        </DialogHeader>
        {issueUrl ? (
          <>
            <p role="status" className="text-sm">
              Thanks, it's in. You can follow it at{" "}
              <span className="wrap-anywhere select-text">{issueUrl}</span>
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <RadioGroup
              aria-label="Kind of report"
              className="grid-cols-2"
              value={kind}
              onValueChange={(value) => setKind(value as FeedbackKind)}
            >
              {KINDS.map(([value, label]) => (
                <ChoiceCard key={value} htmlFor={`feedback-${value}`}>
                  <Field orientation="horizontal">
                    <ChoiceRadio value={value} id={`feedback-${value}`} />
                    <FieldContent>
                      <FieldTitle>{label}</FieldTitle>
                    </FieldContent>
                  </Field>
                </ChoiceCard>
              ))}
            </RadioGroup>
            <Field>
              <FieldLabel htmlFor="feedback-title">Title</FieldLabel>
              <Input
                id="feedback-title"
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="feedback-description">Description</FieldLabel>
              <FieldTextarea
                id="feedback-description"
                required
                maxLength={10_000}
                className="max-h-64 min-h-24"
                placeholder={
                  kind === "bug"
                    ? "What happened, and what did you expect?"
                    : "What's on your mind?"
                }
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">Sent with: {source}</p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending || !title.trim() || !description.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </AnchoredDialogContent>
    </Dialog>
  );
}
