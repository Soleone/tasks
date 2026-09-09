import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyStoredTheme } from "./theme";
import "./styles.css";

// Paint the remembered theme before React renders so a launch does not flash
// the neutral ramp; the workspace selection reconciles it right after.
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
