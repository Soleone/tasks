/**
 * The only source of truth for the product's user-facing name.
 *
 * User data lives in the Tasks home the owner chose, so renaming the product never moves it.
 * The native shell's identifier (`src-tauri/tauri.conf.json`) only locates the small pointer to
 * that home and the WebView's own storage; changing it means reconnecting the home once.
 */
export const APP_NAME = "Tasks";
