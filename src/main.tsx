import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import favicon16Url from "../assets/branding/favicon-two-color-v8-16.png";
import favicon32Url from "../assets/branding/favicon-two-color-v8-32.png";
import favicon48Url from "../assets/branding/favicon-two-color-v8-48.png";
import { APP_NAME } from "./backend/branding";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyStoredFontSizeIncrease } from "./fontSize";
import { ThemeProvider } from "@/components/soleone/theme";
import { themeOptions } from "virtual:theme-options";
import { THEME_STORAGE_KEY } from "./theme/config";
import { runtimeKind } from "./platform/runtime";
import { revealScrollbarsWhileScrolling } from "./scrollbars";
import { installFrameMetrics } from "./frameMetrics";
import "./styles.css";

document.title = APP_NAME;

const favicons = [
  [16, favicon16Url],
  [32, favicon32Url],
  [48, favicon48Url],
] as const;

for (const [size, href] of favicons) {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.sizes = `${size}x${size}`;
  link.href = href;
  document.head.append(link);
}

applyStoredFontSizeIncrease();
revealScrollbarsWhileScrolling();
installFrameMetrics();

async function mountWorkspace(): Promise<void> {
  // Loading before render avoids Suspense's 300 ms delay when revealing the first screen.
  const { default: Workspace } = await (runtimeKind() === "native"
    ? import("./DesktopWorkspace")
    : import("./WorkspaceSelection"));

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
        <TooltipProvider>
          <Workspace />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void mountWorkspace();
