import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vite-plus/test";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Broken(): never {
  throw new Error("Cannot read properties of undefined");
}

test("client.crash: a render error shows a message with Reload and a prefilled bug report", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = userEvent.setup();
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  const alert = within(screen.getByRole("alert"));
  alert.getByText(/Cannot read properties of undefined/);
  alert.getByText(/Your tasks are safe/);
  alert.getByRole("button", { name: "Reload" });
  await user.click(alert.getByRole("button", { name: "Send feedback" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Send feedback" }));
  expect(dialog.getByRole("textbox", { name: "Title" })).toHaveProperty(
    "value",
    "Crash: Cannot read properties of undefined",
  );
  expect(
    (dialog.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value,
  ).toContain("at Broken");
  expect(dialog.getByRole("radio", { name: "Bug" }).getAttribute("aria-checked")).toBe("true");
});
