import type { ReactElement } from "react";
import { recentLaunches } from "@/launchTiming";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Where the last few launches spent their time, to find what makes starting slow. */
export function LaunchTimes(): ReactElement | null {
  const launches = recentLaunches();
  if (launches.length === 0) return null;
  return (
    <section
      aria-labelledby="settings-launch"
      className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-launch" className="text-sm font-medium">
          Launch time
        </h2>
        <p className="text-sm text-muted-foreground">
          From starting the app to the first tasks on screen, newest first.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {launches.map((launch) => (
          <li key={launch.at} className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium">
              {seconds(launch.totalMs)} · {new Date(launch.at).toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              {launch.steps.map((step) => `${step.label} ${step.ms}`).join(" · ")} ms
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
