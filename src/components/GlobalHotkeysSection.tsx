import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";
import { Button } from "@/components/variants/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  hotkeyFromKeyDown,
  hotkeyKeys,
  hotkeyLabel,
  hyprlandBind,
  hyprlandLauncher,
  readGlobalHotkeys,
  registerGlobalHotkeys,
  rememberGlobalHotkeys,
  type GlobalHotkeys,
  type Hotkey,
} from "@/platform/globalHotkeys";
import { keyName } from "@/platform/runtime";

type Role = keyof GlobalHotkeys;

const ROLES: { role: Role; label: string; description: string }[] = [
  { role: "focus", label: "Bring Tasks forward", description: "Show the window from any app." },
  {
    role: "create",
    label: "New task",
    description: "Bring Tasks forward with the New task editor open.",
  },
];

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function GlobalHotkeysSection(): ReactElement {
  const [hotkeys, setHotkeys] = useState(readGlobalHotkeys);
  // Undefined until asked; a launcher means Hyprland binds the keys instead of Tasks.
  const [launcher, setLauncher] = useState<string | null>();
  const [recording, setRecording] = useState<Role | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void hyprlandLauncher().then(setLauncher, () => setLauncher(null));
  }, []);

  function register(next: GlobalHotkeys): Promise<void> {
    return launcher === null ? registerGlobalHotkeys(next) : Promise.resolve();
  }

  function startRecording(role: Role): void {
    setProblem(null);
    setRecording(role);
    // Registered hotkeys never reach the page, so they are off while a new one is pressed.
    void register({ focus: null, create: null }).catch(() => undefined);
  }

  function stopRecording(): void {
    if (recording === null) return;
    setRecording(null);
    void register(hotkeys).catch((caught: unknown) => setProblem(errorText(caught)));
  }

  async function choose(role: Role, hotkey: Hotkey): Promise<void> {
    setRecording(null);
    const next = { ...hotkeys, [role]: hotkey };
    try {
      await register(next);
    } catch (caught) {
      setProblem(errorText(caught));
      await register(hotkeys).catch(() => undefined);
      return;
    }
    setHotkeys(next);
    rememberGlobalHotkeys(next);
  }

  function recordKey(role: Role, event: KeyboardEvent): void {
    if (recording !== role || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return stopRecording();
    if (event.key === "Backspace" || event.key === "Delete") return void choose(role, null);
    const hotkey = hotkeyFromKeyDown(event.nativeEvent);
    if (hotkey === null) return;
    const other = ROLES.find((entry) => entry.role !== role && hotkeys[entry.role] === hotkey);
    if (other) {
      setProblem(`${hotkeyLabel(hotkey)} already does ${other.label}.`);
      return;
    }
    void choose(role, hotkey);
  }

  const binds = launcher
    ? ROLES.flatMap(({ role }) => {
        const hotkey = hotkeys[role];
        return hotkey ? [hyprlandBind(hotkey, launcher, role === "create")] : [];
      }).join("\n")
    : "";

  return (
    <section
      aria-labelledby="settings-hotkeys"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="settings-hotkeys" className="text-sm font-medium">
          Hotkeys
        </h2>
        <p className="text-sm text-muted-foreground">
          These work from any app, even while Tasks is in the background.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {ROLES.map(({ role, label, description }) => {
          const hotkey = hotkeys[role];
          return (
            <div key={role} className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span id={`settings-hotkey-${role}`} className="text-sm font-medium">
                  {label}
                </span>
                <span className="text-sm text-muted-foreground">{description}</span>
              </div>
              <Button
                variant="outline"
                className="min-w-36 shrink-0 justify-center"
                aria-labelledby={`settings-hotkey-${role}`}
                aria-description={
                  recording === role ? "Press the new keys" : hotkey ? hotkeyLabel(hotkey) : "Off"
                }
                aria-pressed={recording === role}
                onClick={() => (recording === role ? stopRecording() : startRecording(role))}
                onBlur={stopRecording}
                onKeyDown={(event) => recordKey(role, event)}
              >
                {recording === role ? (
                  <span className="text-muted-foreground">Press keys…</span>
                ) : hotkey ? (
                  <KbdGroup>
                    {hotkeyKeys(hotkey).map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                ) : (
                  <span className="text-muted-foreground">Off</span>
                )}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Click a hotkey, then press the new keys: Ctrl, Alt or {keyName("Super")} with a letter,
        digit, F-key or Space. Backspace turns it off, Escape keeps it.
      </p>
      {problem && (
        <p role="status" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {binds && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Hyprland</h3>
          <p className="text-sm text-muted-foreground">
            Hyprland keeps global keys for itself, so add these lines to its config (on Omarchy,{" "}
            <code className="text-xs">~/.config/hypr/bindings.conf</code>).
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{binds}</code>
          </pre>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() =>
              void navigator.clipboard.writeText(binds).then(
                () => setCopied("Hyprland binds copied."),
                () => setCopied("The binds couldn't be copied; select them instead."),
              )
            }
          >
            Copy binds
          </Button>
          {copied && (
            <p role="status" className="text-sm text-muted-foreground">
              {copied}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
