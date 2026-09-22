# Themes

Themes are palettes in the [omarchy `colors.toml` format](https://omarchy.org). Components consume a small set of region tokens, so a theme file does not need to know the app's component classes.

## Choose a theme

Choose a theme in **Settings → General → Appearance**, or open the searchable picker with `Alt+T` or `Ctrl/⌘+K` → **Themes**. Desktop stores the selection in its local workspace database, shared by the UI, CLI, and agents using that database. Android stores its selection privately on the device; it does not sync theme preferences through the canonical task folder.

The app includes built-in dark and light palettes, including **Gilt**, the cool obsidian and sovereign-gold Omarchy theme (formerly **oligarchy**). Gilt is selected when no workspace choice exists. Built-ins are bundled with each app, so packaged builds do not depend on theme files.

Android includes the same built-in dark and light palettes as desktop. Workspace `.toml` themes and live Omarchy following are desktop-only for now.

On Omarchy, **Omarchy System** appears when `~/.local/state/omarchy/current/theme/colors.toml` exists. It reads the active palette directly instead of copying it into the workspace. When selected, the app refreshes it about every 1.5 seconds, so an Omarchy theme change follows without restarting Tasks. The entry is unavailable when the live palette is absent.

## Add a workspace theme

Create a `themes/` directory beside `tasks.db` and copy an omarchy `colors.toml` file into it. The file name becomes the theme name:

```text
<application data>/
  tasks.db
  themes/
    my-theme.toml
```

Typical application-data locations are:

- Windows: `%APPDATA%\com.soleone.tasks\themes`
- Linux: `~/.local/share/com.soleone.tasks/themes`

A workspace file with the same name as a built-in overrides that built-in. The picker rereads the directory whenever it opens, so adding or removing a file does not require restarting the app.

A file can set only the palette slots it needs. Unset slots fall back to the neutral ramp for the file's `mode`:

```toml
mode = "dark"
accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#c0caf5"
```

Invalid files appear in the picker with a warning instead of breaking the rest of the theme list. Palette text roles are adjusted toward readability, while the author's accent is retained when it cannot meet the normal text contrast floor.

## Preview while developing

Run `pnpm dev:web` and open [the standalone palette viewer](http://127.0.0.1:5173/themes.html). It loads built-ins and workspace files from the dev backend and is preview-only; choosing a palette there does not change the app's stored theme.
