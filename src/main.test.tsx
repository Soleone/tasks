import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createRoot } from "react-dom/client";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
vi.mock("./scrollbars", () => ({ revealScrollbarsWhileScrolling: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
});

afterEach(() => {
  document.getElementById("root")?.remove();
  for (const icon of document.head.querySelectorAll('link[rel="icon"]')) icon.remove();
});

for (const runtime of ["native", "browser"]) {
  test(`platform.open-workspace: ${runtime} loads its screen before mounting React`, async () => {
    vi.doMock("./platform/runtime", () => ({ runtimeKind: () => runtime }));
    let finishLoading!: () => void;
    const loaded = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    const desktop = vi.fn(async () => {
      await loaded;
      return { default: () => null };
    });
    const browser = vi.fn(async () => {
      await loaded;
      return { default: () => null };
    });
    vi.doMock("./DesktopWorkspace", desktop);
    vi.doMock("./WorkspaceSelection", browser);

    await import("./main");
    await waitFor(() => expect(runtime === "native" ? desktop : browser).toHaveBeenCalledOnce());
    expect(runtime === "native" ? browser : desktop).not.toHaveBeenCalled();
    expect(createRoot).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    finishLoading();
    await waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(createRoot).toHaveBeenCalledExactlyOnceWith(document.getElementById("root"));
  });
}
