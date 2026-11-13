import { Fragment, useState, type KeyboardEvent, type ReactElement } from "react";
import { Keyboard, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/variants/button";
import { Checkbox } from "@/components/variants/checkbox";
import { Input } from "@/components/variants/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  BINDINGS,
  defaultKey,
  isFixedKey,
  keyCaps,
  keyFor,
  keyFromEvent,
  keyOwner,
  resetKeys,
  setKey,
  swapKeys,
  useKeymap,
  type BindingId,
  type KeyGroup,
} from "@/keymap";

const GROUPS: KeyGroup[] = ["Task actions", "Filter and sort", "Workspace"];

// Shown so the list is complete; these keys can't be picked (`keys.fixed`).
const FIXED: { label: string; keys: string[] }[] = [
  { label: "Move through tasks", keys: ["↑", "↓", "Home", "End"] },
  { label: "Task hierarchy or category", keys: ["←", "→"] },
  { label: "Edit active task", keys: ["Enter"] },
  { label: "Set priority", keys: ["0–4"] },
  { label: "Close or go back", keys: ["Esc"] },
  { label: "Next field", keys: ["Tab"] },
];

/** A key that was pressed but is taken: by another action, or by one of the fixed keys. */
type Clash = { id: BindingId; key: string; owner: BindingId | null };

function Caps({ value }: { value: string }): ReactElement {
  return (
    <KbdGroup>
      {keyCaps(value).map((cap, index) => (
        <Kbd key={index}>{cap}</Kbd>
      ))}
    </KbdGroup>
  );
}

function label(id: BindingId): string {
  return BINDINGS.find((binding) => binding.id === id)!.label;
}

/**
 * Settings › Keys › In Tasks (`keys.rebind`): every shortcut, each with its key. Clicking a key
 * and pressing another changes it at once; a key another action uses asks first.
 */
