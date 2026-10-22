import { useEffect, useState, type KeyboardEvent, type ReactElement, type Ref } from "react";
import { ImageOff, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { preventFocusSteal } from "@/navigation";
import { readAttachment } from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";

type ImageState = { url: string } | { missing: true } | { failed: string };

const MISSING_HINT = "It may not have synced yet, or it was removed on another device.";

/** Reads each listed image once; names without a state are still loading. */
function useImages(names: readonly string[]): Readonly<Record<string, ImageState>> {
  const [images, setImages] = useState<Record<string, ImageState>>({});
  useEffect(() => {
    let cancelled = false;
    for (const name of names)
      readAttachment(name).then(
        (url) => {
          if (!cancelled) setImages((current) => ({ ...current, [name]: { url } }));
        },
        (caught: unknown) => {
          if (cancelled) return;
          const state =
            caught instanceof EditorError && caught.code === "ATTACHMENT_NOT_FOUND"
              ? { missing: true as const }
              : { failed: caught instanceof Error ? caught.message : String(caught) };
          setImages((current) => ({ ...current, [name]: state }));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [names]);
  return images;
}

function Thumbnail({ image }: { image: ImageState | undefined }): ReactElement {
  if (!image) return <span className="size-full animate-pulse bg-muted" />;
  if ("url" in image) return <img src={image.url} alt="" className="size-full object-cover" />;
  return (
    <span
      title={"missing" in image ? MISSING_HINT : image.failed}
      className="flex size-full flex-col items-center justify-center gap-1 bg-muted p-1 text-center text-xs text-muted-foreground"
    >
      <ImageOff className="size-4" aria-hidden="true" />
      {"missing" in image ? "Image missing" : "Image can't be shown"}
    </span>
  );
}

/**
 * The editor's thumbnails as one Tab stop. Left and Right move, Delete or Backspace removes; other
 * keys go to `onKeyDown`. It works before any image has loaded.
 */
export function AttachmentRow({
  ref,
  id,
  names,
  onRemove,
  onFocus,
  onKeyDown,
}: {
  ref: Ref<HTMLDivElement>;
  id: string;
  names: readonly string[];
  onRemove: (name: string) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}): ReactElement {
  const images = useImages(names);
  const [active, setActive] = useState(0);
  const current = Math.min(active, names.length - 1);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setActive(Math.min(names.length - 1, Math.max(0, current + step)));
      return;
    }
    if (plain && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      onRemove(names[current]);
      return;
    }
    onKeyDown(event);
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Images"
      aria-orientation="horizontal"
      aria-activedescendant={`${id}-image-${current}`}
      aria-keyshortcuts="ArrowLeft ArrowRight Delete Backspace"
      tabIndex={0}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      className="group flex flex-wrap gap-2 rounded-md outline-none"
    >
      {names.map((name, index) => {
        const image = images[name];
        const missing = image !== undefined && "missing" in image;
        return (
          <div
            key={name}
            id={`${id}-image-${index}`}
            role="option"
            aria-selected={index === current}
            aria-label={`Image ${index + 1} of ${names.length}${missing ? `, missing. ${MISSING_HINT}` : ""}`}
            data-attachment={name}
            className={cn(
              "relative size-16 overflow-hidden rounded-md border",
              "group-focus-visible:aria-selected:ring-2 group-focus-visible:aria-selected:ring-ring",
            )}
            onClick={(event) => {
              setActive(index);
              event.currentTarget.parentElement?.focus();
            }}
          >
            <Thumbnail image={image} />
            <span className="absolute top-0.5 right-0.5">
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                tabIndex={-1}
                aria-label="Remove image"
                title="Remove image"
                onMouseDown={preventFocusSteal}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(name);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
