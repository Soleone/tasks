//! Runs the Node backend on Android, where Tauri sidecars don't exist. The backend ships as
//! `libtasks_backend.so` next to this library, because Android only executes files from the
//! app's native library folder.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum BackendEvent {
    Stdout(String),
    Error(String),
    Close { code: Option<i32> },
}

struct Backend {
    child: Child,
    stdin: ChildStdin,
}

/// The running backend processes, by process ID.
#[derive(Default)]
pub struct Backends(Arc<Mutex<HashMap<u32, Backend>>>);

/// The folder Android extracted this library to, found by asking the loader where it came from.
fn native_library_dir() -> Result<PathBuf, String> {
    let mut info: libc::Dl_info = unsafe { std::mem::zeroed() };
    let found = unsafe { libc::dladdr(native_library_dir as *const libc::c_void, &mut info) };
    if found == 0 || info.dli_fname.is_null() {
        return Err("Could not find the app's native library folder.".into());
    }
    let library = unsafe { std::ffi::CStr::from_ptr(info.dli_fname) };
    PathBuf::from(library.to_string_lossy().into_owned())
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find the app's native library folder.".into())
}

fn spawn(app: &AppHandle, root: &str, database: &str) -> Result<Child, String> {
    let paths = app.path();
    let data = paths.app_data_dir().map_err(|error| error.to_string())?;
    let temp = paths.app_cache_dir().map_err(|error| error.to_string())?;
    for directory in [&data, &temp] {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Command::new(native_library_dir()?.join("libtasks_backend.so"))
        .args(["--stdio", "--root", root, "--database", database])
        .env("HOME", &data)
        .env("XDG_DATA_HOME", &data)
        .env("TMPDIR", &temp)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the backend: {error}"))
}

/// Starts a backend for one task folder and streams its output as whole lines.
#[tauri::command]
pub fn backend_start(
    app: AppHandle,
    backends: State<Backends>,
    root: String,
    database: String,
    events: Channel<BackendEvent>,
) -> Result<u32, String> {
    if root.trim().is_empty() || database.trim().is_empty() {
        return Err("The backend needs a task folder and a cache path.".into());
    }
    let mut child = spawn(&app, &root, &database)?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("The backend has no input.")?;
    let stdout = child.stdout.take().ok_or("The backend has no output.")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("The backend has no error output.")?;
    backends
        .0
        .lock()
        .unwrap()
        .insert(pid, Backend { child, stdin });

    // The backend writes to stderr only when it fails, so its message is reported when it exits.
    let errors = std::thread::spawn(move || {
        let mut message = String::new();
        let _ = stderr.read_to_string(&mut message);
        message
    });
    let running = Arc::clone(&backends.0);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let event = match String::from_utf8(line.clone()) {
                        Ok(text) => BackendEvent::Stdout(text),
                        Err(_) => BackendEvent::Error("The backend wrote invalid UTF-8.".into()),
                    };
                    let _ = events.send(event);
                }
                Err(error) => {
                    let _ = events.send(BackendEvent::Error(error.to_string()));
                    break;
                }
            }
        }
        let message = errors.join().unwrap_or_default();
        if !message.trim().is_empty() {
            let _ = events.send(BackendEvent::Error(message.trim().to_string()));
        }
        let exited = running.lock().unwrap().remove(&pid);
        let code = exited.and_then(|mut backend| backend.child.wait().ok()?.code());
        let _ = events.send(BackendEvent::Close { code });
    });
    Ok(pid)
}

#[tauri::command]
pub fn backend_write(backends: State<Backends>, pid: u32, data: String) -> Result<(), String> {
    let mut running = backends.0.lock().unwrap();
    let backend = running.get_mut(&pid).ok_or("The backend is not running.")?;
    backend
        .stdin
        .write_all(data.as_bytes())
        .and_then(|()| backend.stdin.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn backend_kill(backends: State<Backends>, pid: u32) -> Result<(), String> {
    if let Some(mut backend) = backends.0.lock().unwrap().remove(&pid) {
        let _ = backend.child.kill();
        let _ = backend.child.wait();
    }
    Ok(())
}
