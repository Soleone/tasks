import { useEffect, useState, type ReactElement } from "react";
import { Bot } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { cliPath } from "@/platform/desktopWorkspace";

/** A Windows path as WSL sees it, or null for any other path. */
function wslPath(path: string): string | null {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(path);
  return drive && `/mnt/${drive[1].toLowerCase()}/${drive[2].replaceAll("\\", "/")}`;
}

/**
 * What an agent needs to use this install's CLI, for its global instructions file. It names no
 * verbs, so it stays right across versions, and no home: the CLI finds the app's (`cli.home`).
 */
function agentInstructions(cli: string): string {
  const command = cli.includes(" ") ? `"${cli}"` : cli;
  return [
    "## Tasks",
    "",
    `My task list lives in the Tasks app. Work with it through its CLI: \`${command}\``,
    "",
    "- Run it with `help` for the commands. `--json` prints output you can parse.",
    "- Read tasks whenever they help. Create, change or close one only when I ask, or to finish a task I handed you once it is clearly done.",
    "- Pass `--actor-label YOUR_NAME` when you change something, so the app shows me who did it.",
    "- Keep your own steps and short-lived to-dos out of it.",
    "- Never read or write the files in the Tasks home yourself.",
    "",
  ].join("\n");
}

/** Settings › Data on desktop: where the CLI is, and instructions to hand to an agent. */
export function AgentSetupSection(): ReactElement | null {
  const [cli, setCli] = useState<string | null>(null);
  useEffect(() => {
    void cliPath().then(setCli, () => setCli(null));
  }, []);
  if (!cli) return null;
  const wsl = wslPath(cli);
  return (
    <section
      aria-labelledby="settings-agents"
      className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-agents" className="flex items-center gap-2 text-sm font-medium">
          <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
          Agents
        </h2>
        <p className="text-sm text-muted-foreground">
          Agents work on your tasks with the CLI that comes with this app. Paste the instructions
          into an agent's own instructions file, such as <code className="text-xs">
            AGENTS.md
          </code>{" "}
          or <code className="text-xs">CLAUDE.md</code>. In a project, one more line there is
          enough: "This project's tasks are under @name in the Tasks app."
        </p>
      </div>
      <code className="wrap-anywhere text-xs" data-cli-path>
        {cli}
      </code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={() => agentInstructions(cli)} copied="Instructions copied">
          Copy agent instructions
        </CopyButton>
        {wsl && (
          <CopyButton text={() => agentInstructions(wsl)} copied="Instructions copied">
            Copy for WSL
          </CopyButton>
        )}
        <CopyButton text={() => cli} copied="Path copied">
          Copy CLI path
        </CopyButton>
      </div>
    </section>
  );
}
