#[cfg(any(target_os = "linux", debug_assertions))]
use tauri::Manager;

/// Whether a path exists, so setup can tell a new task folder from an existing one.
#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Creates a task folder (and its parents) for a new or imported workspace.
#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![path_exists, create_folder])
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
