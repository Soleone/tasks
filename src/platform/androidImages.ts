import { invoke } from "@tauri-apps/api/core";
import { readAttachment } from "./backendClient";

/** The picker grants access to this image only; no gallery permission is needed. */
export async function pickImage(): Promise<File | null> {
  const { dataUrl } = await invoke<{ dataUrl: string | null }>("image_pick");
  if (dataUrl === null) return null;
  const [header, data] = dataUrl.split(",", 2);
  const type = header.slice("data:".length, header.indexOf(";"));
  return new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "image", { type });
}

/** Shares the bytes, not the task folder's path or a URL another app cannot open. */
export async function shareImage(name: string): Promise<void> {
  await invoke("image_share", { dataUrl: await readAttachment(name) });
}
