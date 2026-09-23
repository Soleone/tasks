use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime, State,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeDirectorySelection {
    uri: Option<String>,
    display_name: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidCanonicalFile {
    pub relative_path: String,
    pub content: String,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidCanonicalWriteFile {
    pub relative_path: String,
    pub content: Option<String>,
    pub previous_content: Option<String>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCanonicalFiles {
    selected: bool,
    files: Vec<AndroidCanonicalFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDirectorySelection {
    pub uri: String,
    pub display_name: Option<String>,
    pub path: Option<String>,
}

impl NativeDirectorySelection {
    fn into_selection(self) -> Result<Option<AndroidDirectorySelection>, String> {
        let Some(uri) = self.uri else {
            return Ok(None);
        };
        if uri.trim().is_empty() {
            return Err("Android returned an empty directory URI".to_string());
        }
        Ok(Some(AndroidDirectorySelection {
            uri,
            display_name: self.display_name,
            path: self.path,
        }))
    }
}

pub struct AndroidWorkspacePluginState<R: Runtime> {
    plugin: PluginHandle<R>,
}

fn plugin_error(error: impl std::fmt::Display) -> String {
    format!("ANDROID_WORKSPACE: {error}")
}

#[tauri::command]
pub async fn pick_sync_folder(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
) -> Result<AndroidDirectorySelection, String> {
    let response: NativeDirectorySelection = state
        .plugin
        .run_mobile_plugin_async("pickDirectory", json!({}))
        .await
        .map_err(plugin_error)?;
    response
        .into_selection()?
        .ok_or_else(|| "Android did not return a directory URI".to_string())
}

#[tauri::command]
pub async fn get_sync_folder(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
) -> Result<Option<AndroidDirectorySelection>, String> {
    let response: NativeDirectorySelection = state
        .plugin
        .run_mobile_plugin_async("getPersistedDirectory", json!({}))
        .await
        .map_err(plugin_error)?;
    response.into_selection()
}

#[tauri::command]
pub async fn clear_sync_folder(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
) -> Result<(), String> {
    state
        .plugin
        .run_mobile_plugin_async::<serde_json::Value>("clearDirectory", json!({}))
        .await
        .map_err(plugin_error)?;
    Ok(())
}

#[tauri::command]
pub async fn export_task_document(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
    content: String,
    suggested_name: String,
) -> Result<serde_json::Value, String> {
    state
        .plugin
        .run_mobile_plugin_async(
            "exportTaskDocument",
            json!({ "content": content, "suggestedName": suggested_name }),
        )
        .await
        .map_err(plugin_error)
}

#[tauri::command]
pub async fn read_sync_files(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
) -> Result<NativeCanonicalFiles, String> {
    state
        .plugin
        .run_mobile_plugin_async("readCanonicalFiles", json!({}))
        .await
        .map_err(plugin_error)
}

#[tauri::command]
pub async fn write_sync_files(
    state: State<'_, AndroidWorkspacePluginState<tauri::Wry>>,
    files: Vec<AndroidCanonicalWriteFile>,
) -> Result<serde_json::Value, String> {
    state
        .plugin
        .run_mobile_plugin_async("writeCanonicalFiles", json!({ "files": files }))
        .await
        .map_err(plugin_error)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-workspace")
        .setup(|app, api| {
            let plugin = api
                .register_android_plugin("com.soleone.tasks", "AndroidWorkspacePlugin")
                .map_err(|error| error.to_string())?;
            app.manage(AndroidWorkspacePluginState { plugin });
            Ok(())
        })
        .build()
}
