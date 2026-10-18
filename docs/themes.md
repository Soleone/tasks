# Themes

Choose a built-in palette with `Alt+T`, the header's **Themes** button, or `Ctrl/⌘+K` → **Themes**. Theme selection stays in the dedicated picker, not Settings. Gilt is the default.

The shared picker shows a ring of preview cards. Drag, scroll or use the arrow keys to browse; type to filter by name or dark/light mode. Browsing does not change the page. Enter or clicking the front card confirms; Escape clears a filter first, then closes. Focus returns to the opener. Tasks keeps `Alt+T`, with no plain T or D theme shortcut.

## Shared implementation

Themes come from the [`@soleone` registry](https://github.com/Soleone/shadcn-components), maintained at `$SRC/js/shadcn-components`:

- `src/components/soleone/theme/`: palettes, parser, semantic tokens, provider and reveal.
- `src/components/soleone/theme-vite/`: builds palette CSS and restores the saved choice in `index.html` before paint. Only theme options, not TOML or the parser, enter the client bundle.
- `src/components/soleone/theme-picker/` and `material/`: the picker and its preview materials.
- `src/theme/config.ts`: Tasks' public built-in palette list, Gilt default and `tasks.selectedTheme` storage key. Hidden portfolio themes are excluded.

Registry sources stay upstream. Tasks only supplies opening, shortcut and focus-return behavior, plus its task-specific CSS roles. There is no backend theme list, filesystem theme loading or live Omarchy following.

The shared picker supports controlled `open`/`onOpenChange`, an optional `trigger`, `shortcut={false}` and `finalFocus`. These hooks and the denied-storage fallback were added in local shared commit `f3a38a0` for this adoption. Publish that commit before pulling future registry updates from GitHub; installing an older picker would remove those hooks. `kit check` was run against the local registry built from that commit; the configured GitHub registry will not match until it is published.

## Persistence and validation

Selection stays in the same browser/WebView profile. For Linux dev:web this also requires the same origin (scheme, host and port). A fresh profile, cleared storage, unavailable storage or an unknown stored name falls back to Gilt. Theme changes do not select a task folder or modify tasks, history or pending requests. Custom theme imports remain out of scope.

Validation covers shared pre-paint restoration and denied storage, controlled and default picker entry points, selection, focus return, hidden-dialog keyboard guards, Settings, browser reload and unchanged task files. Desktop and mobile-width Linux Chromium captures were inspected; the browser regression suite includes axe checks. This is not Windows WebView or Android device acceptance. [Current support](support.md) owns platform limits.
