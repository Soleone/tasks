import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { APP_NAME } from "@/backend/branding";
import type { V2TaskProjection } from "@/backend/v2Queries";
import type { TaskStatus } from "@/backend/protocol";
import { TaskStatusDisplay } from "./TaskRow";
import { taskStatusMeta } from "./taskFilters";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { Item } from "./ui/item";
import { Label } from "./ui/label";
import { V2WorkspaceReader, type V2TaskPage, type V2WorkspaceInfo } from "@/platform/v2BackendClient";
import type { V2EditorClient } from "@/platform/v2EditorClient";

const V2TaskEditor = lazy(() => import("./V2TaskEditor").then(module => ({ default: module.V2TaskEditor })));

function TaskDetails({ task }: { task: V2TaskProjection }): ReactElement {
  return (
    <>
      <DialogHeader><DialogTitle className="break-words">{task.title}</DialogTitle><DialogDescription>Read-only snapshot. Canonical title and classification are separate fields.</DialogDescription></DialogHeader>
      <p className="whitespace-pre-wrap break-words text-sm">{task.description || "No description."}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&>dd]:break-words [&>dt]:text-muted-foreground">
        <dt>Status</dt><dd>{taskStatusMeta[task.status].label}</dd>
        <dt>Priority</dt><dd>P{task.priority}</dd>
        <dt>Category</dt><dd>{task.category ?? "None"}</dd>
        <dt>Tags</dt><dd>{task.tags.join(", ") || "None"}</dd>
        <dt>Task ID</dt><dd>{task.id}</dd>
        <dt>Parent</dt><dd>{task.parentId ?? "None"}</dd>
        <dt>Dependencies</dt><dd>{task.dependencyIds.join(", ") || "None"}</dd>
        <dt>Blocked by</dt><dd>{task.blockedByIds.join(", ") || "None"}</dd>
        <dt>Order key</dt><dd>{task.orderKey}</dd>
        <dt>Created</dt><dd>{task.createdAt}</dd>
        <dt>Updated</dt><dd>{task.updatedAt}</dd>
        <dt>Closed</dt><dd>{task.closedAt ?? "Not closed"}</dd>
      </dl>
    </>
  );
}

