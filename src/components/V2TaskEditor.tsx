import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { V2EditorClient, type V2EditBaseline, type V2EditResult, type V2PreparedEdit, type V2LiteralContent, type V2StatusAction, type V2EditorMode } from "@/platform/v2EditorClient";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { taskStatusMeta } from "./taskFilters";
import { V2ParentChoice } from "./V2ParentChoice";

type Draft = { title: string; description: string; category: string; tags: string; priority: V2LiteralContent["priority"] };
const emptyDraft: Draft = { title: "", description: "", category: "", tags: "", priority: 2 };
const statusLabels: Record<V2StatusAction, string> = {
  "task.start": "Start or resume", "task.pause": "Pause", "task.complete": "Complete", "task.reopen": "Reopen",
  "task.cancel": "Cancel except done", "task.delete": "Cancel any state (delete alias)",
  "task.status.undo": "Undo latest local status",
};

export function V2TaskEditor({ editor, taskId, mode = "content", onClose, onComplete, returnFocus }: {
  editor: V2EditorClient; taskId?: string; mode?: V2EditorMode; onClose: () => void; onComplete: (result: V2EditResult) => void;
  returnFocus: () => HTMLElement | undefined;
}): ReactElement {
  const [baseline, setBaseline] = useState<V2EditBaseline | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [parentId, setParentId] = useState<string | null>(null);
  const [statusCommand, setStatusCommand] = useState<V2StatusAction>("task.complete");
  const [prepared, setPrepared] = useState<V2PreparedEdit | null>(null);
  const [preview, setPreview] = useState<V2EditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const parentRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const attempted = prepared?.hasExecuted ?? false;
  const disabled = !baseline || busy || attempted;
  const statusMode = mode === "status";
  const initialFocus = mode === "parent" ? parentRef : statusMode ? statusRef : titleRef;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void editor.begin(taskId, mode).then(value => {
      if (cancelled) return;
      setBaseline(value);
      const task = value.task;
      setParentId(task?.parentId ?? null);
      setDraft(task ? { title: task.title, description: task.description, category: task.category ?? "", tags: task.tags.join(", "), priority: task.priority } : emptyDraft);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not prepare this task operation."); });
    return () => { cancelled = true; };
  }, [editor, taskId, mode, loadAttempt]);

  useEffect(() => { if (baseline) initialFocus.current?.focus(); }, [baseline, initialFocus]);
  useEffect(() => { if (error && attempted) retryRef.current?.focus(); }, [error, attempted]);
  useEffect(() => {
    if (!attempted) return;
    const preventReload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventReload);
    return () => window.removeEventListener("beforeunload", preventReload);
  }, [attempted]);

  function change(field: keyof Draft, value: string | number): void {
    if (disabled) return;
    setDraft(current => ({ ...current, [field]: value }));
    setPrepared(null); setPreview(null); setError(null);
  }

  async function previewDraft(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!baseline || busy || attempted) return;
    setBusy(true); setError(null); setPreview(null);
    try {
      const request = mode === "parent" ? editor.prepareParent(baseline, parentId) : statusMode ? editor.prepareStatus(baseline, statusCommand)
        : editor.prepare(baseline, { title: draft.title, description: draft.description, priority: draft.priority,
          category: draft.category.trim() || null, tags: draft.tags.trim() ? draft.tags.split(",").map(tag => tag.trim()) : [] });
      setPrepared(request);
      setPreview(await request.preview());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Preview could not complete. Nothing was applied."); }
    finally { setBusy(false); }
  }

  async function apply(): Promise<void> {
    if (!prepared || !preview || busy) return;
    setBusy(true); setError(null);
    try { onComplete(await prepared.execute()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The executing reply was lost. Retain the original request."); }
    finally { setBusy(false); }
  }

  async function copyOriginal(): Promise<void> {
    if (!prepared) return;
    try { await navigator.clipboard.writeText(prepared.originalRequest); setCopied(true); }
    catch { setError("Clipboard is unavailable. Expand Original request and local paths, then select and copy the envelope; do not reconstruct it from refreshed task data."); }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy && !attempted) onClose(); }}>
      <DialogContent className="overflow-y-auto sm:max-w-lg" showCloseButton={!attempted && !busy} initialFocus={() => initialFocus.current ?? undefined} finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{mode === "parent" ? "Change task parent" : statusMode ? "Change task status" : taskId ? "Edit literal task content" : "Capture a literal task"}</DialogTitle>
          <DialogDescription>{mode === "parent" ? "Move this task first under a chosen parent, or remove its parent. Content, status, closure, dependencies and descendant files stay unchanged." : statusMode ? "Preview one explicit status command. Cancellation keeps the file; no status cascades or automatic undo." : "Title, category and tags are separate fields. No shorthand parsing, status changes or relationship editing."}</DialogDescription>
        </DialogHeader>
        {!baseline && !error && <p role="status">Preparing the selected task operation...</p>}
        {error && <Alert variant="destructive"><AlertTitle>{attempted ? "Original request retained, not resolved" : "Task operation unavailable"}</AlertTitle><AlertDescription className="break-words">{error}</AlertDescription></Alert>}
        {!baseline && error && <Button variant="outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry preparation</Button>}
        {baseline && <form onSubmit={event => { void previewDraft(event); }} className="flex flex-col gap-5">
          <FieldGroup>
            {mode === "parent" ? <V2ParentChoice editor={editor} baseline={baseline} value={parentId} disabled={disabled} triggerRef={parentRef} onChange={value => {
              if (disabled) return;
              setParentId(value); setPrepared(null); setPreview(null); setError(null);
            }} /> : statusMode ? <>
              <p className="break-words text-sm">{baseline.task?.title}</p>
              <Field data-disabled={disabled}>
                <FieldLabel htmlFor="v2-change-status">Status action</FieldLabel>
                <Select value={statusCommand} disabled={disabled} onValueChange={value => {
                  if (disabled) return;
                  const command = Object.keys(statusLabels).find(command => command === value) as V2StatusAction | undefined;
                  if (command) { setStatusCommand(command); setPrepared(null); setPreview(null); setError(null); }
                }}>
                  <SelectTrigger ref={statusRef} id="v2-change-status"><SelectValue>{statusLabels[statusCommand]}</SelectValue></SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}><SelectGroup>{Object.entries(statusLabels).map(([command, label]) => <SelectItem key={command} value={command}>{label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <FieldDescription>Observed status: {baseline.task && taskStatusMeta[baseline.task.status].label}. Commands keep content, edit time, ordering and relationships unchanged. {statusCommand === "task.status.undo" ? "Undo restores the previous status and exact closure from eligible retained local history. Missing, consumed or intervening history is refused; no redo or file-deletion undo." : "Disallowed transitions are refused."}</FieldDescription>
              </Field>
            </> : <>
            <Field data-disabled={disabled}>
              <FieldLabel htmlFor="v2-edit-title">Literal title</FieldLabel>
              <Input ref={titleRef} id="v2-edit-title" value={draft.title} maxLength={1000} required disabled={disabled} onChange={event => change("title", event.target.value)} />
              <FieldDescription>`Call @alice` stays a title; it does not select a category.</FieldDescription>
            </Field>
            <Field data-disabled={disabled}>
              <FieldLabel htmlFor="v2-edit-description">Description</FieldLabel>
              <Textarea id="v2-edit-description" value={draft.description} maxLength={10000} rows={3} disabled={disabled} onChange={event => change("description", event.target.value)} />
            </Field>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field data-disabled={disabled}><FieldLabel htmlFor="v2-edit-category">Category slug</FieldLabel><Input id="v2-edit-category" value={draft.category} disabled={disabled} onChange={event => change("category", event.target.value)} /><FieldDescription>Leave empty to clear the category.</FieldDescription></Field>
              <Field data-disabled={disabled}><FieldLabel htmlFor="v2-edit-tags">Tag slugs</FieldLabel><Input id="v2-edit-tags" value={draft.tags} disabled={disabled} onChange={event => change("tags", event.target.value)} /><FieldDescription>Comma-separated. Empty clears all tags.</FieldDescription></Field>
            </div>
            <Field data-disabled={disabled}>
              <FieldLabel htmlFor="v2-edit-priority">Priority</FieldLabel>
              <Select value={String(draft.priority)} disabled={disabled} onValueChange={value => { if (value !== null) change("priority", Number(value)); }}>
                <SelectTrigger id="v2-edit-priority"><SelectValue>P{draft.priority}</SelectValue></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}><SelectGroup>{[0, 1, 2, 3, 4].map(value => <SelectItem key={value} value={String(value)}>P{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            </>}
          </FieldGroup>
          {!attempted && <div className="flex flex-wrap gap-3"><Button type="submit" disabled={disabled}>{busy ? "Preparing preview..." : "Preview changes"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button></div>}
        </form>}
        {preview && !attempted && <Alert><AlertTitle>{preview.changed ? "Preview only" : mode === "parent" ? "Preview: no parent change" : statusMode ? "Preview: no status change" : "Preview: no content change"}</AlertTitle><AlertDescription>
          <p className="break-words">{preview.task.title}</p>
          {mode === "parent" ? <p className="break-all">Parent: {preview.task.parentId ?? "Root (no parent)"}. Position key: {preview.task.orderKey}.</p> : statusMode ? <p>Status: {taskStatusMeta[preview.task.status].label}. Closure: {preview.task.closedAt ?? "Not closed"}.</p> : <p>Category: {preview.task.category ?? "None"}. Tags: {preview.task.tags.join(", ") || "None"}. Priority: P{preview.task.priority}.</p>}
          <p>No canonical effects, receipt or history. {mode === "parent" ? "New edit time and first-position key are hypothetical, not reserved. Complete graph/sibling guards run again on apply." : statusMode ? statusCommand === "task.status.undo" ? "The previous status and closure come from retained history, not a new closure time. Eligibility is checked again on apply." : "Any new closure time is hypothetical, not reserved." : "Creation identity/time/version are hypothetical, not reserved."} Applying may refuse changed authority.</p>
        </AlertDescription><Button className="mt-3" disabled={busy} onClick={() => { void apply(); }}>Apply original request</Button></Alert>}
        {attempted && <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-muted-foreground">Do not reload, change folders or renew authority. This request exists only in this page. Retry sends its exact original context, key, payload, actor, flags and version. Pending work requires explicit CLI recovery. A restarted dev backend requires manual reconciliation, not automatic reconnection.</p>
          <div className="flex flex-wrap gap-3"><Button ref={retryRef} disabled={busy} onClick={() => { void apply(); }}>{busy ? "Waiting for the original request..." : "Retry same request"}</Button><Button variant="outline" onClick={() => { void copyOriginal(); }}>Copy original request</Button></div>
          {copied && <p role="status" className="text-sm">Original envelope copied. Also retain the root/cache/profile paths below.</p>}
          <details className="min-w-0"><summary className="cursor-pointer text-sm">Original request and local paths</summary><div className="mt-3 flex min-w-0 flex-col gap-3"><Field><FieldLabel htmlFor="v2-original-envelope">Original protocol-2 envelope</FieldLabel><Textarea id="v2-original-envelope" value={prepared!.originalRequest} readOnly rows={4} /></Field><pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{prepared!.retryMetadata}</pre></div></details>
          <Field orientation="horizontal"><Checkbox id="v2-manual-reconciliation" checked={manual} onCheckedChange={setManual} disabled={busy} /><FieldLabel htmlFor="v2-manual-reconciliation">I preserved the original request and will reconcile it outside this editor.</FieldLabel></Field>
          <Button variant="outline" disabled={busy || !manual} onClick={onClose}>Close for manual reconciliation</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
