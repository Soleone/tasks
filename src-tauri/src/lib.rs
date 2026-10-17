#[cfg(target_os = "android")]
mod android_backend;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![path_exists, create_folder]);

    #[cfg(target_os = "android")]
    let builder = builder
        .manage(android_backend::Backends::default())
        .invoke_handler(tauri::generate_handler![
            path_exists,
            create_folder,
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
