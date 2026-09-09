import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import favicon16Url from "../assets/branding/favicon-two-color-v4-16.png";
import favicon32Url from "../assets/branding/favicon-two-color-v4-32.png";
import favicon48Url from "../assets/branding/favicon-two-color-v4-48.png";
import App from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyStoredTheme } from "./theme";
import "./styles.css";

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

// Paint the remembered theme before React renders so a launch does not flash
// the neutral ramp; the workspace selection reconciles it right after.
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
