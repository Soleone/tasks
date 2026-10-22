import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
} from "react";
import { ChevronLeft, ChevronRight, Copy, ImageOff, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImagePreviewContent, PreviewImage } from "@/components/variants/dialog";
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
 * The editor's thumbnails as one Tab stop. Left and Right move, Space previews, Ctrl/⌘+C copies,
 * Delete or Backspace removes; other keys go to `onKeyDown`. It works before any image has loaded.
 */
export function AttachmentRow({
  ref,
  id,
  names,
  onRemove,
  onCopy,
  onFocus,
  onKeyDown,
}: {
  ref: Ref<HTMLDivElement>;
  id: string;
  names: readonly string[];
  onRemove: (name: string) => void;
  onCopy: (name: string) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}): ReactElement {
  const images = useImages(names);
  const [active, setActive] = useState(0);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const previewPopup = useRef<HTMLDivElement>(null);
  const current = Math.min(active, names.length - 1);
  const previewImage = previewing === null ? undefined : images[names[previewing]];

  function preview(index: number): void {
    const image = images[names[index]];
    if (image && "url" in image) setPreviewing(index);
  }

  // Browsing wraps around and also moves the row, so closing lands on the last image viewed.
  function stepPreview(from: number, step: -1 | 1): void {
    const next = (from + step + names.length) % names.length;
    setPreviewing(next);
    setActive(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setActive(Math.min(names.length - 1, Math.max(0, current + step)));
      return;
    }
    if (plain && event.key === " ") {
      event.preventDefault();
      if (!event.repeat) preview(current);
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "c"
    ) {
      event.preventDefault();
      if (!event.repeat) onCopy(names[current]);
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
    <>
      <div
        ref={ref}
        role="listbox"
        aria-label="Images"
        aria-orientation="horizontal"
        aria-activedescendant={`${id}-image-${current}`}
        aria-keyshortcuts="ArrowLeft ArrowRight Space Control+c Meta+c Delete Backspace"
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
                preview(index);
              }}
            >
              <Thumbnail image={image} />
              <span className="absolute top-0.5 right-0.5 flex gap-0.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  tabIndex={-1}
                  aria-label="Copy image"
                  title="Copy image"
                  onMouseDown={preventFocusSteal}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopy(name);
                  }}
                >
                  <Copy aria-hidden="true" />
                </Button>
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
      <Dialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewing(null);
        }}
      >
        {previewing !== null ? (
          <ImagePreviewContent
            ref={previewPopup}
            // The popup takes focus rather than the close button, so no focus ring shows on open.
            initialFocus={previewPopup}
            aria-label={`Image ${previewing + 1} of ${names.length}`}
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                stepPreview(previewing, event.key === "ArrowLeft" ? -1 : 1);
              } else if (event.key === " ") {
                event.preventDefault();
                setPreviewing(null);
              }
            }}
          >
            {previewImage && "url" in previewImage ? (
              <PreviewImage src={previewImage.url} />
            ) : (
              <span className="block size-64 overflow-hidden rounded-md">
                <Thumbnail image={previewImage} />
              </span>
            )}
            {names.length > 1 ? (
              <>
                <span className="absolute top-1/2 left-3 -translate-y-1/2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label="Previous image"
                    onMouseDown={preventFocusSteal}
                    onClick={() => stepPreview(previewing, -1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                </span>
                <span className="absolute top-1/2 right-3 -translate-y-1/2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label="Next image"
                    onMouseDown={preventFocusSteal}
                    onClick={() => stepPreview(previewing, 1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </span>
              </>
            ) : null}
          </ImagePreviewContent>
        ) : null}
      </Dialog>
    </>
  );
}
