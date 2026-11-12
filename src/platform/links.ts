import { invoke } from "@tauri-apps/api/core";
import { isMobileApp, runtimeKind } from "./runtime";

const LINK = /https?:\/\/[^\s<>"'`]+/g;

/** Splits text into plain runs and the web links in it; the runs joined are the text unchanged. */
export function linkParts(text: string): (string | { url: string })[] {
  const parts: (string | { url: string })[] = [];
  let end = 0;
  for (const match of text.matchAll(LINK)) {
    // Punctuation that ends the sentence, or closes a bracket opened before the link, isn't its end.
    let url = match[0].replace(/[.,;:!?]+$/, "");
    while (/[)\]}]$/.test(url) && !/[([{]/.test(url))
      url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
    if (!URL.canParse(url)) continue;
    if (match.index > end) parts.push(text.slice(end, match.index));
    parts.push({ url });
    end = match.index + url.length;
  }
  if (end < text.length) parts.push(text.slice(end));
  return parts;
}

export function firstLink(text: string): string | null {
  const link = linkParts(text).find((part) => typeof part !== "string");
  return link ? link.url : null;
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
