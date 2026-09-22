#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            #[cfg(target_os = "linux")]
            app.get_webview_window("main")
                .expect("main window should exist")
                .set_decorations(false)?;

            #[cfg(all(
                debug_assertions,
                any(target_os = "windows", target_os = "macos", target_os = "linux")
            ))]
            app.get_webview_window("main")
                .expect("main window should exist")
                .open_devtools();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tasks");
}
