import { invoke } from "@tauri-apps/api/core";
import { isMobileApp, runtimeKind } from "./runtime";

const LINK = /https?:\/\/[^\s<>"'`]+/g;

export function firstLink(text: string): string | null {
  for (const [match] of text.matchAll(LINK)) {
    // Punctuation that ends the sentence, or closes a bracket opened before the link, isn't its end.
    let url = match.replace(/[.,;:!?]+$/, "");
    while (/[)\]}]$/.test(url) && !/[([{]/.test(url))
      url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
    if (URL.canParse(url)) return url;
  }
  return null;
}

/** The phone apps have no way to hand a link to the browser yet, so they show links as text. */
export function canOpenLinks(): boolean {
  return !isMobileApp();
}

/** Opens a web link in the system browser, or a new tab on the web. */
export async function openLink(url: string): Promise<void> {
  if (!canOpenLinks()) throw new Error("Links can't be opened on this device yet.");
  if (runtimeKind() === "native") await invoke("link_open", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
