import { Button } from "@/components/variants/button";
import { RELEASES_URL } from "./HostedActions";

/** Settings › Data in the web build: the home lives in this browser, and the apps keep files. */
export function HomeSection() {
  return (
    <section
      aria-labelledby="settings-sync"
      className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-sync" className="text-sm font-medium">
          Tasks home
        </h2>
        <p className="text-sm text-muted-foreground">
          This page keeps your tasks, settings and undo in this browser only. The desktop and
          Android apps keep them as files in a folder you choose, ready for Syncthing and backups.
        </p>
      </div>
      <Button
        variant="outline"
        className="w-fit"
        nativeButton={false}
        render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
      >
        Download the app
      </Button>
    </section>
  );
}
