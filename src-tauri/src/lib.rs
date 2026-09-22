#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use tauri::Manager;

// The SQLite bridge is platform-neutral; run its storage tests on the host too.
#[cfg(any(target_os = "android", test))]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
mod android_backend;
#[cfg(target_os = "android")]
mod android_workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android_workspace::init())
        .manage(android_backend::AndroidStorageState::default())
        .invoke_handler(tauri::generate_handler![
            android_backend::android_storage,
            android_workspace::pick_sync_folder,
            android_workspace::get_sync_folder,
            android_workspace::clear_sync_folder,
            android_workspace::export_task_document,
            android_workspace::read_sync_files,
            android_workspace::write_sync_files,
        ]);

    builder
        .setup(|app| {
            #[cfg(target_os = "android")]
            let _ = app;

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
