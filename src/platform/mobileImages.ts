import { invoke } from "@tauri-apps/api/core";
import { ATTACHMENT_TYPES } from "@/backend/taskModel";
import { readAttachment } from "./backendClient";
import { isIos } from "./runtime";

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
  const [header, data] = dataUrl.split(",", 2);
  const type = header.slice("data:".length, header.indexOf(";"));
  return new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "image", { type });
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
