#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMABUF renderer currently fails during startup on some
    // Wayland compositors, including the Omarchy desktop. Set this before
    // Tauri initializes the webview so packaged launches need no wrapper or
    // environment variable.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tasks_lib::run();
}
