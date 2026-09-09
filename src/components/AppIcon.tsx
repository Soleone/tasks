import type { ReactElement } from "react";
import iconSvg from "../../assets/branding/ai-todo-icon-two-color-v6.svg?raw";

/**
 * Theme-aware header mark. The artwork lives in the branding SVG file, not
 * here: it paints background shapes with `--app-icon-bg` and foreground
 * shapes with `--app-icon-fg`, so replacing the file with new artwork that
 * keeps those two hooks themes automatically with no component change. The
 * file is a build-time asset, and the wrapper hides it from assistive tech.
 */
export function AppIcon({ className }: { className?: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={className === undefined ? "app-icon" : `app-icon ${className}`}
      dangerouslySetInnerHTML={{ __html: iconSvg }}
    />
  );
}
