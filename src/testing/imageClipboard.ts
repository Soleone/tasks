import { onTestFinished, vi } from "vite-plus/test";

class FakeClipboardItem {
  constructor(private readonly data: Record<string, Promise<Blob>>) {}
  getType(type: string): Promise<Blob> {
    return this.data[type];
  }
}

/**
 * Lets the clipboard take images as browsers do: a write waits for every promised blob and fails
 * when one does. Returns the bytes of the last copied PNG. Call after rendering, which installs
 * user-event's clipboard.
 */
export function fakeImageClipboard(): () => Promise<number[] | null> {
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  let copied: Blob | null = null;
  const write = vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    const item = items[0] as unknown as FakeClipboardItem;
    copied = await item.getType("image/png");
  });
  onTestFinished(() => {
    write.mockRestore();
    vi.unstubAllGlobals();
  });
  return async () => (copied ? Array.from(new Uint8Array(await copied.arrayBuffer())) : null);
}
