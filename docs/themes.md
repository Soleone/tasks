# Themes

Choose a built-in palette in **Settings → General → Appearance**, with `Alt+T`, or through `Ctrl/⌘+K` → **Themes**. Gilt is the default; built-in dark/light palettes ship with the app.

On the selected replacement route, theme selection uses the existing client-local preferences. Linux dev:web retains it at the same origin (scheme, host and port) in the same browser profile. Another origin/profile or cleared storage starts with defaults. Theme changes do not select a task folder, modify canonical tasks or preserve unresolved requests. Custom filesystem themes and live Omarchy following are not supplied on this route.

The Windows disposable native launcher gives each launch fresh WebView storage. Durable preferences on the final native route still need proof; browser persistence is not native acceptance. [Current support](support.md) owns the platform limits.

## Palette format and preview

Palettes use the [Omarchy `colors.toml` format](https://omarchy.org). Components consume semantic region tokens, not theme-specific classes. A palette can specify only the slots it needs; unset values fall back to the neutral ramp for its mode:

```toml
mode = "dark"
accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#c0caf5"
```

Palette text roles are adjusted toward readability while retaining the author's accent when it cannot meet the normal text contrast floor. This is not universal custom-theme accessibility acceptance.
