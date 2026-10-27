//! Puts the AppImage in the app menu. An AppImage is one file kept anywhere, so every start points
//! the menu entry at the file it runs from; updates replace that file in place.

use std::path::{Path, PathBuf};

// Named after the identifier, which is also the window's app id, so Wayland docks match it.
const ID: &str = "com.soleone.tasks";
const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// Writes the menu entry and its icon when the app runs as an AppImage; other builds have none.
pub fn register() {
    let (Some(appimage), Some(data)) = (std::env::var_os("APPIMAGE"), data_home()) else {
        return;
    };
    // A missing menu entry isn't worth failing the start over.
    let _ = write(Path::new(&appimage), &data);
}

fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|data| !data.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

fn write(appimage: &Path, data: &Path) -> std::io::Result<()> {
    let Some(exec) = appimage.to_str() else {
        return Ok(());
    };
    // Characters the desktop entry format would need escaped twice; such paths get no entry.
    if exec.contains(['"', '`', '$', '\\', '%', '\n']) {
        return Ok(());
    }
    let icon = data.join("icons").join(format!("{ID}.png"));
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Tasks\nComment=Keep track of your tasks\n\
         Exec=\"{exec}\"\nIcon={}\nTerminal=false\nCategories=Office;\n",
        icon.display()
    );
    write_if_changed(&icon, ICON)?;
    write_if_changed(
        &data.join("applications").join(format!("{ID}.desktop")),
        entry.as_bytes(),
    )
}

/// Leaves an unchanged file alone, so the app menu isn't asked to rescan on every start.
fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if std::fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(path, bytes)
}