export function KeysSection(): ReactElement {
  useKeymap();
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [recording, setRecording] = useState<BindingId | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);

  const changed = BINDINGS.filter((binding) => keyFor(binding.id) !== binding.key);
  const words = query.trim().toLowerCase();
  const shown = BINDINGS.filter((binding) => {
    if (changedOnly && keyFor(binding.id) === binding.key) return false;
    const key = keyFor(binding.id);
    const text = `${binding.label} ${key ? keyCaps(key).join("+") : "off"}`.toLowerCase();
    return text.includes(words);
  });

  function choose(id: BindingId, key: string): void {
    setRecording(null);
    if (isFixedKey(key)) return setClash({ id, key, owner: null });
    const owner = keyOwner(key, id);
    if (owner) return setClash({ id, key, owner });
    setClash(null);
    setKey(id, key);
  }

  function recordKey(id: BindingId, event: KeyboardEvent): void {
    if (recording !== id || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return setRecording(null);
    if (event.key === "Backspace") {
      setRecording(null);
      return setKey(id, null);
    }
    const key = keyFromEvent(event.nativeEvent);
    if (key !== null) choose(id, key);
  }

  return (
    <section aria-labelledby="settings-keys" className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-keys" className="flex items-center gap-2 text-sm font-medium">
          <Keyboard aria-hidden="true" className="size-4 text-muted-foreground" />
          In Tasks
        </h2>
        <p className="text-sm text-muted-foreground">
          Click a key, then press the new one. Backspace turns it off, Escape keeps it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Search actions or keys"
          placeholder="Search actions or keys…"
          className="min-w-0 flex-1 basis-56"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Field orientation="horizontal" className="w-auto">
          <Checkbox
            id="settings-keys-changed"
            checked={changedOnly}
            onCheckedChange={setChangedOnly}
          />
          <FieldLabel htmlFor="settings-keys-changed">Changed only</FieldLabel>
        </Field>
      </div>
      <div className="max-h-96 overflow-y-auto overscroll-contain rounded-md border" data-keys-list>
        {GROUPS.map((group) => {
          const rows = shown.filter((binding) => binding.group === group);
          if (!rows.length) return null;
          return (
            <Fragment key={group}>
              <h3 className="sticky top-0 z-10 border-b border-border/60 bg-popover px-3 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
                {group}
              </h3>
              {rows.map(({ id, label: name }) => {
                const key = keyFor(id);
                const isChanged = key !== defaultKey(id);
                return (
                  <div
                    key={id}
                    data-key-row={id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-border/60 px-3 py-1.5 [h3+&]:border-t-0"
                  >
                    <span className="text-sm font-medium">
                      {name}
                      {isChanged && (
                        <span
                          aria-hidden="true"
                          className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
                        />
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        variant={recording === id ? "outline" : "ghost"}
                        size="sm"
                        className={cn("min-w-24 justify-end", recording === id && "justify-center")}
                        aria-label={isChanged ? `${name} (changed)` : name}
                        aria-description={
                          recording === id
                            ? "Press the new key"
                            : key
                              ? keyCaps(key).join("+")
                              : "Off"
                        }
                        aria-pressed={recording === id}
                        onClick={() => {
                          setClash(null);
                          setRecording(recording === id ? null : id);
                        }}
                        onBlur={() => setRecording(null)}
                        onKeyDown={(event) => recordKey(id, event)}
                      >
                        {recording === id ? (
                          <span className="text-muted-foreground">Press a key…</span>
                        ) : key ? (
                          <Caps value={key} />
                        ) : (
                          <span className="text-muted-foreground">Off</span>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(!isChanged && "invisible")}
                        aria-label={`Reset ${name} to ${keyCaps(defaultKey(id)).join("+")}`}
                        title={`Back to ${keyCaps(defaultKey(id)).join("+")}`}
                        onClick={() => choose(id, defaultKey(id))}
                      >
                        <RotateCcw aria-hidden="true" />
                      </Button>
                    </span>
                    {clash?.id === id && (
                      <ClashNote
                        clash={clash}
                        onSwap={(owner) => {
                          swapKeys(id, clash.key, owner);
                          setClash(null);
                        }}
                        onClose={() => setClash(null)}
                      />
                    )}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
        {!words && !changedOnly && (
          <>
            <h3 className="sticky top-0 z-10 border-b border-border/60 bg-popover px-3 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
              Always the same
            </h3>
            {FIXED.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1.5 text-sm text-muted-foreground [h3+&]:border-t-0"
              >
                {row.label}
                {/* The same box as a key button and its reset, so the caps line up with those above. */}
                <span className="flex items-center gap-1">
                  <span className="flex h-7 items-center border border-transparent px-2.5">
                    <KbdGroup>
                      {row.keys.map((cap) => (
                        <Kbd key={cap}>{cap}</Kbd>
                      ))}
                    </KbdGroup>
                  </span>
                  <span className="size-7" />
                </span>
              </div>
            ))}
          </>
        )}
        {!shown.length && (words || changedOnly) && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {words ? "No shortcuts match." : "Every key is the default."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {changed.length
            ? `${changed.length} ${changed.length === 1 ? "key" : "keys"} changed from the defaults`
            : "Every key is the default"}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!changed.length}
          onClick={() => {
            setClash(null);
            resetKeys();
          }}
        >
          Reset all keys
        </Button>
      </div>
    </section>
  );
}

/** Why a pressed key wasn't taken, and Swap when another action has it (`keys.conflict`). */
function ClashNote({
  clash,
  onSwap,
  onClose,
}: {
  clash: Clash;
  onSwap: (owner: BindingId) => void;
  onClose: () => void;
}): ReactElement {
  const { owner } = clash;
  const previous = keyFor(clash.id);
  return (
    <div
      role="status"
      className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 basis-60">
        <Caps value={clash.key} />{" "}
        {owner ? (
          <>
            already does <strong className="font-medium">{label(owner)}</strong>. Swap gives it{" "}
            {previous ? <Caps value={previous} /> : "no key"}.
          </>
        ) : (
          "always keeps its own meaning. Pick another key."
        )}
      </p>
      <span className="flex gap-2">
        {owner && (
          <Button size="sm" onClick={() => onSwap(owner)}>
            Swap
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>
          {owner ? "Cancel" : "OK"}
        </Button>
      </span>
    </div>
  );
}
