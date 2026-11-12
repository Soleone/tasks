import { invoke } from "@tauri-apps/api/core";
import { ATTACHMENT_TYPES } from "@/backend/taskModel";
import { readAttachment } from "./backendClient";
import { isAndroid, isIos, runtimeKind } from "./runtime";

/** The WebView's own picker; naming the types has iOS convert a HEIC photo to JPEG. */
function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ATTACHMENT_TYPES.join(",");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** The picker grants access to this image only; no gallery permission is needed. */
export async function pickImage(): Promise<File | null> {
  if (isIos()) return pickWithInput();
  const { dataUrl } = await invoke<{ dataUrl: string | null }>("image_pick");
  if (dataUrl === null) return null;
  return imageFile(dataUrl);
}

function imageFile(dataUrl: string): File {
  const [header, data] = dataUrl.split(",", 2);
  const type = header.slice("data:".length, header.indexOf(";"));
  return new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "image", { type });
}

/** What a New task launch from outside the app brings along. */
export type Capture = { title: string; description: string; image?: File };

/**
 * The Android launch waiting for the editor, once: the launcher's New task shortcut (empty) or
 * something shared from another app. A shared page's name is the title and its text the notes;
 * without a name the first line is the title.
 */
export async function takeCapture(): Promise<Capture | null> {
  if (!isAndroid() || runtimeKind() !== "native") return null;
  const shared = await invoke<{
    pending: boolean;
    subject?: string;
    text?: string;
    dataUrl?: string;
  }>("capture_take");
  if (!shared.pending) return null;
  const lines = (shared.text ?? "").trim().split("\n");
  const subject = shared.subject?.trim().replace(/\s+/g, " ");
  return {
    title: subject || lines[0].trim(),
    description: (subject ? lines : lines.slice(1)).join("\n").trim(),
    ...(shared.dataUrl ? { image: imageFile(shared.dataUrl) } : {}),
  };
}

/** Shares the bytes, not the task folder's path or a URL another app cannot open. */
export async function shareImage(name: string): Promise<void> {
  const dataUrl = await readAttachment(name);
  if (!isIos()) return invoke("image_share", { dataUrl });
  const image = await (await fetch(dataUrl)).blob();
  try {
    await navigator.share({ files: [new File([image], name, { type: image.type })] });
  } catch (error) {
    // Closing the share sheet without choosing is not a failure.
    if ((error as Error).name !== "AbortError") throw error;
  }
}
