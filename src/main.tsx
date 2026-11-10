import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import favicon16Url from "../assets/branding/favicon-gilt-16.png";
import favicon32Url from "../assets/branding/favicon-gilt-32.png";
import favicon48Url from "../assets/branding/favicon-gilt-48.png";
import { APP_NAME } from "./backend/branding";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/soleone/tooltip/tooltip";
import { applyStoredFontSizeIncrease } from "./fontSize";
import { AppThemeProvider } from "./theme/userThemes";
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
    : // A build-time constant, so other builds drop the web entry and everything in src/web.
      import.meta.env.VITE_HOSTED === "1"
      ? import("./web/WebWorkspace")
      : import("./WorkspaceSelection"));

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppThemeProvider>
        <TooltipProvider>
          <ErrorBoundary>
            <Workspace />
          </ErrorBoundary>
        </TooltipProvider>
      </AppThemeProvider>
    </StrictMode>,
  );
}

void mountWorkspace();
