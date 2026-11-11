//! File access for the backend on iOS. An app there can't start another program, so the backend
//! runs in a worker of the page and reaches the Tasks home through the `tasksfs` scheme, one
//! blocking request per file call. A request is a JSON line naming the call, then the bytes to
//! write. Paths are absolute inside the app's Documents folder, the only place the Files app and
//! a sync app can reach, so the home keeps its path when iOS moves the app's container.

use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Error, ErrorKind, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

/// Node's name for a failure, which the backend reports and sometimes branches on.
fn code(error: &Error) -> &'static str {
    match error.kind() {
        ErrorKind::NotFound => "ENOENT",
        ErrorKind::AlreadyExists => "EEXIST",
        ErrorKind::PermissionDenied => "EACCES",
        ErrorKind::InvalidInput => "EINVAL",
        _ => "EIO",
    }
}

fn real(root: &Path, path: &str) -> Result<PathBuf, Error> {
    let inside = Path::new(path.trim_start_matches('/'));
    if inside
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "path leaves the app's documents",
        ));
    }
    Ok(root.join(inside))
}

fn stat(path: &Path, follow: bool) -> Result<Value, Error> {
    let found = if follow {
        fs::metadata(path)?
    } else {
        fs::symlink_metadata(path)?
    };
    let kind = found.file_type();
    let nanoseconds =
        |seconds: i64, rest: i64| (seconds as i128 * 1_000_000_000 + rest as i128).to_string();
    // Strings, because JSON numbers can't hold 64 bits.
    Ok(json!({
        "kind": if kind.is_file() { "file" } else if kind.is_dir() { "directory" } else if kind.is_symlink() { "link" } else { "other" },
        "dev": found.dev().to_string(),
        "ino": found.ino().to_string(),
        "size": found.size().to_string(),
        "mtimeNs": nanoseconds(found.mtime(), found.mtime_nsec()),
        "ctimeNs": nanoseconds(found.ctime(), found.ctime_nsec()),
    }))
}

fn call(root: &Path, request: &Value, bytes: &[u8]) -> Result<Vec<u8>, Error> {
    let text = |name: &str| {
        request[name]
            .as_str()
            .ok_or_else(|| Error::new(ErrorKind::InvalidInput, format!("missing {name}")))
    };
    let flag = |name: &str| request[name].as_bool().unwrap_or(false);
    let path = real(root, text("path")?)?;
    let reply = |value: Value| Ok(value.to_string().into_bytes());
    match text("call")? {
        "stat" => reply(stat(&path, flag("follow"))?),
        "list" => {
            let mut names = Vec::new();
            for entry in fs::read_dir(&path)? {
                names.push(entry?.file_name().to_string_lossy().into_owned());
            }
            reply(json!(names))
        }
        "read" => fs::read(&path),
        // Replaces the bytes in place: the cache is recognized by its file, so it must stay one.
        "write" => {
            let mut options = OpenOptions::new();
            options.write(true);
            if flag("exclusive") {
                options.create_new(true);
            } else {
                options.create(true).truncate(true);
            }
            let mut file = options.open(&path)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            Ok(Vec::new())
        }
        "append" => {
            OpenOptions::new()
                .append(true)
                .open(&path)?
                .write_all(bytes)?;
            Ok(Vec::new())
        }
        "sync" => File::open(&path)?.sync_all().map(|()| Vec::new()),
        "mkdir" => fs::create_dir(&path).map(|()| Vec::new()),
        "rename" => fs::rename(&path, real(root, text("to")?)?).map(|()| Vec::new()),
        "remove" => fs::remove_file(&path).map(|()| Vec::new()),
        "realpath" => {
            let resolved = fs::canonicalize(&path)?;
            let inside = resolved.strip_prefix(root).map_err(|_| {
                Error::new(ErrorKind::InvalidInput, "path leaves the app's documents")
            })?;
            reply(json!(Path::new("/").join(inside)))
        }
        other => Err(Error::new(
            ErrorKind::InvalidInput,
            format!("unknown call {other}"),
        )),
    }
}

/// Answers one request: the status, then the result or `{code, message}`.
pub fn serve(documents: &Path, body: &[u8]) -> (u16, Vec<u8>) {
    let line = body
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(body.len());
    // iOS reaches the folder through a link, and resolved paths are compared with it.
    let result = fs::canonicalize(documents).and_then(|root| {
        let request = serde_json::from_slice::<Value>(&body[..line])
            .map_err(|error| Error::new(ErrorKind::InvalidInput, error))?;
        call(&root, &request, body.get(line + 1..).unwrap_or_default())
    });
    match result {
        Ok(bytes) => (200, bytes),
        Err(error) => (
            400,
            json!({ "code": code(&error), "message": error.to_string() })
                .to_string()
                .into_bytes(),
        ),
    }
}
