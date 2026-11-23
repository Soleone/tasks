import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { AppWorkspace, pngBytes } from "@/testing/appWorkspace";
import { fakeImageClipboard } from "@/testing/imageClipboard";
import { expectActive, expectListFocused, focusedTitleField } from "@/testing/taskList";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

async function onlyTask() {
  const { tasks } = await workspace.command<{ tasks: { id: string }[] }>("task.list", {
    status: [],
  });
  expect(tasks).toHaveLength(1);
  return workspace.task(tasks[0].id);
}

async function capture(user: UserEvent, text: string): Promise<void> {
  await user.keyboard("c");
  await focusedTitleField();
  await user.keyboard(text);
}

describe("images", () => {
  const png = () => new File([new Uint8Array(pngBytes())], "shot.png", { type: "image/png" });

  function paste(target: Element, files: File[], text = ""): void {
    fireEvent.paste(target, { clipboardData: { files, getData: () => text } });
  }

  function thumbnails(): HTMLElement[] {
    const images = screen.queryByRole("listbox", { name: "Images" });
    return images ? within(images).queryAllByRole("option") : [];
  }

  async function openEditor(user: UserEvent, title: string): Promise<HTMLInputElement> {
    await expectActive(title);
    await user.keyboard("{Enter}");
    return focusedTitleField();
  }

  test("attach.paste: an image pasted in the title is listed when the editor saves", async () => {
    const { user } = await workspace.render();
    await capture(user, "Screenshot");
    const title = document.activeElement as HTMLInputElement;
    paste(title, [png()], "copied text");
    expect(thumbnails()).toHaveLength(0);
    paste(title, [png()]);
    await waitFor(() => expect(thumbnails()).toHaveLength(1));
    await waitFor(() =>
      expect(thumbnails()[0].querySelector("img")?.getAttribute("src")).toMatch(
        /^data:image\/png;base64,/,
      ),
    );
    await user.keyboard("{Enter}");
    await expectListFocused();
    await waitFor(async () => {
      const task = await onlyTask();
      expect(task.attachments).toEqual([expect.stringMatching(/\.png$/)]);
      expect(task.description).toBe("");
    });
  });

  test("attach.refused: other file types and an 11th image are refused with a message", async () => {
    const names = await Promise.all(Array.from({ length: 10 }, () => workspace.storeImage()));
    await workspace.create("Full", { attachments: names });
    const { user } = await workspace.render();
    const title = await openEditor(user, "Full");
    await waitFor(() => expect(thumbnails()).toHaveLength(10));
    paste(title, [png()]);
    await screen.findByText("A task can have at most 10 images.");
    paste(title, [new File(["BM"], "shot.bmp", { type: "image/bmp" })]);
    await screen.findByText("Only PNG, JPEG, WebP and GIF images can be added.");
    expect(thumbnails()).toHaveLength(10);
  });

  test("attach.row-keys: the image row is one stop; arrows move and Delete removes from the draft", async () => {
    const [first, second] = [await workspace.storeImage(), await workspace.storeImage()];
    const task = await workspace.create("Task", { attachments: [first, second] });
    const { user } = await workspace.render();
    await openEditor(user, "Task");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    const images = screen.getByRole("listbox", { name: "Images" });
    await waitFor(() => expect(document.activeElement).toBe(images));
    const active = () => document.getElementById(images.getAttribute("aria-activedescendant")!);
    expect(active()?.dataset.attachment).toBe(first);
    await user.keyboard("{ArrowRight}");
    expect(active()?.dataset.attachment).toBe(second);
    await user.keyboard("{Delete}");
    expect(thumbnails().map((option) => option.dataset.attachment)).toEqual([first]);
    await user.keyboard("{Tab}");
    await focusedTitleField();
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toEqual([first]));
  });

  test("attach.row-keys: Ctrl+C copies the focused image and Copy image does the same", async () => {
    await workspace.create("Task", {
      attachments: [await workspace.storeImage(1), await workspace.storeImage(2)],
    });
    const { user } = await workspace.render();
    const copied = fakeImageClipboard();
    await openEditor(user, "Task");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Control>}c{/Control}");
    await screen.findByText("Image copied to clipboard");
    expect((await copied())?.at(-1)).toBe(1);
    await user.click(within(thumbnails()[1]).getByRole("button", { name: "Copy image" }));
    await waitFor(async () => expect((await copied())?.at(-1)).toBe(2));
  });

  test("attach.preview: Space or a click opens the image; arrows cycle through; Escape or Space closes", async () => {
    const task = await workspace.create("Task", {
      attachments: [await workspace.storeImage(1), await workspace.storeImage(2)],
    });
    const { user } = await workspace.render();
    await openEditor(user, "Task");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    const images = screen.getByRole("listbox", { name: "Images" });
    await waitFor(() =>
      expect(thumbnails().every((option) => option.querySelector("img"))).toBe(true),
    );
    const sources = thumbnails().map((option) => option.querySelector("img")?.getAttribute("src"));
    const shown = async (index: number) => {
      const preview = await screen.findByRole("dialog", { name: `Image ${index + 1} of 2` });
      expect(preview.querySelector("img")?.getAttribute("src")).toBe(sources[index]);
      await waitFor(() => expect(document.activeElement).toBe(preview));
    };
    await user.keyboard(" ");
    await shown(0);
    await user.keyboard("{ArrowRight}");
    await shown(1);
    await user.click(screen.getByRole("button", { name: "Previous image" }));
    await shown(0);
    await user.click(screen.getByRole("button", { name: "Previous image" }));
    await shown(1);
    await user.keyboard("{ArrowRight}");
    await shown(0);
    await user.click(screen.getByRole("button", { name: "Next image" }));
    await shown(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(images));
    expect(images.getAttribute("aria-activedescendant")).toBe(thumbnails()[1].id);
    await user.click(thumbnails()[0]);
    await shown(0);
    await user.keyboard(" ");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("form", { name: "Edit task" })).not.toBeNull();
    expect((await workspace.task(task.id)).attachments).toHaveLength(2);
  });

  test("attach.cancel: canceling drops images pasted in the editor", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    const title = await openEditor(user, "Task");
    paste(title, [png()]);
    await waitFor(() => expect(thumbnails()).toHaveLength(1));
    await user.keyboard("{Escape}");
    await expectListFocused();
    expect((await workspace.task(task.id)).attachments).toEqual([]);
  });

  test("attach.missing: an image that isn't on this device reads Image missing and can be removed", async () => {
    const name = await workspace.storeImage();
    const task = await workspace.create("Task", { attachments: [name] });
    await workspace.loseImage(name);
    const { user } = await workspace.render();
    await openEditor(user, "Task");
    const missing = await screen.findByText("Image missing");
    await user.hover(missing);
    await screen.findByText(/not have synced yet/);
    await user.click(screen.getByRole("button", { name: "Remove image" }));
    expect(thumbnails()).toHaveLength(0);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toEqual([]));
  });

  test("undo.scope: removing an image in the editor is undone and redone like any edit", async () => {
    const name = await workspace.storeImage();
    const task = await workspace.create("Task", { attachments: [name] });
    const { user } = await workspace.render();
    await openEditor(user, "Task");
    await user.click(await screen.findByRole("button", { name: "Remove image" }));
    await user.keyboard("{Enter}");
    await expectListFocused();
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toEqual([]));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toEqual([name]));
    await user.keyboard("{Control>}y{/Control}");
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toEqual([]));
  });
});

