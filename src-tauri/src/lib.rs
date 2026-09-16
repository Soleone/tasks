#[cfg(any(debug_assertions, target_os = "linux"))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            app.get_webview_window("main")
                .expect("main window should exist")
                .set_decorations(false)?;

            #[cfg(debug_assertions)]
            app.get_webview_window("main")
                .expect("main window should exist")
                .open_devtools();

            #[cfg(not(debug_assertions))]
            let _ = app;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tasks");
}
