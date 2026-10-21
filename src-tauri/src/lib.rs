#[cfg(target_os = "android")]
mod android_backend;

use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The one file Tasks keeps in the app's own storage: which Tasks home to open.
fn pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(config.join("home.json"))
}

/// The remembered Tasks home, or none on a first launch.
#[tauri::command]
fn home_pointer_read(app: AppHandle) -> Result<Option<String>, String> {
    let path = pointer_path(&app)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read {}: {error}", path.display())),
    };
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| format!("{} is damaged; choose the Tasks home again.", path.display()))?;
    match value.get("home").and_then(|home| home.as_str()) {
        Some(home) if !home.trim().is_empty() => Ok(Some(home.to_string())),
        _ => Err(format!("{} is damaged; choose the Tasks home again.", path.display())),
    }
}

/// Remembers the Tasks home, replacing the pointer whole so a crash never leaves half of it.
#[tauri::command]
fn home_pointer_write(app: AppHandle, home: String) -> Result<(), String> {
    let path = pointer_path(&app)?;
    let folder = path.parent().ok_or("The app has no config folder.")?;
    std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    let stage = folder.join("home.json.preparing");
    let bytes = serde_json::to_vec(&serde_json::json!({ "home": home }))
        .map_err(|error| error.to_string())?;
    let mut file = std::fs::File::create(&stage).map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);
    std::fs::rename(&stage, &path).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![home_pointer_read, home_pointer_write]);

    #[cfg(target_os = "android")]
    let builder = builder
        .manage(android_backend::Backends::default())
        .invoke_handler(tauri::generate_handler![
            home_pointer_read,
            home_pointer_write,
            android_backend::backend_start,
            android_backend::backend_write,
            android_backend::backend_kill,
        ]);

    builder
        .setup(|app| {
            #[cfg(target_os = "linux")]
            app.get_webview_window("main")
                .expect("main window should exist")
                .set_decorations(false)?;

            #[cfg(debug_assertions)]
            app.get_webview_window("main")
                .expect("main window should exist")
                .open_devtools();

            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tasks");
}
