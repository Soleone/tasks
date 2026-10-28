use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, State, Wry,
};

pub struct Images(PluginHandle<Wry>);

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("images")
        .setup(|app, api| {
            app.manage(Images(api.register_android_plugin(
                "com.soleone.tasks",
                "ImageAttachmentsPlugin",
            )?));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn image_pick(images: State<'_, Images>) -> Result<serde_json::Value, String> {
    images
        .0
        .run_mobile_plugin_async("pickImage", serde_json::json!({}))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn image_share(images: State<'_, Images>, data_url: String) -> Result<(), String> {
    images
        .0
        .run_mobile_plugin_async::<serde_json::Value>(
            "shareImage",
            serde_json::json!({ "dataUrl": data_url }),
        )
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}
