import { useEffect, useState, type ReactElement, type Ref } from "react";
import type { V2EditBaseline, V2EditorClient } from "@/platform/v2EditorClient";
import type { V2TaskPage } from "@/platform/v2BackendClient";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function V2ParentChoice({ editor, baseline, value, disabled, onChange, triggerRef }: {
  editor: V2EditorClient; baseline: V2EditBaseline; value: string | null; disabled: boolean;
  onChange: (parentId: string | null) => void; triggerRef: Ref<HTMLButtonElement>;
}): ReactElement {
  const [draftSearch, setDraftSearch] = useState("");
  const [query, setQuery] = useState({ search: "", offset: 0, attempt: 0 });
  const [page, setPage] = useState<V2TaskPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setPage(null);
    void editor.parentCandidates(baseline, query.search, query.offset).then(result => {
      if (!cancelled) setPage(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load parent choices. Original task authority was not refreshed.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editor, baseline, query]);

  const options = page?.tasks.filter(task => task.id !== baseline.task?.id) ?? [];
  const selected = options.find(task => task.id === value);
  const label = value === null ? "No parent (root)" : selected?.title ?? selectedTitle ?? "Keep observed parent";
  const controlsDisabled = disabled || loading;
  function search(): void { if (!disabled) setQuery(current => ({ search: draftSearch.trim(), offset: 0, attempt: current.attempt + 1 })); }

  return <>
    <p className="break-words text-sm">{baseline.task?.title}</p>
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor="v2-parent-search">Find parent by title or description</FieldLabel>
      <Input id="v2-parent-search" value={draftSearch} maxLength={200} disabled={disabled} onChange={event => setDraftSearch(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); search(); }
      }} />
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={controlsDisabled} onClick={search}>Search parents</Button>
        <Button type="button" variant="outline" disabled={controlsDisabled || query.offset === 0} onClick={() => setQuery(current => ({ ...current, offset: Math.max(0, current.offset - 50) }))}>Previous parents</Button>
        <Button type="button" variant="outline" disabled={controlsDisabled || !page || page.offset + page.limit >= page.total} onClick={() => setQuery(current => ({ ...current, offset: current.offset + 50 }))}>Next parents</Button></div>
      <FieldDescription>Non-canceled tasks, 50 per page. This task is not offered; cycle checks run during preview and apply. Search/paging never changes your chosen parent or task version.</FieldDescription>
    </Field>
    {loading && <p role="status" className="text-sm">Loading parent choices...</p>}
    {error && <Alert variant="destructive"><AlertTitle>Parent choices unavailable</AlertTitle><AlertDescription className="break-words">{error}</AlertDescription><Button type="button" variant="outline" disabled={disabled} onClick={() => setQuery(current => ({ ...current, attempt: current.attempt + 1 }))}>Retry parent choices</Button></Alert>}
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor="v2-change-parent">Parent</FieldLabel>
      <Select value={value ?? ""} disabled={disabled} onValueChange={(next, details) => {
        // Reconciliation and autofill are not consent to reparent or remove a parent.
        if (disabled || typeof next !== "string" || details.reason !== "item-press") { details.cancel(); return; }
        setSelectedTitle(options.find(task => task.id === next)?.title ?? null); onChange(next || null);
      }}>
        <SelectTrigger ref={triggerRef} id="v2-change-parent"><SelectValue>{label}</SelectValue></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}><SelectGroup>
          <SelectItem key="" value="">No parent (root)</SelectItem>
          {value !== null && !selected && <SelectItem key={value} value={value}>{label} ({value})</SelectItem>}
          {options.map(task => <SelectItem key={task.id} value={task.id}>{task.title} ({task.id})</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      <FieldDescription className="break-all">Chosen ID: {value ?? "Root (no parent)"}. Observed parent: {baseline.task?.parentId ?? "Root (no parent)"}.</FieldDescription>
      {page && <FieldDescription>{page.total === 0 ? "No matching non-canceled tasks." : `Page ${Math.floor(page.offset / page.limit) + 1} of ${Math.ceil(page.total / page.limit)} (${page.total} matching tasks; self omitted).`}</FieldDescription>}
    </Field>
  </>;
}