describe("Android image actions", () => {
  const imageUrl = (pixel = 1) =>
    `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes(pixel)))}`;

  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 16)");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(invoke).mockReset();
  });

  function nativeImages(handler: (command: string, args?: unknown) => unknown): void {
    // Mock only Tauri's native boundary; attachment storage uses the real disposable backend.
    vi.mocked(invoke).mockImplementation(async (command, args) => handler(command, args));
  }

  test("platform.add-image: picking adds a draft attachment, which saves and can be shared as image bytes", async () => {
    const task = await workspace.create("Screenshot");
    const { user } = await workspace.render();
    const shared: string[] = [];
    nativeImages((command, args) => {
      if (command === "image_pick") return { dataUrl: imageUrl(2) };
      if (command === "image_share") shared.push((args as { dataUrl: string }).dataUrl);
    });
    await expectActive("Screenshot");
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.click(screen.getByRole("button", { name: "Add image" }));
    const images = await screen.findByRole("listbox", { name: "Images" });
    await waitFor(() => expect(images.querySelector("img")?.getAttribute("src")).toBe(imageUrl(2)));
    expect((await workspace.task(task.id)).attachments).toEqual([]);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await expectListFocused();
    await waitFor(async () => expect((await workspace.task(task.id)).attachments).toHaveLength(1));
    await user.keyboard("{Enter}");
    await focusedTitleField();
    const thumbnail = within(await screen.findByRole("listbox", { name: "Images" })).getByRole(
      "option",
    );
    await waitFor(() => expect(thumbnail.querySelector("img")).not.toBeNull());
    await user.click(thumbnail);
    const preview = await screen.findByRole("dialog", { name: "Image 1 of 1" });
    await user.click(within(preview).getByRole("button", { name: "Share image…" }));
    await waitFor(() => expect(shared).toEqual([imageUrl(2)]));
    expect((await workspace.task(task.id)).attachments).toHaveLength(1);
  });

  test("platform.add-image: canceling the picker keeps the draft, and picker failures can be retried", async () => {
    const task = await workspace.create("Keep me");
    const { user } = await workspace.render();
    let fail = false;
    nativeImages((command) => {
      if (command !== "image_pick") return;
      if (fail) throw new Error("The selected image could not be read.");
      return { dataUrl: null };
    });
    await expectActive("Keep me");
    await user.keyboard("{Enter}");
    const title = await focusedTitleField();
    const add = screen.getByRole<HTMLButtonElement>("button", { name: "Add image" });
    await user.click(add);
    await waitFor(() => expect(add.disabled).toBe(false));
    expect(title.value.trim()).toBe("Keep me");
    expect(screen.queryByRole("listbox", { name: "Images" })).toBeNull();
    expect(screen.queryByText("Image not added")).toBeNull();
    fail = true;
    await user.click(add);
    await screen.findByText("The selected image could not be read.");
    fail = false;
    await user.click(add);
    await waitFor(() => expect(screen.queryByText("Image not added")).toBeNull());
    await user.keyboard("{Escape}");
    expect((await workspace.task(task.id)).attachments).toEqual([]);
  });

  test("platform.add-image: an eleventh picked image is refused and saving cannot race the picker", async () => {
    const attachments = await Promise.all(Array.from({ length: 10 }, () => workspace.storeImage()));
    const task = await workspace.create("Full", { attachments });
    const { user } = await workspace.render();
    let finish!: (result: { dataUrl: string }) => void;
    nativeImages((command) => {
      if (command === "image_pick")
        return new Promise((resolve) => {
          finish = resolve;
        });
    });
    await expectActive("Full");
    await user.keyboard("{Enter}");
    const title = await focusedTitleField();
    await user.click(screen.getByRole("button", { name: "Add image" }));
    fireEvent.submit(title.form!);
    expect(screen.getByRole("form", { name: "Edit task" })).not.toBeNull();
    finish({ dataUrl: imageUrl() });
    await screen.findByText("A task can have at most 10 images.");
    expect((await workspace.task(task.id)).attachments).toEqual(attachments);
  });

  test("platform.share-image: sharing follows the displayed image; errors leave the preview open", async () => {
    await workspace.create("Two images", {
      attachments: [await workspace.storeImage(1), await workspace.storeImage(2)],
    });
    const { user } = await workspace.render();
    let shared = "";
    let fail = false;
    nativeImages((command, args) => {
      if (command !== "image_share") return;
      if (fail) throw new Error("No app could open the image.");
      shared = (args as { dataUrl: string }).dataUrl;
    });
    await expectActive("Two images");
    await user.keyboard("{Enter}");
    await focusedTitleField();
    const images = await screen.findByRole("listbox", { name: "Images" });
    await waitFor(() => expect(images.querySelectorAll("img")).toHaveLength(2));
    await user.click(within(images).getAllByRole("option")[0]);
    await screen.findByRole("dialog", { name: "Image 1 of 2" });
    await user.click(screen.getByRole("button", { name: "Next image" }));
    const preview = await screen.findByRole("dialog", { name: "Image 2 of 2" });
    const share = within(preview).getByRole("button", { name: "Share image…" });
    await user.tab();
    expect(document.activeElement).toBe(share);
    await user.keyboard(" ");
    await waitFor(() => expect(shared).toBe(imageUrl(2)));
    fail = true;
    await user.click(share);
    await screen.findByText("No app could open the image.");
    expect(screen.getByRole("dialog", { name: "Image 2 of 2" })).toBe(preview);
  });

  // The test app starts as a browser page; the launch is taken when the native app comes forward.
  async function comeForward(): Promise<void> {
    await workspace.create("Already here");
    await workspace.render();
    await expectActive("Already here");
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    document.dispatchEvent(new Event("visibilitychange"));
  }

  test("platform.capture: a share from another app opens the New task editor filled in, once", async () => {
    let waiting = true;
    nativeImages((command) => {
      if (command !== "capture_take") return;
      const pending = waiting;
      waiting = false;
      return pending
        ? {
            pending,
            subject: "Release notes",
            text: "https://example.com/notes",
            dataUrl: imageUrl(2),
          }
        : { pending };
    });
    await comeForward();
    const title = await focusedTitleField();
    expect(title.value).toBe("Release notes");
    expect(screen.getByDisplayValue("https://example.com/notes")).toBeTruthy();
    const images = await screen.findByRole("listbox", { name: "Images" });
    await waitFor(() => expect(images.querySelector("img")?.getAttribute("src")).toBe(imageUrl(2)));
    // Coming forward again with nothing new leaves the draft alone.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(title.value).toBe("Release notes");
    vi.unstubAllGlobals();
  });

  test("platform.capture: shared text without a name puts its first line in the title", async () => {
    let waiting = true;
    nativeImages((command) => {
      if (command !== "capture_take") return;
      const pending = waiting;
      waiting = false;
      return pending ? { pending, text: "Call the plumber\nbefore Friday" } : { pending };
    });
    await comeForward();
    expect((await focusedTitleField()).value).toBe("Call the plumber");
    expect(screen.getByDisplayValue("before Friday")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
