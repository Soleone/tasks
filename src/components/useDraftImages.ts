import { useRef, useState, type ClipboardEvent } from "react";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/backend/taskModel";
import { practice } from "@/learning/progress";
import { writeAttachment } from "@/platform/backendClient";

function refusal(file: File, count: number): string | null {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type))
    return "Only PNG, JPEG, WebP and GIF images can be added.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Images must be at most 10 MiB.";
  if (count >= MAX_ATTACHMENTS) return `A task can have at most ${MAX_ATTACHMENTS} images.`;
  return null;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * The editor's image list. Pasted images are stored right away, one at a time so the list keeps
 * paste order; the task lists them only when the editor saves.
 */
export function useDraftImages(initial: readonly string[]) {
  const [attachments, setAttachments] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial);
  const writes = useRef(Promise.resolve());
  const queued = useRef(0);

  function change(next: readonly string[]): void {
    latest.current = next;
    setAttachments(next);
  }

  function add(file: File): void {
    const refused = refusal(file, latest.current.length + queued.current);
    if (refused) {
      setError(refused);
      return;
    }
    queued.current += 1;
    writes.current = writes.current
      .then(() => readDataUrl(file))
      .then(writeAttachment)
      .then(
        (name) => {
          practice("attach.paste");
          change([...latest.current, name]);
        },
        (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)),
      )
      .finally(() => {
        queued.current -= 1;
      });
  }

  /** Takes over a paste with an image and no plain text; text pastes go through unchanged. */
  function paste(event: ClipboardEvent<HTMLElement>): void {
    const { clipboardData } = event;
    const files = Array.from(clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0 || clipboardData.getData("text/plain")) return;
    event.preventDefault();
    setError(null);
    for (const file of files) add(file);
  }

  function remove(name: string): void {
    change(latest.current.filter((listed) => listed !== name));
  }

  /** The list once every pasted image is stored. */
  async function settled(): Promise<readonly string[]> {
    await writes.current;
    return latest.current;
  }

  return { attachments, error, paste, remove, settled };
}