export function V2ReaderView({ reader, editor, onLeave }: { reader: V2WorkspaceReader; editor?: V2EditorClient; onLeave: () => void }): ReactElement {
  const [page, setPage] = useState<V2TaskPage | null>(null);
  const [workspace, setWorkspace] = useState<V2WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [details, setDetails] = useState<V2TaskProjection | null>(null);
  const [editing, setEditing] = useState<{ id?: string; statusMode?: true } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let revision: number | undefined;
    async function load(force: boolean): Promise<void> {
      if (busy) return;
      busy = true;
      try {
        const nextWorkspace = await reader.workspaceInfo();
        if (cancelled) return;
        setWorkspace(nextWorkspace);
        if (nextWorkspace.state !== "ready") {
          revision = undefined;
          setPage(null);
          setError(null);
          return;
        }
        if (!force && revision === nextWorkspace.workspaceRevision) return;
        const nextPage = await reader.tasks({ sort: "manual", limit: 50, offset,
          ...(search ? { search } : {}), ...(status !== "all" ? { status } : {}) });
        if (cancelled) return;
        revision = nextPage.workspaceRevision;
        setPage(nextPage);
        setError(null);
        setActiveId(current => nextPage.tasks.some(task => task.id === current) ? current : nextPage.tasks[0]?.id ?? null);
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Could not read this v2 folder.");
        setPage(null);
        revision = undefined;
      } finally {
        busy = false;
      }
    }
    void load(true);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [reader, search, status, offset, refresh]);

  useEffect(() => {
    const unavailable = error || (workspace && workspace.state !== "ready");
    const homeFocus = document.activeElement === document.body || document.activeElement === listRef.current;
    if (unavailable && homeFocus) retryRef.current?.focus();
    if (!initialFocus.current || (!unavailable && !page)) return;
    if (page && homeFocus) listRef.current?.focus();
    initialFocus.current = false;
  }, [page, workspace, error]);

  useEffect(() => {
    if (activeId && document.activeElement === listRef.current) {
      document.getElementById(`v2-task-${activeId}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  const active = page?.tasks.find(task => task.id === activeId);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold">{APP_NAME} <span className="text-sm font-normal text-muted-foreground">{editor ? "v2 editor" : "v2 reader"}</span></h1>
        <Button variant="outline" onClick={onLeave}>Leave folder</Button>
      </header>
      <div className="min-w-0 text-sm text-muted-foreground">
        <p className="break-words"><span className="font-medium text-foreground">Folder:</span> {reader.selection.rootPath}</p>
        <p className="break-words"><span className="font-medium text-foreground">Local cache:</span> {reader.selection.databasePath}</p>
        <p className="mt-2">{editor ? "Capture, content editing, single-task status and latest local status undo previews enabled. Grouped undo, batches, relationships, ordering, migration and recovery remain unavailable." : "Read-only. App capture, editing, ordering, migration and recovery are unavailable."} Refreshes never execute recovery or switch folders.</p>
        {editor && <p className="break-words">Retained profile: {editor.selection.profilePath}. No retry payload is saved across reloads.</p>}
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setOffset(0); setSearch(searchDraft.trim()); }}>
        <div className="flex min-w-0 flex-1 flex-col gap-2"><Label htmlFor="v2-search">Search title or description</Label><Input id="v2-search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Literal search" /></div>
        <Button type="submit" variant="outline">Search</Button>
        <div className="flex flex-col gap-2"><Label htmlFor="v2-status">Status</Label><select id="v2-status" value={status} onChange={event => { setOffset(0); setStatus(event.target.value as TaskStatus | "all"); }} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">All statuses</option>{Object.entries(taskStatusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></div>
      </form>
      {workspace && (workspace.state !== "ready" || workspace.issues.length > 0) && (
        <Alert><AlertTitle>{workspace.state === "recovery_pending" ? "Pending recovery: task browsing is paused" : workspace.state === "empty" ? "This folder has not been initialized" : workspace.state === "unsupported" ? "This folder is not schema 2" : workspace.state === "incomplete" ? "This collection is incomplete" : "Collection issues need review"}</AlertTitle>
          <AlertDescription>{workspace.state === "recovery_pending" ? "Preserve the original root, cache, profile and pending evidence. Use explicit CLI recovery or manual inspection, then refresh. This app never completes recovery automatically." : "No initialization, upgrade, conflict repair or fallback has been performed."}
            {workspace.pendingOperationId && <p className="break-words">Operation: {workspace.pendingOperationId}</p>}
            {workspace.issues.map((issue, index) => <p key={index} className="break-words">{issue.code}: {issue.message}</p>)}
          </AlertDescription>
        </Alert>
      )}
      {error && <Alert variant="destructive"><AlertTitle>Could not read the selected folder</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={retryRef} variant="outline" onClick={() => setRefresh(value => value + 1)}>{error || workspace?.state !== "ready" ? "Retry" : "Refresh"}</Button>
        <Button variant="outline" disabled={!active} onClick={() => { if (active) setDetails(active); }}>Show details</Button>
        {editor && <><Button variant="outline" disabled={workspace?.state !== "ready" || !!error} onClick={() => setEditing({})}>New task</Button><Button variant="outline" disabled={!active || !!error} onClick={() => { if (active) setEditing({ id: active.id }); }}>Edit content</Button><Button variant="outline" disabled={!active || !!error} onClick={() => { if (active) setEditing({ id: active.id, statusMode: true }); }}>Change status</Button></>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {page && <p role="status" className="text-sm text-muted-foreground">{page.total} matching {page.total === 1 ? "task" : "tasks"}, manual order</p>}
      </div>
      <div ref={listRef} role="listbox" aria-label="V2 tasks" aria-activedescendant={activeId && page?.tasks.some(task => task.id === activeId) ? `v2-task-${activeId}` : undefined} tabIndex={0} className="flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" onKeyDown={event => {
        if (details || editing || !page) return;
        const current = page.tasks.findIndex(task => task.id === activeId);
        const next = event.key === "ArrowDown" || event.key === "j" ? Math.min(page.tasks.length - 1, current + 1)
          : event.key === "ArrowUp" || event.key === "k" ? Math.max(0, current - 1)
          : event.key === "Home" ? 0 : event.key === "End" ? page.tasks.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActiveId(page.tasks[next]?.id ?? null); }
        else if (event.key === "Enter" && active) { event.preventDefault(); if (editor) setEditing({ id: active.id }); else setDetails(active); }
        else if (event.key === "c" && !event.ctrlKey && !event.metaKey && !event.altKey && editor && workspace?.state === "ready" && !error) { event.preventDefault(); setEditing({}); }
        else if (event.key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey && editor && active && !error) { event.preventDefault(); setEditing({ id: active.id, statusMode: true }); }
      }}>
        {page?.contextTasks.map(task => <Item key={task.id} state="context"><p className="min-w-0 break-words text-sm">Ancestor: {task.title}</p></Item>)}
        {page?.tasks.map(task => (
          <Item key={task.id} id={`v2-task-${task.id}`} role="option" aria-selected={activeId === task.id} state={activeId === task.id ? "active" : undefined} onMouseDown={event => event.preventDefault()} onClick={() => { setActiveId(task.id); listRef.current?.focus(); }} onDoubleClick={() => { if (editor) setEditing({ id: task.id }); else setDetails(task); }}>
            <TaskStatusDisplay task={task} />
            <div className="min-w-0 flex-1"><p className="break-words font-medium">{task.title}</p><div className="mt-1 flex flex-wrap gap-2">{task.category && <Badge variant="category">{task.category}</Badge>}{task.tags.map(tag => <Badge key={tag} variant="tag">{tag}</Badge>)}<span className="text-xs text-muted-foreground">P{task.priority}</span></div>{task.blockedByIds.length > 0 && <p className="mt-1 break-words text-sm text-muted-foreground">Blocked by {task.blockedByIds.join(", ")}</p>}</div>
          </Item>
        ))}
        {page?.tasks.length === 0 && <Empty><EmptyHeader><EmptyTitle>No matching tasks</EmptyTitle><EmptyDescription>Clear your search or change status. {editor ? "Use New task or C to capture a literal task." : "This reader cannot create tasks."}</EmptyDescription></EmptyHeader></Empty>}
        {!workspace && !error && <p role="status" className="p-3 text-sm text-muted-foreground">Loading the selected v2 folder...</p>}
      </div>
      {page && (page.total > page.limit || offset > 0) && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - page.limit))}>Previous page</Button><Button variant="outline" disabled={offset + page.limit >= page.total} onClick={() => setOffset(value => value + page.limit)}>Next page</Button><span className="text-sm text-muted-foreground">{Math.min(offset + 1, page.total)}–{Math.min(offset + page.limit, page.total)} of {page.total}</span></div>}
      <p className="text-sm text-muted-foreground">Arrow keys or J/K move through tasks. {editor ? "C opens capture; Enter edits content; T opens status actions. Preview before applying. Escape cancels only unsent drafts." : "Enter shows details; Escape closes them."} These controls are also available by mouse. Titles and descriptions remain literal.</p>
      {editor && editing && <Suspense fallback={<p role="status">Loading task editor...</p>}><V2TaskEditor editor={editor} taskId={editing.id} statusMode={editing.statusMode} returnFocus={() => listRef.current ?? undefined} onClose={() => setEditing(null)} onComplete={result => { setEditing(null); setActiveId(result.task.id); setRefresh(value => value + 1); setNotice(result.changed ? "Original request completed. Refreshing current tasks." : "No change; original request completed."); }} /></Suspense>}
      <Dialog open={details !== null} onOpenChange={open => { if (!open) setDetails(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" finalFocus={() => listRef.current ?? undefined}>{details && <TaskDetails task={details} />}</DialogContent></Dialog>
    </main>
  );
}
