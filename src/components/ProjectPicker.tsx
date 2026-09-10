import { useEffect, useRef, useState, type ReactElement } from "react";
import { Folder } from "lucide-react";
import type { ProjectRecord } from "@/backend/protocol";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, literalWordScore } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listProjects } from "@/platform/backendClient";

export function ProjectPicker({ open, onClose, finalFocus, onSelect }: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | undefined;
  onSelect: (project: ProjectRecord) => void;
}): ReactElement {
  const searchInput = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const emptyText = loading ? "Loading projects…" : error ?? "No projects yet. Add @category to a task.";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogHeader className="sr-only">
        <DialogTitle>Filter by project</DialogTitle>
        <DialogDescription>Choose a project to show only its tasks.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
        initialFocus={searchInput}
        finalFocus={finalFocus}
      >
        <Command label="Filter tasks by project" filter={literalWordScore} loop>
          <CommandInput ref={searchInput} placeholder="Search projects…" />
          <CommandList label="Project results">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup
              heading={(
                <span className="inline-flex items-center gap-1.5">
                  <Folder aria-hidden="true" className="size-3.5" />
                  Projects
                </span>
              )}
            >
              {projects.map((project) => (
                <CommandItem
                  key={project.slug}
                  value={`${project.label} ${project.slug}`}
                  keywords={[`${project.taskCount} tasks`]}
                  onSelect={() => onSelect(project)}
                >
                  <span className="font-medium">{project.label}</span>
                  <span className="ml-auto text-muted-foreground">{project.taskCount} {project.taskCount === 1 ? "task" : "tasks"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
