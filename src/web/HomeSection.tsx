import { HardDrive } from "lucide-react";
import { showTaskToast } from "@/components/TaskToaster";
import { Button } from "@/components/variants/button";
import { downloadAllTasks } from "@/platform/backendClient";
import { RELEASES_URL } from "./HostedActions";

/** Hands the browser a zip of every task and image to save, the only copy outside this page. */
async function saveExport(): Promise<void> {
  const file = await downloadAllTasks();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Settings › Data in the web build: the home lives in this browser, and the apps keep files. */
export function HomeSection() {
  return (
    <section
      aria-labelledby="settings-sync"
      className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-sync" className="flex items-center gap-2 text-sm font-medium">
          <HardDrive aria-hidden="true" className="size-4 text-muted-foreground" />
          Tasks home
        </h2>
        <p className="text-sm text-muted-foreground">
          This page keeps your tasks, settings and undo in this browser only. The desktop and
          Android apps keep them as files in a folder you choose, ready for Syncthing and backups.
          Export all tasks saves a zip of your tasks and images.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            void saveExport().catch((error: unknown) =>
              showTaskToast(error instanceof Error ? error.message : String(error)),
            )
          }
        >
          Export all tasks
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
        >
          Download the app
        </Button>
      </div>
    </section>
  );
}
