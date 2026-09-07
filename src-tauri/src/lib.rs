use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.get_webview_window("main")
                    .expect("main window should exist")
                    .open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tasks");
}
