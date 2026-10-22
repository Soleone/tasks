import { readAttachment } from "./backendClient";

/** The image as PNG, the one image type every system clipboard takes from a web page. */
async function pngBlob(dataUrl: string): Promise<Blob> {
  const [header, data] = dataUrl.split(",", 2);
  const type = header.slice("data:".length, header.indexOf(";"));
  const blob = new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type });
  if (type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error("The image could not be converted."))),
      "image/png",
    ),
  );
}

/**
 * Copies one stored image to the system clipboard. The clipboard write starts before anything is
 * awaited, so WebKit still counts the key or click that asked for it. A missing image rejects with
 * the read's own error rather than the clipboard's.
 */
export async function copyImage(name: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    throw new Error("This device can't copy images.");
  const png = readAttachment(name).then(pngBlob);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (caught) {
    await png;
    throw caught;
  }
}
