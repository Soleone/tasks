//! Global hotkeys: one brings Tasks forward from any app, the other also opens the New task
//! editor. Hyprland keeps global keys for its own binds, so there the binds launch Tasks again and
//! the running window takes over the launch (`--new-task` for the editor).

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn hyprland() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
}

/// Brings the window forward; `create` also tells the page to open the New task editor.
pub fn bring_forward(app: &AppHandle, create: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // Hyprland ignores an app asking for focus by default, but obeys its own dispatcher.
    if hyprland() {
        let _ = std::process::Command::new("hyprctl")
            .args([
                "dispatch",
                "focuswindow",
                &format!("pid:{}", std::process::id()),
            ])
            .spawn();
    }
    if create {
        let _ = app.emit("new-task", ());
    }
}

/// A second launch, from a Hyprland bind or the app menu, hands over to this window.
pub fn second_launch(app: &AppHandle, args: Vec<String>, _cwd: String) {
    bring_forward(app, args.iter().any(|arg| arg == "--new-task"));
}

/// What Hyprland binds should run, or none when Tasks registers its own hotkeys.
#[tauri::command]
pub fn hyprland_launcher() -> Option<String> {
    if !hyprland() {
        return None;
    }
    std::env::var("APPIMAGE").ok().or_else(|| {
        std::env::current_exe()
            .ok()
            .map(|exe| exe.display().to_string())
    })
}

/// Replaces the registered hotkeys; a missing one is off.
#[tauri::command]
pub fn global_hotkeys_set(
    app: AppHandle,
    focus: Option<String>,
    create: Option<String>,
) -> Result<(), String> {
    let hotkeys = app.global_shortcut();
    hotkeys
        .unregister_all()
        .map_err(|error| error.to_string())?;
    for (hotkey, opens_editor) in [(focus, false), (create, true)] {
        let Some(hotkey) = hotkey else { continue };
        hotkeys
            .on_shortcut(hotkey.as_str(), move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    bring_forward(app, opens_editor);
                }
            })
            .map_err(|_| hotkey)?;
    }
    Ok(())
}
