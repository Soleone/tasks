use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

const TRANSACTION_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct AndroidStorageState {
    connection: Mutex<Option<Connection>>,
    transaction: Mutex<Option<ActiveTransaction>>,
}

struct ActiveTransaction {
    id: String,
    started_at: Instant,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AndroidStorageRequest {
    Probe,
    Begin {
        transaction_id: String,
    },
    Run {
        transaction_id: String,
        statement: FixedStatement,
        #[serde(default)]
        values: Vec<StorageValue>,
    },
    All {
        statement: FixedStatement,
    },
    ReadSnapshot,
    ReadReceipt {
        idempotency_key: String,
    },
    ReadCanonicalMeta,
    ReadTheme,
    SetTheme {
        name: String,
    },
    ReadOperation,
    WriteOperation {
        transaction_id: String,
        record: Value,
    },
    ClearOperation {
        transaction_id: String,
        operation_id: String,
    },
    SetSiblingOrder {
        transaction_id: String,
        parent_id: Option<String>,
        task_ids: Vec<String>,
    },
    DeleteTask {
        transaction_id: String,
        id: String,
        expected_version: i64,
    },
    PurgeCanceledTasks {
        transaction_id: String,
        now: String,
    },
    ReadPendingWrite,
    StageCanonicalWrite {
        pending: AndroidPendingWrite,
    },
    CompletePendingWrite {
        operation_id: String,
    },
    ReplaceCanonicalWorkspace {
        workspace_id: String,
        fingerprint: String,
        tasks: Vec<AndroidImportedTask>,
        #[serde(default)]
        receive: bool,
    },
    ReadWorkspaceBackup,
    RestoreWorkspaceBackup {
        backup: Value,
    },
    ReadReceiveMarker,
    WriteReceiveMarker {
        marker: Value,
    },
    ClearReceiveMarker,
    EnsureCategory {
        transaction_id: String,
        id: String,
        slug: String,
        label: String,
        now: String,
    },
    EnsureTag {
        transaction_id: String,
        id: String,
        slug: String,
        label: String,
        now: String,
    },
    ShiftSiblingPositions {
        transaction_id: String,
        parent_id: Option<String>,
    },
    InsertTask {
        transaction_id: String,
        task: AndroidTaskInput,
    },
    UpdateTask {
        transaction_id: String,
        task: AndroidTaskInput,
        expected_version: i64,
        tag_ids: Vec<String>,
        dependency_ids: Vec<String>,
    },
    ReorderTasks {
        transaction_id: String,
        parent_id: Option<String>,
        task_ids: Vec<String>,
        selected: Vec<AndroidReorderSelection>,
    },
    InsertTaskTag {
        transaction_id: String,
        task_id: String,
        tag_id: String,
    },
    InsertActivity {
        transaction_id: String,
        task_id: String,
        request_id: String,
        action: String,
        actor_kind: String,
        actor_label: String,
        created_at: String,
        details_json: String,
    },
    WriteReceipt {
        transaction_id: String,
        idempotency_key: String,
        command: String,
        request_hash: String,
        response_json: String,
        created_at: String,
    },
    Commit {
        transaction_id: String,
    },
    Rollback {
        transaction_id: String,
    },
    Close {
        transaction_id: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPendingFile {
    relative_path: String,
    previous_content: Option<String>,
    content: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPendingWrite {
    operation_id: String,
    workspace_id: String,
    folder_uri: String,
    files: Vec<AndroidPendingFile>,
    idempotency_key: String,
    request_hash: String,
    response_json: String,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidImportedClassification {
    pub slug: String,
    pub label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidImportedTask {
    pub id: String,
    pub title: String,
    pub description_markdown: String,
    pub status: String,
    pub priority: i64,
    pub category: Option<AndroidImportedClassification>,
    pub tags: Vec<AndroidImportedClassification>,
    pub parent_id: Option<String>,
    pub dependency_ids: Vec<String>,
    pub position: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub canceled_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidReorderSelection {
    id: String,
    expected_version: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidTaskInput {
    pub id: String,
    pub title: String,
    pub description_markdown: String,
    pub status: String,
    pub category_id: Option<String>,
    pub parent_id: Option<String>,
    pub position: i64,
    pub priority: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub canceled_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupClassification {
    id: String,
    slug: String,
    label: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupTask {
    id: String,
    title: String,
    description_markdown: String,
    status: String,
    category_id: Option<String>,
    parent_id: Option<String>,
    position: i64,
    priority: i64,
    version: i64,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    canceled_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupTaskLink {
    task_id: String,
    tag_id: Option<String>,
    depends_on_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupActivity {
    seq: i64,
    task_id: String,
    request_id: String,
    action: String,
    actor_kind: String,
    actor_label: String,
    created_at: String,
    details_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupReceipt {
    idempotency_key: String,
    command: String,
    request_hash: String,
    response_json: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceBackup {
    workspace_id: Option<String>,
    fingerprint: Option<String>,
    workspace_revision: i64,
    categories: Vec<BackupClassification>,
    tags: Vec<BackupClassification>,
    tasks: Vec<BackupTask>,
    #[serde(default)]
    task_tags: Vec<BackupTaskLink>,
    #[serde(default)]
    task_dependencies: Vec<BackupTaskLink>,
    #[serde(default)]
    activity: Vec<BackupActivity>,
    #[serde(default)]
    command_receipts: Vec<BackupReceipt>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidClassification {
    slug: String,
    label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidTaskRecord {
    id: String,
    title: String,
    description_markdown: String,
    status: String,
    priority: i64,
    category: Option<AndroidClassification>,
    tags: Vec<AndroidClassification>,
    parent_id: Option<String>,
    dependency_ids: Vec<String>,
    blocked_by_ids: Vec<String>,
    version: i64,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    canceled_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FixedStatement {
    #[serde(rename = "probe.reset")]
    ProbeReset,
    #[serde(rename = "probe.insert")]
    ProbeInsert,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum StorageValue {
    Text(String),
}

fn storage_error(error: impl std::fmt::Display) -> String {
    format!("ANDROID_STORAGE: {error}")
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(storage_error)?;
    fs::create_dir_all(&directory).map_err(storage_error)?;
    Ok(directory.join("tasks.db"))
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 1000;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                description_markdown TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'paused', 'done', 'canceled')),
                category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                position INTEGER NOT NULL,
                priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (0, 1, 2, 3, 4)),
                version INTEGER NOT NULL CHECK (version > 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                canceled_at TEXT
            );
            CREATE TABLE IF NOT EXISTS task_dependencies (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, depends_on_id),
                CHECK (task_id != depends_on_id)
            );
            CREATE TABLE IF NOT EXISTS task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS activity (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                request_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor_kind TEXT NOT NULL,
                actor_label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                details_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS command_receipts (
                idempotency_key TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cache_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT INTO cache_meta (key, value) VALUES ('workspace_revision', '0')
                ON CONFLICT(key) DO NOTHING;
            CREATE INDEX IF NOT EXISTS tasks_updated_at_idx ON tasks (updated_at DESC, id ASC);
            CREATE INDEX IF NOT EXISTS tasks_parent_position_idx ON tasks (parent_id, position, id);
            CREATE VIRTUAL TABLE IF NOT EXISTS android_bridge_probe_fts USING fts5(value);
            CREATE TABLE IF NOT EXISTS android_bridge_probe (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                value TEXT NOT NULL
            );
            ",
        )
        .map_err(storage_error)
}

fn connection<'a>(
    app: &AppHandle,
    state: &'a AndroidStorageState,
) -> Result<std::sync::MutexGuard<'a, Option<Connection>>, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| storage_error("connection lock poisoned"))?;
    if guard.is_none() {
        let path = database_path(app)?;
        let opened = Connection::open(path).map_err(storage_error)?;
        ensure_schema(&opened)?;
        *guard = Some(opened);
    }
    Ok(guard)
}

fn expire_transaction(
    transaction: &mut Option<ActiveTransaction>,
    connection: &Connection,
) -> Result<(), String> {
    let timed_out = transaction
        .as_ref()
        .is_some_and(|active| active.started_at.elapsed() > TRANSACTION_TIMEOUT);
    if timed_out {
        connection
            .execute_batch("ROLLBACK")
            .map_err(storage_error)?;
        *transaction = None;
    }
    Ok(())
}

fn active_transaction(
    transaction: &mut Option<ActiveTransaction>,
    connection: &Connection,
    transaction_id: &str,
) -> Result<(), String> {
    let Some(active) = transaction.as_ref() else {
        return Err(storage_error("no active transaction"));
    };
    let timed_out = active.started_at.elapsed() > TRANSACTION_TIMEOUT;
    let owns_transaction = active.id == transaction_id;
    if timed_out {
        connection
            .execute_batch("ROLLBACK")
            .map_err(storage_error)?;
        *transaction = None;
        return Err(storage_error("transaction timed out and was rolled back"));
    }
    if !owns_transaction {
        return Err(storage_error(
            "transaction handle does not own the active transaction",
        ));
    }
    Ok(())
}

fn text_value(values: &[StorageValue], index: usize, field: &str) -> Result<String, String> {
    match values.get(index) {
        Some(StorageValue::Text(value)) if !value.is_empty() => Ok(value.clone()),
        _ => Err(storage_error(format!(
            "{field} must be a non-empty text value"
        ))),
    }
}

fn probe_result(app: &AppHandle, connection: &Connection) -> Result<Value, String> {
    connection
        .execute_batch(
            "
            DELETE FROM android_bridge_probe;
            DELETE FROM android_bridge_probe_fts;
            INSERT INTO android_bridge_probe (id, value) VALUES (1, 'capture a task');
            INSERT INTO android_bridge_probe_fts (value) VALUES ('capture a task');
            ",
        )
        .map_err(storage_error)?;
    let search_matches: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM android_bridge_probe_fts WHERE android_bridge_probe_fts MATCH 'task'",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    let probe_value: String = connection
        .query_row(
            "SELECT value FROM android_bridge_probe WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .map_err(storage_error)?;
    let journal_mode: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .map_err(storage_error)?;
    let foreign_keys: i64 = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(storage_error)?;
    let database_path = database_path(app)?.display().to_string();

    Ok(json!({
        "databasePath": database_path,
        "nodeVersion": "android-native",
        "sqliteVersion": sqlite_version,
        "journalMode": journal_mode,
        "foreignKeysEnabled": foreign_keys == 1,
        "fts5Enabled": true,
        "searchMatches": search_matches,
        "probeValue": probe_value,
    }))
}

fn fixed_run(
    connection: &Connection,
    statement: FixedStatement,
    values: &[StorageValue],
) -> Result<Value, String> {
    let changes = match statement {
        FixedStatement::ProbeReset => {
            if !values.is_empty() {
                return Err(storage_error("probe.reset does not accept values"));
            }
            connection
                .execute_batch(
                    "DELETE FROM android_bridge_probe; DELETE FROM android_bridge_probe_fts;",
                )
                .map_err(storage_error)?;
            0
        }
        FixedStatement::ProbeInsert => {
            let value = text_value(values, 0, "probe.insert value")?;
            if values.len() != 1 {
                return Err(storage_error("probe.insert accepts exactly one value"));
            }
            connection
                .execute(
                    "INSERT INTO android_bridge_probe (id, value) VALUES (1, ?1)",
                    params![value],
                )
                .map_err(storage_error)?;
            connection
                .execute(
                    "INSERT INTO android_bridge_probe_fts (value) VALUES (?1)",
                    params![value],
                )
                .map_err(storage_error)?;
            1
        }
    };
    Ok(json!({ "changes": changes }))
}

fn read_snapshot(connection: &Connection) -> Result<Value, String> {
    let mut task_statement = connection
        .prepare(
            "SELECT tasks.id, tasks.title, tasks.description_markdown, tasks.status,
                    tasks.priority, categories.slug, categories.label, tasks.parent_id,
                    tasks.version, tasks.created_at, tasks.updated_at,
                    tasks.completed_at, tasks.canceled_at
             FROM tasks
             LEFT JOIN categories ON categories.id = tasks.category_id
             ORDER BY tasks.position ASC, tasks.id ASC",
        )
        .map_err(storage_error)?;
    let task_rows = task_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(storage_error)?;

    let mut tasks = Vec::new();
    for row in task_rows {
        let (
            id,
            title,
            description_markdown,
            status,
            priority,
            category_slug,
            category_label,
            parent_id,
            version,
            created_at,
            updated_at,
            completed_at,
            canceled_at,
        ) = row.map_err(storage_error)?;

        let mut tag_statement = connection
            .prepare(
                "SELECT tags.slug, tags.label
                 FROM task_tags
                 JOIN tags ON tags.id = task_tags.tag_id
                 WHERE task_tags.task_id = ?1
                 ORDER BY tags.slug ASC",
            )
            .map_err(storage_error)?;
        let tags = tag_statement
            .query_map(params![id], |tag| {
                Ok(AndroidClassification {
                    slug: tag.get(0)?,
                    label: tag.get(1)?,
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;

        let mut dependency_statement = connection
            .prepare(
                "SELECT task_dependencies.depends_on_id, dependencies.status
                 FROM task_dependencies
                 JOIN tasks AS dependencies ON dependencies.id = task_dependencies.depends_on_id
                 WHERE task_dependencies.task_id = ?1
                 ORDER BY task_dependencies.depends_on_id ASC",
            )
            .map_err(storage_error)?;
        let dependencies = dependency_statement
            .query_map(params![id], |dependency| {
                Ok((
                    dependency.get::<_, String>(0)?,
                    dependency.get::<_, String>(1)?,
                ))
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let dependency_ids = dependencies
            .iter()
            .map(|(dependency_id, _)| dependency_id.clone())
            .collect::<Vec<_>>();
        let blocked_by_ids = dependencies
            .iter()
            .filter(|(_, dependency_status)| dependency_status != "canceled")
            .map(|(dependency_id, _)| dependency_id.clone())
            .collect::<Vec<_>>();

        tasks.push(AndroidTaskRecord {
            id,
            title,
            description_markdown,
            status,
            priority,
            category: category_slug.map(|slug| AndroidClassification {
                slug,
                label: category_label.unwrap_or_default(),
            }),
            tags,
            parent_id,
            dependency_ids,
            blocked_by_ids,
            version,
            created_at,
            updated_at,
            completed_at,
            canceled_at,
        });
    }

    let workspace_revision: i64 = connection
        .query_row(
            "SELECT value FROM cache_meta WHERE key = 'workspace_revision'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(storage_error)?
        .parse()
        .map_err(storage_error)?;

    Ok(json!({
        "tasks": tasks,
        "workspaceRevision": workspace_revision,
    }))
}

fn cache_meta_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM cache_meta WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage_error)
}

fn read_operation(connection: &Connection) -> Result<Option<Value>, String> {
    cache_meta_value(connection, "android_latest_operation")?
        .map(|value| serde_json::from_str(&value).map_err(storage_error))
        .transpose()
}

fn write_operation(connection: &Connection, record: &Value) -> Result<(), String> {
    if record.get("id").and_then(Value::as_str).unwrap_or("").is_empty() {
        return Err(storage_error("operation id is required"));
    }
    connection.execute(
        "INSERT INTO cache_meta (key, value) VALUES ('android_latest_operation', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(record).map_err(storage_error)?],
    ).map_err(storage_error)?;
    Ok(())
}

fn clear_operation(connection: &Connection, operation_id: &str) -> Result<(), String> {
    let value = read_operation(connection)?
        .ok_or_else(|| storage_error("operation is no longer available"))?;
    if value.get("id").and_then(Value::as_str) != Some(operation_id) {
        return Err(storage_error("operation is no longer available"));
    }
    connection.execute("DELETE FROM cache_meta WHERE key = 'android_latest_operation'", [])
        .map_err(storage_error)?;
    Ok(())
}

fn read_canonical_meta(connection: &Connection) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": cache_meta_value(connection, "workspace_id")?,
        "fingerprint": cache_meta_value(connection, "canonical_fingerprint")?,
        "cacheVersion": cache_meta_value(connection, "android_cache_version")?,
    }))
}

fn read_pending_write(connection: &Connection) -> Result<Option<AndroidPendingWrite>, String> {
    cache_meta_value(connection, "android_pending_write")?
        .map(|value| serde_json::from_str(&value).map_err(storage_error))
        .transpose()
}

fn stage_pending_write(
    connection: &Connection,
    pending: &AndroidPendingWrite,
) -> Result<Value, String> {
    if pending.operation_id.is_empty()
        || pending.workspace_id.is_empty()
        || pending.folder_uri.is_empty()
        || pending.idempotency_key.is_empty()
        || pending.request_hash.is_empty()
        || pending.files.is_empty()
        || pending
            .files
            .iter()
            .any(|file| file.relative_path.is_empty())
    {
        return Err(storage_error("pending Android write is incomplete"));
    }
    if read_pending_write(connection)?.is_some() {
        return Err(storage_error(
            "an Android file write is already pending recovery",
        ));
    }
    if cache_meta_value(connection, "workspace_id")?.as_deref()
        != Some(pending.workspace_id.as_str())
    {
        return Err(storage_error(
            "pending write belongs to a different workspace",
        ));
    }
    connection
        .execute(
            "INSERT INTO cache_meta (key, value) VALUES ('android_pending_write', ?1)",
            params![serde_json::to_string(pending).map_err(storage_error)?],
        )
        .map_err(storage_error)?;
    Ok(json!({ "staged": true }))
}

fn complete_pending_write(connection: &Connection, operation_id: &str) -> Result<Value, String> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(storage_error)?;
    let result = (|| {
        let pending = read_pending_write(connection)?
            .ok_or_else(|| storage_error("no Android file write is pending"))?;
        if pending.operation_id != operation_id
            || cache_meta_value(connection, "workspace_id")?.as_deref()
                != Some(pending.workspace_id.as_str())
        {
            return Err(storage_error(
                "pending write does not match the current workspace",
            ));
        }
        let existing: Option<String> = connection
            .query_row(
                "SELECT request_hash FROM command_receipts WHERE idempotency_key = ?1",
                params![pending.idempotency_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        if let Some(hash) = existing {
            if hash != pending.request_hash {
                return Err(storage_error(
                    "pending idempotency key has a different request hash",
                ));
            }
        } else {
            write_receipt(
                connection,
                &pending.idempotency_key,
                "task.create",
                &pending.request_hash,
                &pending.response_json,
                &pending.created_at,
            )?;
        }
        connection
            .execute(
                "DELETE FROM cache_meta WHERE key = 'android_pending_write'",
                [],
            )
            .map_err(storage_error)?;
        Ok(json!({ "completed": true }))
    })();
    match result {
        Ok(value) => {
            connection.execute_batch("COMMIT").map_err(storage_error)?;
            Ok(value)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn classification_id(prefix: &str, slug: &str) -> String {
    format!("android:{prefix}:{slug}")
}

fn read_workspace_backup(connection: &Connection) -> Result<Value, String> {
    let workspace_id = cache_meta_value(connection, "workspace_id")?;
    let fingerprint = cache_meta_value(connection, "canonical_fingerprint")?;
    let workspace_revision: i64 = connection
        .query_row(
            "SELECT value FROM cache_meta WHERE key = 'workspace_revision'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(storage_error)?
        .parse()
        .map_err(storage_error)?;

    let classification_rows = |table: &str| -> Result<Vec<Value>, String> {
        let mut statement = connection
            .prepare(&format!(
                "SELECT id, slug, label, created_at, updated_at FROM {table} ORDER BY slug ASC"
            ))
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "slug": row.get::<_, String>(1)?,
                    "label": row.get::<_, String>(2)?,
                    "createdAt": row.get::<_, String>(3)?,
                    "updatedAt": row.get::<_, String>(4)?,
                }))
            })
            .map_err(storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    };
    let categories = classification_rows("categories")?;
    let tags = classification_rows("tags")?;

    let tasks: Vec<Value> = connection
        .prepare(
            "SELECT id, title, description_markdown, status, category_id, parent_id, position,
                    priority, version, created_at, updated_at, completed_at, canceled_at
             FROM tasks ORDER BY position ASC, id ASC",
        )
        .map_err(storage_error)?
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "descriptionMarkdown": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "categoryId": row.get::<_, Option<String>>(4)?,
                "parentId": row.get::<_, Option<String>>(5)?,
                "position": row.get::<_, i64>(6)?,
                "priority": row.get::<_, i64>(7)?,
                "version": row.get::<_, i64>(8)?,
                "createdAt": row.get::<_, String>(9)?,
                "updatedAt": row.get::<_, String>(10)?,
                "completedAt": row.get::<_, Option<String>>(11)?,
                "canceledAt": row.get::<_, Option<String>>(12)?,
            }))
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    let link_rows = |query: &str, field: &str| -> Result<Vec<Value>, String> {
        let mut statement = connection.prepare(query).map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                let mut record = serde_json::Map::new();
                record.insert("taskId".to_string(), json!(row.get::<_, String>(0)?));
                record.insert(field.to_string(), json!(row.get::<_, String>(1)?));
                Ok(Value::Object(record))
            })
            .map_err(storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    };
    let task_tags =
        link_rows("SELECT task_id, tag_id FROM task_tags ORDER BY task_id ASC, tag_id ASC", "tagId")?;
    let task_dependencies = link_rows(
        "SELECT task_id, depends_on_id FROM task_dependencies ORDER BY task_id ASC, depends_on_id ASC",
        "dependsOnId",
    )?;

    let activity: Vec<Value> = connection
        .prepare(
            "SELECT seq, task_id, request_id, action, actor_kind, actor_label, created_at, details_json
             FROM activity ORDER BY seq ASC",
        )
        .map_err(storage_error)?
        .query_map([], |row| {
            Ok(json!({
                "seq": row.get::<_, i64>(0)?,
                "taskId": row.get::<_, String>(1)?,
                "requestId": row.get::<_, String>(2)?,
                "action": row.get::<_, String>(3)?,
                "actorKind": row.get::<_, String>(4)?,
                "actorLabel": row.get::<_, String>(5)?,
                "createdAt": row.get::<_, String>(6)?,
                "detailsJson": row.get::<_, String>(7)?,
            }))
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    let command_receipts: Vec<Value> = connection
        .prepare(
            "SELECT idempotency_key, command, request_hash, response_json, created_at
             FROM command_receipts ORDER BY idempotency_key ASC",
        )
        .map_err(storage_error)?
        .query_map([], |row| {
            Ok(json!({
                "idempotencyKey": row.get::<_, String>(0)?,
                "command": row.get::<_, String>(1)?,
                "requestHash": row.get::<_, String>(2)?,
                "responseJson": row.get::<_, String>(3)?,
                "createdAt": row.get::<_, String>(4)?,
            }))
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(json!({
        "workspaceId": workspace_id,
        "fingerprint": fingerprint,
        "workspaceRevision": workspace_revision,
        "categories": categories,
        "tags": tags,
        "tasks": tasks,
        "taskTags": task_tags,
        "taskDependencies": task_dependencies,
        "activity": activity,
        "commandReceipts": command_receipts,
    }))
}

fn restore_workspace_backup(connection: &Connection, backup: &Value) -> Result<Value, String> {
    let backup: WorkspaceBackup = serde_json::from_value(backup.clone()).map_err(storage_error)?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(storage_error)?;
    let result = (|| {
        connection
            .execute_batch(
                "DELETE FROM task_dependencies;
                 DELETE FROM task_tags;
                 DELETE FROM tasks;
                 DELETE FROM categories;
                 DELETE FROM tags;
                 DELETE FROM activity;
                 DELETE FROM command_receipts;",
            )
            .map_err(storage_error)?;

        for row in &backup.categories {
            connection
                .execute(
                    "INSERT INTO categories (id, slug, label, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![row.id, row.slug, row.label, row.created_at, row.updated_at],
                )
                .map_err(storage_error)?;
        }
        for row in &backup.tags {
            connection
                .execute(
                    "INSERT INTO tags (id, slug, label, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![row.id, row.slug, row.label, row.created_at, row.updated_at],
                )
                .map_err(storage_error)?;
        }
        for row in &backup.tasks {
            connection
                .execute(
                    "INSERT INTO tasks
                     (id, title, description_markdown, status, category_id, parent_id, position,
                      priority, version, created_at, updated_at, completed_at, canceled_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        row.id, row.title, row.description_markdown, row.status, row.category_id,
                        row.parent_id, row.position, row.priority, row.version, row.created_at,
                        row.updated_at, row.completed_at, row.canceled_at,
                    ],
                )
                .map_err(storage_error)?;
        }
        for link in &backup.task_tags {
            let tag_id = link
                .tag_id
                .as_ref()
                .ok_or_else(|| storage_error("backup task tag is missing its tag id"))?;
            connection
                .execute(
                    "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                    params![link.task_id, tag_id],
                )
                .map_err(storage_error)?;
        }
        for link in &backup.task_dependencies {
            let depends_on_id = link
                .depends_on_id
                .as_ref()
                .ok_or_else(|| storage_error("backup dependency is missing its target id"))?;
            connection
                .execute(
                    "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?1, ?2)",
                    params![link.task_id, depends_on_id],
                )
                .map_err(storage_error)?;
        }
        for row in &backup.activity {
            connection
                .execute(
                    "INSERT INTO activity
                     (seq, task_id, request_id, action, actor_kind, actor_label, created_at, details_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![row.seq, row.task_id, row.request_id, row.action, row.actor_kind, row.actor_label, row.created_at, row.details_json],
                )
                .map_err(storage_error)?;
        }
        for row in &backup.command_receipts {
            connection
                .execute(
                    "INSERT INTO command_receipts
                     (idempotency_key, command, request_hash, response_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![row.idempotency_key, row.command, row.request_hash, row.response_json, row.created_at],
                )
                .map_err(storage_error)?;
        }

        for (key, value) in [
            ("workspace_id", backup.workspace_id.as_ref()),
            ("canonical_fingerprint", backup.fingerprint.as_ref()),
        ] {
            match value {
                Some(value) => connection
                    .execute(
                        "INSERT INTO cache_meta (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![key, value],
                    )
                    .map_err(storage_error)?,
                None => connection
                    .execute("DELETE FROM cache_meta WHERE key = ?1", params![key])
                    .map_err(storage_error)?,
            };
        }
        connection
            .execute(
                "INSERT INTO cache_meta (key, value) VALUES ('workspace_revision', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![backup.workspace_revision.to_string()],
            )
            .map_err(storage_error)?;
        Ok(())
    })();
    match result {
        Ok(()) => connection.execute_batch("COMMIT").map_err(storage_error)?,
        Err(error) => {
            connection.execute_batch("ROLLBACK").map_err(storage_error)?;
            return Err(error);
        }
    }
    let task_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .map_err(storage_error)?;
    Ok(json!({ "restored": true, "taskCount": task_count }))
}

fn read_receive_marker(connection: &Connection) -> Result<Option<Value>, String> {
    cache_meta_value(connection, "android_receive_workspace")?
        .map(|value| serde_json::from_str(&value).map_err(storage_error))
        .transpose()
}

fn write_receive_marker(connection: &Connection, marker: &Value) -> Result<(), String> {
    if marker.get("targetWorkspaceId").and_then(Value::as_str).unwrap_or("").is_empty() {
        return Err(storage_error("receive marker requires a target workspace id"));
    }
    connection
        .execute(
            "INSERT INTO cache_meta (key, value) VALUES ('android_receive_workspace', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(marker).map_err(storage_error)?],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn clear_receive_marker(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM cache_meta WHERE key = 'android_receive_workspace'", [])
        .map_err(storage_error)?;
    Ok(())
}

fn replace_canonical_workspace(
    connection: &Connection,
    workspace_id: &str,
    fingerprint: &str,
    tasks: &[AndroidImportedTask],
    receive: bool,
) -> Result<Value, String> {
    if workspace_id.trim().is_empty() || fingerprint.trim().is_empty() {
        return Err(storage_error(
            "canonical workspace metadata must not be empty",
        ));
    }

    if read_pending_write(connection)?.is_some() {
        return Err(storage_error(
            "recover the pending Android file write before importing",
        ));
    }
    let local_task_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .map_err(storage_error)?;
    if receive {
        let marker = read_receive_marker(connection)?
            .ok_or_else(|| storage_error("no receive marker for workspace adoption"))?;
        if marker.get("targetWorkspaceId").and_then(Value::as_str) != Some(workspace_id) {
            return Err(storage_error("receive marker does not match the target workspace"));
        }
    } else {
        match cache_meta_value(connection, "workspace_id")? {
            Some(current_id) if current_id != workspace_id => {
                return Err(storage_error(
                    "selected folder belongs to another workspace",
                ));
            }
            None if local_task_count > 0 => {
                return Err("LOCAL_TASKS_NOT_EMPTY: forget the sync folder to keep local tasks; importing another workspace would replace them".to_string());
            }
            _ => {}
        }
    }

    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(storage_error)?;
    let result = (|| {
        // Receipts survive a cache rebuild within the same workspace, including
        // the rebuild triggered by our own SAF write on the next request.
        // Otherwise a retry of a successful create would add a second task.
        if cache_meta_value(connection, "workspace_id")?.as_deref() != Some(workspace_id) {
            connection
                .execute_batch("DELETE FROM command_receipts; DELETE FROM cache_meta WHERE key = 'android_latest_operation';")
                .map_err(storage_error)?;
        }
        connection
            .execute_batch(
                "DELETE FROM task_dependencies;
                 DELETE FROM task_tags;
                 DELETE FROM tasks;
                 DELETE FROM categories;
                 DELETE FROM tags;
                 DELETE FROM activity;",
            )
            .map_err(storage_error)?;

        for task in tasks {
            if let Some(category) = &task.category {
                let id = classification_id("category", &category.slug);
                connection
                    .execute(
                        "INSERT INTO categories (id, slug, label, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?4)
                         ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at",
                        params![id, category.slug, category.label, task.updated_at],
                    )
                    .map_err(storage_error)?;
            }
            for tag in &task.tags {
                let id = classification_id("tag", &tag.slug);
                connection
                    .execute(
                        "INSERT INTO tags (id, slug, label, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?4)
                         ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at",
                        params![id, tag.slug, tag.label, task.updated_at],
                    )
                    .map_err(storage_error)?;
            }
        }

        for task in tasks {
            let category_id = task
                .category
                .as_ref()
                .map(|category| classification_id("category", &category.slug));
            connection
                .execute(
                    "INSERT INTO tasks
                     (id, title, description_markdown, status, category_id, parent_id, position,
                      priority, version, created_at, updated_at, completed_at, canceled_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        task.id,
                        task.title,
                        task.description_markdown,
                        task.status,
                        category_id,
                        task.parent_id,
                        task.position,
                        task.priority,
                        task.version,
                        task.created_at,
                        task.updated_at,
                        task.completed_at,
                        task.canceled_at,
                    ],
                )
                .map_err(storage_error)?;
        }

        for task in tasks {
            for dependency_id in &task.dependency_ids {
                connection
                    .execute(
                        "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?1, ?2)",
                        params![task.id, dependency_id],
                    )
                    .map_err(storage_error)?;
            }
            for tag in &task.tags {
                let tag_id = classification_id("tag", &tag.slug);
                connection
                    .execute(
                        "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                        params![task.id, tag_id],
                    )
                    .map_err(storage_error)?;
            }
        }

        let revision: i64 = connection
            .query_row(
                "SELECT value FROM cache_meta WHERE key = 'workspace_revision'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map_err(storage_error)?
            .parse::<i64>()
            .map_err(storage_error)?
            + 1;
        connection
            .execute(
                "INSERT INTO cache_meta (key, value) VALUES ('workspace_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![workspace_id],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "INSERT INTO cache_meta (key, value) VALUES ('canonical_fingerprint', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![fingerprint],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "UPDATE cache_meta SET value = ?1 WHERE key = 'workspace_revision'",
                params![revision.to_string()],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "INSERT INTO cache_meta (key, value) VALUES ('android_cache_version', '2')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [],
            )
            .map_err(storage_error)?;

        Ok(json!({
            "changed": true,
            "taskCount": tasks.len(),
            "workspaceRevision": revision,
        }))
    })();

    match result {
        Ok(value) => {
            connection.execute_batch("COMMIT").map_err(storage_error)?;
            Ok(value)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn read_receipt(connection: &Connection, idempotency_key: &str) -> Result<Value, String> {
    let receipt = connection
        .query_row(
            "SELECT request_hash, response_json FROM command_receipts WHERE idempotency_key = ?1",
            params![idempotency_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(storage_error)?;
    Ok(match receipt {
        Some((request_hash, response_json)) => json!({
            "receipt": { "requestHash": request_hash, "responseJson": response_json }
        }),
        None => json!({ "receipt": Value::Null }),
    })
}

fn ensure_classification(
    connection: &Connection,
    id: &str,
    slug: &str,
    label: &str,
    now: &str,
    table: &str,
) -> Result<Value, String> {
    if id.is_empty() || slug.is_empty() || label.is_empty() || now.is_empty() {
        return Err(storage_error("classification fields must not be empty"));
    }
    let sql = match table {
        "categories" => {
            "INSERT INTO categories (id, slug, label, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at"
        }
        "tags" => {
            "INSERT INTO tags (id, slug, label, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at"
        }
        _ => return Err(storage_error("unsupported classification table")),
    };
    connection
        .execute(sql, params![id, slug, label, now])
        .map_err(storage_error)?;
    let actual_id: String = connection
        .query_row(
            &format!("SELECT id FROM {table} WHERE slug = ?1"),
            params![slug],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    Ok(json!({ "id": actual_id }))
}

fn insert_task(connection: &Connection, task: AndroidTaskInput) -> Result<Value, String> {
    connection
        .execute(
            "INSERT INTO tasks
             (id, title, description_markdown, status, category_id, parent_id, position,
              priority, version, created_at, updated_at, completed_at, canceled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id,
                task.title,
                task.description_markdown,
                task.status,
                task.category_id,
                task.parent_id,
                task.position,
                task.priority,
                task.version,
                task.created_at,
                task.updated_at,
                task.completed_at,
                task.canceled_at,
            ],
        )
        .map_err(storage_error)?;
    connection
        .execute(
            "UPDATE cache_meta
             SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
             WHERE key = 'workspace_revision'",
            [],
        )
        .map_err(storage_error)?;
    Ok(json!({ "changes": 1 }))
}

fn update_task(
    connection: &Connection,
    task: AndroidTaskInput,
    expected_version: i64,
    tag_ids: &[String],
    dependency_ids: &[String],
) -> Result<Value, String> {
    if expected_version < 1 || task.version != expected_version + 1 {
        return Err(storage_error("invalid expected task version"));
    }
    let old_parent: Option<Option<String>> = connection
        .query_row(
            "SELECT parent_id FROM tasks WHERE id = ?1 AND version = ?2",
            params![task.id, expected_version],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    let old_parent = old_parent.ok_or_else(|| storage_error("task version changed before the update"))?;
    let moving = old_parent != task.parent_id;
    if moving {
        connection
            .execute(
                "UPDATE tasks SET position = position + 1 WHERE parent_id IS ?1 AND id <> ?2",
                params![task.parent_id, task.id],
            )
            .map_err(storage_error)?;
    }
    let changed = connection
        .execute(
            "UPDATE tasks SET title = ?1, description_markdown = ?2, status = ?3,
             category_id = ?4, priority = ?5, version = version + 1,
             updated_at = ?6, completed_at = ?7, canceled_at = ?8,
             parent_id = ?11, position = CASE WHEN ?12 THEN 0 ELSE position END
             WHERE id = ?9 AND version = ?10",
            params![
                task.title, task.description_markdown, task.status, task.category_id,
                task.priority, task.updated_at, task.completed_at, task.canceled_at,
                task.id, expected_version, task.parent_id, moving,
            ],
        )
        .map_err(storage_error)?;
    if changed != 1 {
        return Err(storage_error("task version changed before the update"));
    }
    if moving {
        let mut statement = connection
            .prepare("SELECT id FROM tasks WHERE parent_id IS ?1 ORDER BY position, id")
            .map_err(storage_error)?;
        let siblings = statement
            .query_map(params![old_parent], |row| row.get::<_, String>(0))
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        drop(statement);
        for (position, id) in siblings.iter().enumerate() {
            connection
                .execute("UPDATE tasks SET position = ?1 WHERE id = ?2", params![position as i64, id])
                .map_err(storage_error)?;
        }
    }
    connection
        .execute("DELETE FROM task_tags WHERE task_id = ?1", params![task.id])
        .map_err(storage_error)?;
    for tag_id in tag_ids {
        connection
            .execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![task.id, tag_id],
            )
            .map_err(storage_error)?;
    }
    connection
        .execute("DELETE FROM task_dependencies WHERE task_id = ?1", params![task.id])
        .map_err(storage_error)?;
    for dependency_id in dependency_ids {
        connection
            .execute(
                "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?1, ?2)",
                params![task.id, dependency_id],
            )
            .map_err(storage_error)?;
    }
    connection
        .execute(
            "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
             WHERE key = 'workspace_revision'",
            [],
        )
        .map_err(storage_error)?;
    Ok(json!({ "changes": 1 }))
}

fn delete_task(connection: &Connection, id: &str, expected_version: i64) -> Result<Value, String> {
    let parent_id: Option<Option<String>> = connection.query_row(
        "SELECT parent_id FROM tasks WHERE id = ?1 AND version = ?2",
        params![id, expected_version], |row| row.get(0),
    ).optional().map_err(storage_error)?;
    let parent_id = parent_id.ok_or_else(|| storage_error("task version changed before deletion"))?;
    let changes = connection.execute(
        "DELETE FROM tasks WHERE id = ?1 AND version = ?2 AND NOT EXISTS
         (SELECT 1 FROM tasks AS children WHERE children.parent_id = tasks.id)
         AND NOT EXISTS (SELECT 1 FROM task_dependencies WHERE depends_on_id = tasks.id)",
        params![id, expected_version],
    ).map_err(storage_error)?;
    if changes != 1 {
        return Err(storage_error("task has children, dependents, or a newer version"));
    }
    let mut statement = connection.prepare("SELECT id FROM tasks WHERE parent_id IS ?1 ORDER BY position, id")
        .map_err(storage_error)?;
    let siblings = statement.query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?.collect::<Result<Vec<_>, _>>().map_err(storage_error)?;
    drop(statement);
    for (position, sibling_id) in siblings.iter().enumerate() {
        connection.execute("UPDATE tasks SET position = ?1 WHERE id = ?2", params![position as i64, sibling_id])
            .map_err(storage_error)?;
    }
    connection.execute(
        "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'workspace_revision'",
        [],
    ).map_err(storage_error)?;
    Ok(json!({ "changes": 1 }))
}

fn set_sibling_order(connection: &Connection, parent_id: Option<String>, task_ids: &[String]) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM tasks WHERE parent_id IS ?1")
        .map_err(storage_error)?;
    let siblings = statement
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    let ids = task_ids.iter().collect::<std::collections::HashSet<_>>();
    if siblings.len() != task_ids.len() || ids.len() != task_ids.len()
        || siblings.iter().any(|id| !ids.contains(id))
    {
        return Err(storage_error("order must contain exactly the current siblings"));
    }
    for (position, id) in task_ids.iter().enumerate() {
        connection.execute("UPDATE tasks SET position = ?1 WHERE id = ?2", params![position as i64, id])
            .map_err(storage_error)?;
    }
    connection.execute(
        "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'workspace_revision'",
        [],
    ).map_err(storage_error)?;
    Ok(json!({ "changes": task_ids.len() }))
}

fn purge_canceled_tasks(connection: &Connection, now: &str) -> Result<Value, String> {
    let canceled: Vec<String> = connection
        .prepare("SELECT id FROM tasks WHERE status = 'canceled' ORDER BY id ASC")
        .map_err(storage_error)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    if canceled.is_empty() {
        return Ok(json!({
            "deletedTaskIds": Vec::<String>::new(),
            "affectedTaskIds": Vec::<String>::new(),
            "orderParentIds": Vec::<Option<String>>::new(),
        }));
    }
    let placeholders = vec!["?"; canceled.len()].join(", ");
    let affected_query = format!(
        "SELECT id FROM tasks WHERE status <> 'canceled' AND (parent_id IN ({}) OR id IN (SELECT task_id FROM task_dependencies WHERE depends_on_id IN ({}))) ORDER BY id ASC",
        placeholders, placeholders,
    );
    let mut affected_params: Vec<String> = canceled.clone();
    affected_params.extend(canceled.clone());
    let affected_sql: Vec<&dyn rusqlite::ToSql> = affected_params.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let mut affected_statement = connection.prepare(&affected_query).map_err(storage_error)?;
    let affected: Vec<String> = affected_statement
        .query_map(affected_sql.as_slice(), |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    drop(affected_statement);

    let canceled_sql: Vec<&dyn rusqlite::ToSql> = canceled.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let parent_query = format!(
        "SELECT DISTINCT parent_id FROM tasks WHERE status = 'canceled' AND id IN ({})",
        placeholders,
    );
    let mut parent_statement = connection.prepare(&parent_query).map_err(storage_error)?;
    let mut order_parent_ids: Vec<Option<String>> = parent_statement
        .query_map(canceled_sql.as_slice(), |row| row.get::<_, Option<String>>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    drop(parent_statement);

    let delete_query = format!("DELETE FROM tasks WHERE status = 'canceled' AND id IN ({})", placeholders);
    let deleted = connection.execute(&delete_query, canceled_sql.as_slice()).map_err(storage_error)?;
    if deleted as i64 != canceled.len() as i64 {
        return Err(storage_error("canceled tasks changed while they were being purged"));
    }

    for id in &affected {
        connection.execute(
            "UPDATE tasks SET version = version + 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        ).map_err(storage_error)?;
    }

    // Root needs densifying when a child was re-parented onto it.
    for id in &affected {
        let parent: Option<String> = connection
            .query_row("SELECT parent_id FROM tasks WHERE id = ?1", params![id], |row| row.get(0))
            .map_err(storage_error)?;
        if parent.is_none() {
            order_parent_ids.push(None);
            break;
        }
    }
    order_parent_ids.sort_by(|left, right| left.as_deref().unwrap_or("").cmp(right.as_deref().unwrap_or("")));
    order_parent_ids.dedup();

    for parent in &order_parent_ids {
        let mut statement = connection
            .prepare("SELECT id FROM tasks WHERE parent_id IS ?1 ORDER BY position, id")
            .map_err(storage_error)?;
        let siblings = statement
            .query_map(params![parent], |row| row.get::<_, String>(0))
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        drop(statement);
        for (position, sibling_id) in siblings.iter().enumerate() {
            connection
                .execute("UPDATE tasks SET position = ?1 WHERE id = ?2", params![position as i64, sibling_id])
                .map_err(storage_error)?;
        }
    }

    connection.execute(
        "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'workspace_revision'",
        [],
    ).map_err(storage_error)?;
    Ok(json!({ "deletedTaskIds": canceled, "affectedTaskIds": affected, "orderParentIds": order_parent_ids }))
}

fn reorder_tasks(
    connection: &Connection,
    parent_id: Option<String>,
    task_ids: &[String],
    selected: &[AndroidReorderSelection],
) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM tasks WHERE parent_id IS ?1 ORDER BY position, id")
        .map_err(storage_error)?;
    let siblings = statement
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    drop(statement);
    let ids = task_ids.iter().collect::<std::collections::HashSet<_>>();
    if task_ids.len() != siblings.len() || ids.len() != task_ids.len()
        || siblings.iter().any(|id| !ids.contains(id))
    {
        return Err(storage_error("reorder must contain exactly the current siblings"));
    }
    let selected_ids = selected.iter().map(|task| &task.id).collect::<std::collections::HashSet<_>>();
    if selected_ids.len() != selected.len() || selected.is_empty()
        || selected_ids.iter().any(|id| !ids.contains(id))
    {
        return Err(storage_error("reorder selection is invalid"));
    }
    for (position, id) in task_ids.iter().enumerate() {
        let changes = if let Some(task) = selected.iter().find(|task| &task.id == id) {
            connection.execute(
                "UPDATE tasks SET position = ?1, version = version + 1 WHERE id = ?2 AND version = ?3",
                params![position as i64, id, task.expected_version],
            )
        } else {
            connection.execute("UPDATE tasks SET position = ?1 WHERE id = ?2", params![position as i64, id])
        }.map_err(storage_error)?;
        if changes != 1 {
            return Err(storage_error("task version changed before the reorder"));
        }
    }
    connection.execute(
        "UPDATE cache_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'workspace_revision'",
        [],
    ).map_err(storage_error)?;
    Ok(json!({ "changes": selected.len() }))
}

fn insert_activity(
    connection: &Connection,
    task_id: &str,
    request_id: &str,
    action: &str,
    actor_kind: &str,
    actor_label: &str,
    created_at: &str,
    details_json: &str,
) -> Result<Value, String> {
    connection
        .execute(
            "INSERT INTO activity
             (task_id, request_id, action, actor_kind, actor_label, created_at, details_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                task_id,
                request_id,
                action,
                actor_kind,
                actor_label,
                created_at,
                details_json
            ],
        )
        .map_err(storage_error)?;
    Ok(json!({ "changes": 1 }))
}

fn write_receipt(
    connection: &Connection,
    idempotency_key: &str,
    command: &str,
    request_hash: &str,
    response_json: &str,
    created_at: &str,
) -> Result<Value, String> {
    connection
        .execute(
            "INSERT INTO command_receipts
             (idempotency_key, command, request_hash, response_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                idempotency_key,
                command,
                request_hash,
                response_json,
                created_at
            ],
        )
        .map_err(storage_error)?;
    Ok(json!({ "changes": 1 }))
}

fn fixed_all(_connection: &Connection, statement: FixedStatement) -> Result<Value, String> {
    match statement {
        FixedStatement::ProbeReset | FixedStatement::ProbeInsert => {
            Err(storage_error("probe statements are write-only"))
        }
    }
}

#[tauri::command]
pub fn android_storage(
    app: AppHandle,
    state: State<'_, AndroidStorageState>,
    request: AndroidStorageRequest,
) -> Result<Value, String> {
    let mut connection_guard = connection(&app, &state)?;
    let connection = connection_guard
        .as_mut()
        .ok_or_else(|| storage_error("database connection was not initialized"))?;
    let mut transaction_guard = state
        .transaction
        .lock()
        .map_err(|_| storage_error("transaction lock poisoned"))?;
    expire_transaction(&mut transaction_guard, connection)?;

    match request {
        AndroidStorageRequest::Probe => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot probe while a transaction is active"));
            }
            probe_result(&app, connection)
        }
        AndroidStorageRequest::Begin { transaction_id } => {
            if transaction_id.trim().is_empty() {
                return Err(storage_error("transaction_id must not be empty"));
            }
            if transaction_guard.is_some() {
                return Err(storage_error("a transaction is already active"));
            }
            connection
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(storage_error)?;
            *transaction_guard = Some(ActiveTransaction {
                id: transaction_id,
                started_at: Instant::now(),
            });
            Ok(json!({ "started": true }))
        }
        AndroidStorageRequest::Run {
            transaction_id,
            statement,
            values,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            fixed_run(connection, statement, &values)
        }
        AndroidStorageRequest::All { statement } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "non-transactional reads are unavailable while a transaction is active",
                ));
            }
            fixed_all(connection, statement)
        }
        AndroidStorageRequest::ReadSnapshot => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "non-transactional reads are unavailable while a transaction is active",
                ));
            }
            read_snapshot(connection)
        }
        AndroidStorageRequest::ReadReceipt { idempotency_key } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "non-transactional reads are unavailable while a transaction is active",
                ));
            }
            read_receipt(connection, &idempotency_key)
        }
        AndroidStorageRequest::ReadCanonicalMeta => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "non-transactional reads are unavailable while a transaction is active",
                ));
            }
            read_canonical_meta(connection)
        }
        AndroidStorageRequest::ReadTheme => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot read the theme during a transaction"));
            }
            Ok(json!({ "name": cache_meta_value(connection, "theme_name")? }))
        }
        AndroidStorageRequest::SetTheme { name } => {
            if transaction_guard.is_some() || name.trim().is_empty() {
                return Err(storage_error(
                    "cannot set the theme during a transaction or to an empty name",
                ));
            }
            connection
                .execute(
                    "INSERT INTO cache_meta (key, value) VALUES ('theme_name', ?1)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![name],
                )
                .map_err(storage_error)?;
            Ok(json!({ "saved": true }))
        }
        AndroidStorageRequest::ReadOperation => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot read an operation during a transaction"));
            }
            Ok(json!({ "operation": read_operation(connection)? }))
        }
        AndroidStorageRequest::WriteOperation { transaction_id, record } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            write_operation(connection, &record)?;
            Ok(json!({ "saved": true }))
        }
        AndroidStorageRequest::ClearOperation { transaction_id, operation_id } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            clear_operation(connection, &operation_id)?;
            Ok(json!({ "cleared": true }))
        }
        AndroidStorageRequest::SetSiblingOrder { transaction_id, parent_id, task_ids } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            set_sibling_order(connection, parent_id, &task_ids)
        }
        AndroidStorageRequest::DeleteTask { transaction_id, id, expected_version } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            delete_task(connection, &id, expected_version)
        }
        AndroidStorageRequest::PurgeCanceledTasks { transaction_id, now } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            purge_canceled_tasks(connection, &now)
        }
        AndroidStorageRequest::ReadPendingWrite => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "cannot read a pending write during a transaction",
                ));
            }
            Ok(json!({ "pending": read_pending_write(connection)? }))
        }
        AndroidStorageRequest::StageCanonicalWrite { pending } => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot stage a write during a transaction"));
            }
            stage_pending_write(connection, &pending)
        }
        AndroidStorageRequest::CompletePendingWrite { operation_id } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "cannot complete a write during a transaction",
                ));
            }
            complete_pending_write(connection, &operation_id)
        }
        AndroidStorageRequest::ReplaceCanonicalWorkspace {
            workspace_id,
            fingerprint,
            tasks,
            receive,
        } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "cannot replace the canonical workspace while a transaction is active",
                ));
            }
            replace_canonical_workspace(connection, &workspace_id, &fingerprint, &tasks, receive)
        }
        AndroidStorageRequest::ReadWorkspaceBackup => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "non-transactional reads are unavailable while a transaction is active",
                ));
            }
            read_workspace_backup(connection)
        }
        AndroidStorageRequest::RestoreWorkspaceBackup { backup } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "cannot restore a backup while a transaction is active",
                ));
            }
            restore_workspace_backup(connection, &backup)
        }
        AndroidStorageRequest::ReadReceiveMarker => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot read the receive marker during a transaction"));
            }
            Ok(json!({ "marker": read_receive_marker(connection)? }))
        }
        AndroidStorageRequest::WriteReceiveMarker { marker } => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot write the receive marker during a transaction"));
            }
            write_receive_marker(connection, &marker)?;
            Ok(json!({ "saved": true }))
        }
        AndroidStorageRequest::ClearReceiveMarker => {
            if transaction_guard.is_some() {
                return Err(storage_error("cannot clear the receive marker during a transaction"));
            }
            clear_receive_marker(connection)?;
            Ok(json!({ "cleared": true }))
        }
        AndroidStorageRequest::EnsureCategory {
            transaction_id,
            id,
            slug,
            label,
            now,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            ensure_classification(connection, &id, &slug, &label, &now, "categories")
        }
        AndroidStorageRequest::EnsureTag {
            transaction_id,
            id,
            slug,
            label,
            now,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            ensure_classification(connection, &id, &slug, &label, &now, "tags")
        }
        AndroidStorageRequest::ShiftSiblingPositions {
            transaction_id,
            parent_id,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            let changes = connection
                .execute(
                    "UPDATE tasks SET position = position + 1 WHERE parent_id IS ?1",
                    params![parent_id],
                )
                .map_err(storage_error)?;
            Ok(json!({ "changes": changes }))
        }
        AndroidStorageRequest::InsertTask {
            transaction_id,
            task,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            insert_task(connection, task)
        }
        AndroidStorageRequest::UpdateTask {
            transaction_id,
            task,
            expected_version,
            tag_ids,
            dependency_ids,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            update_task(connection, task, expected_version, &tag_ids, &dependency_ids)
        }
        AndroidStorageRequest::ReorderTasks { transaction_id, parent_id, task_ids, selected } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            reorder_tasks(connection, parent_id, &task_ids, &selected)
        }
        AndroidStorageRequest::InsertTaskTag {
            transaction_id,
            task_id,
            tag_id,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            let changes = connection
                .execute(
                    "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                    params![task_id, tag_id],
                )
                .map_err(storage_error)?;
            Ok(json!({ "changes": changes }))
        }
        AndroidStorageRequest::InsertActivity {
            transaction_id,
            task_id,
            request_id,
            action,
            actor_kind,
            actor_label,
            created_at,
            details_json,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            insert_activity(
                connection,
                &task_id,
                &request_id,
                &action,
                &actor_kind,
                &actor_label,
                &created_at,
                &details_json,
            )
        }
        AndroidStorageRequest::WriteReceipt {
            transaction_id,
            idempotency_key,
            command,
            request_hash,
            response_json,
            created_at,
        } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            write_receipt(
                connection,
                &idempotency_key,
                &command,
                &request_hash,
                &response_json,
                &created_at,
            )
        }
        AndroidStorageRequest::Commit { transaction_id } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            connection.execute_batch("COMMIT").map_err(storage_error)?;
            *transaction_guard = None;
            Ok(json!({ "committed": true }))
        }
        AndroidStorageRequest::Rollback { transaction_id }
        | AndroidStorageRequest::Close { transaction_id } => {
            active_transaction(&mut transaction_guard, connection, &transaction_id)?;
            connection
                .execute_batch("ROLLBACK")
                .map_err(storage_error)?;
            *transaction_guard = None;
            Ok(json!({ "rolledBack": true }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_rebuild_preserves_same_workspace_receipts() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        replace_canonical_workspace(&connection, "first", "initial", &[], false).unwrap();
        write_receipt(&connection, "retry-key", "task.create", "hash", "{}", "now").unwrap();
        write_operation(&connection, &json!({ "id": "undo-me" })).unwrap();

        replace_canonical_workspace(&connection, "first", "after-write", &[], false).unwrap();
        assert_eq!(read_operation(&connection).unwrap().unwrap()["id"], "undo-me");
        assert!(clear_operation(&connection, "wrong-id").is_err());
        assert_eq!(read_operation(&connection).unwrap().unwrap()["id"], "undo-me");
        clear_operation(&connection, "undo-me").unwrap();
        assert!(read_operation(&connection).unwrap().is_none());
        assert_eq!(read_canonical_meta(&connection).unwrap()["cacheVersion"], "2");
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());

        assert!(replace_canonical_workspace(&connection, "second", "new-workspace", &[], false).is_err());
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());
    }

    #[test]
    fn adopting_another_workspace_cannot_discard_local_tasks() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        connection.execute(
            "INSERT INTO tasks (id, title, status, position, version, created_at, updated_at) VALUES ('local', 'Keep me', 'open', 0, 1, 'now', 'now')",
            [],
        ).unwrap();
        let error =
            replace_canonical_workspace(&connection, "incoming", "fingerprint", &[], false).unwrap_err();
        assert!(error.contains("LOCAL_TASKS_NOT_EMPTY"));
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn receive_flow_backups_adopts_and_restores_local_tasks() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        ensure_classification(&connection, "tag", "important", "Important", "now", "tags").unwrap();
        for (position, id) in ["a", "b"].iter().enumerate() {
            insert_task(&connection, AndroidTaskInput {
                id: (*id).into(), title: (*id).into(), description_markdown: String::new(),
                status: "open".into(), category_id: None, parent_id: None, position: position as i64,
                priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
                completed_at: None, canceled_at: None,
            }).unwrap();
        }
        connection.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ('b', 'a')", [],
        ).unwrap();
        connection.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES ('a', 'tag')", [],
        ).unwrap();
        connection.execute(
            "INSERT INTO activity (task_id, request_id, action, actor_kind, actor_label, created_at, details_json)
             VALUES ('a', 'req', 'created', 'user', 'me', 'now', '{}')", [],
        ).unwrap();
        write_receipt(&connection, "retry-key", "task.create", "hash", "{}", "now").unwrap();

        // Adoption without a marker is refused.
        assert!(replace_canonical_workspace(&connection, "incoming", "fp", &[], true).is_err());
        // A marker for a different workspace is refused.
        write_receive_marker(&connection, &json!({ "targetWorkspaceId": "other" })).unwrap();
        assert!(replace_canonical_workspace(&connection, "incoming", "fp", &[], true).is_err());

        // The matching marker allows adoption of the incoming workspace.
        write_receive_marker(&connection, &json!({ "targetWorkspaceId": "incoming" })).unwrap();
        let backup = read_workspace_backup(&connection).unwrap();
        let incoming = vec![AndroidImportedTask {
            id: "x".into(), title: "Incoming".into(), description_markdown: String::new(),
            status: "open".into(), priority: 2, category: None, tags: vec![], parent_id: None,
            dependency_ids: vec![], position: 0, version: 1, created_at: "now".into(),
            updated_at: "now".into(), completed_at: None, canceled_at: None,
        }];
        replace_canonical_workspace(&connection, "incoming", "fp", &incoming, true).unwrap();
        let snapshot = read_snapshot(&connection).unwrap();
        assert_eq!(snapshot["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["tasks"][0]["id"], "x");

        // Restoring the backup brings the local tasks and their links back.
        restore_workspace_backup(&connection, &backup).unwrap();
        let snapshot = read_snapshot(&connection).unwrap();
        let ids: Vec<String> = snapshot["tasks"].as_array().unwrap()
            .iter().map(|task| task["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        let count = |query: &str| -> i64 {
            connection.query_row(query, [], |row| row.get(0)).unwrap()
        };
        assert_eq!(count("SELECT COUNT(*) FROM task_dependencies"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM task_tags"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM activity"), 1);
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());
        assert!(cache_meta_value(&connection, "workspace_id").unwrap().is_none());

        clear_receive_marker(&connection).unwrap();
        assert!(read_receive_marker(&connection).unwrap().is_none());
    }

    #[test]
    fn task_update_enforces_version_and_replaces_tags() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        let task = AndroidTaskInput {
            id: "task".into(), title: "Before".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: None, position: 0,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: None,
        };
        insert_task(&connection, task).unwrap();
        insert_task(&connection, AndroidTaskInput {
            id: "zz-blocker".into(), title: "Blocker".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: None, position: 0,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: None,
        }).unwrap();
        ensure_classification(&connection, "tag", "important", "Important", "now", "tags").unwrap();
        let updated = AndroidTaskInput {
            id: "task".into(), title: "After".into(), description_markdown: "#important".into(),
            status: "done".into(), category_id: None, parent_id: Some("zz-blocker".into()), position: 0,
            priority: 1, version: 2, created_at: "now".into(), updated_at: "later".into(),
            completed_at: Some("later".into()), canceled_at: None,
        };
        update_task(&connection, updated, 1, &["tag".into()], &["zz-blocker".into()]).unwrap();
        let snapshot = read_snapshot(&connection).unwrap();
        assert_eq!(snapshot["tasks"][0]["title"], "After");
        assert_eq!(snapshot["tasks"][0]["status"], "done");
        assert_eq!(snapshot["tasks"][0]["parentId"], "zz-blocker");
        assert_eq!(snapshot["tasks"][0]["version"], 2);
        assert_eq!(snapshot["tasks"][0]["tags"][0]["slug"], "important");
        assert_eq!(snapshot["tasks"][0]["dependencyIds"][0], "zz-blocker");
        let stale = AndroidTaskInput {
            id: "task".into(), title: "Stale".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: None, position: 0,
            priority: 2, version: 2, created_at: "now".into(), updated_at: "later".into(),
            completed_at: None, canceled_at: None,
        };
        assert!(update_task(&connection, stale, 1, &[], &[]).is_err());
        assert_eq!(read_snapshot(&connection).unwrap()["tasks"][0]["title"], "After");
    }

    #[test]
    fn reorder_updates_only_selected_versions() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        for (position, id) in ["a", "b", "c"].iter().enumerate() {
            insert_task(&connection, AndroidTaskInput {
                id: (*id).into(), title: (*id).into(), description_markdown: String::new(),
                status: "open".into(), category_id: None, parent_id: None, position: position as i64,
                priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
                completed_at: None, canceled_at: None,
            }).unwrap();
        }
        reorder_tasks(&connection, None, &["b".into(), "a".into(), "c".into()],
            &[AndroidReorderSelection { id: "b".into(), expected_version: 1 }]).unwrap();
        let ids = connection.prepare("SELECT id, version FROM tasks ORDER BY position").unwrap()
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(ids, vec![("b".into(), 2), ("a".into(), 1), ("c".into(), 1)]);
        set_sibling_order(&connection, None, &["a".into(), "b".into(), "c".into()]).unwrap();
        assert_eq!(read_snapshot(&connection).unwrap()["tasks"][0]["id"], "a");
        assert!(set_sibling_order(&connection, None, &["a".into(), "b".into()]).is_err());
        assert!(reorder_tasks(&connection, None, &["a".into(), "b".into(), "c".into()],
            &[AndroidReorderSelection { id: "b".into(), expected_version: 1 }]).is_err());
    }

    #[test]
    fn delete_task_rejects_dependents_and_stale_versions_then_densifies() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        for (position, id) in ["a", "b", "c"].iter().enumerate() {
            insert_task(&connection, AndroidTaskInput {
                id: (*id).into(), title: (*id).into(), description_markdown: String::new(),
                status: "open".into(), category_id: None, parent_id: None, position: position as i64,
                priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
                completed_at: None, canceled_at: None,
            }).unwrap();
        }
        connection.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ('b', 'a')", [],
        ).unwrap();
        ensure_classification(&connection, "tag", "important", "Important", "now", "tags").unwrap();
        connection.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES ('a', 'tag')", [],
        ).unwrap();
        assert!(delete_task(&connection, "a", 1).is_err());
        connection.execute("DELETE FROM task_dependencies", []).unwrap();
        assert!(delete_task(&connection, "a", 9).is_err());
        delete_task(&connection, "a", 1).unwrap();
        let ids = connection.prepare("SELECT id, position FROM tasks ORDER BY position").unwrap()
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(ids, vec![("b".into(), 0), ("c".into(), 1)]);
        let tags: i64 = connection
            .query_row("SELECT COUNT(*) FROM task_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tags, 0);
    }

    #[test]
    fn purge_canceled_tasks_reparents_children_and_removes_dependencies() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        insert_task(&connection, AndroidTaskInput {
            id: "a".into(), title: "a".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: None, position: 0,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: None,
        }).unwrap();
        insert_task(&connection, AndroidTaskInput {
            id: "d".into(), title: "d".into(), description_markdown: String::new(),
            status: "canceled".into(), category_id: None, parent_id: None, position: 1,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: Some("now".into()),
        }).unwrap();
        insert_task(&connection, AndroidTaskInput {
            id: "e".into(), title: "e".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: Some("d".into()), position: 0,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: None,
        }).unwrap();
        insert_task(&connection, AndroidTaskInput {
            id: "f".into(), title: "f".into(), description_markdown: String::new(),
            status: "open".into(), category_id: None, parent_id: None, position: 2,
            priority: 2, version: 1, created_at: "now".into(), updated_at: "now".into(),
            completed_at: None, canceled_at: None,
        }).unwrap();
        connection.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ('f', 'd')", [],
        ).unwrap();

        let result = purge_canceled_tasks(&connection, "later").unwrap();
        assert_eq!(result["deletedTaskIds"], json!(["d"]));
        assert_eq!(result["affectedTaskIds"], json!(["e", "f"]));
        let count = |query: &str| -> i64 {
            connection.query_row(query, [], |row| row.get(0)).unwrap()
        };
        assert_eq!(count("SELECT COUNT(*) FROM tasks WHERE id = 'd'"), 0);
        let e_parent: Option<String> = connection.query_row("SELECT parent_id FROM tasks WHERE id = 'e'", [], |row| row.get(0)).unwrap();
        assert_eq!(e_parent, None);
        assert_eq!(count("SELECT version FROM tasks WHERE id = 'e'"), 2);
        assert_eq!(count("SELECT COUNT(*) FROM task_dependencies WHERE task_id = 'f'"), 0);
        assert_eq!(count("SELECT version FROM tasks WHERE id = 'f'"), 2);
        let ids = connection.prepare("SELECT id, position FROM tasks ORDER BY position").unwrap()
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(ids, vec![("a".into(), 0), ("e".into(), 1), ("f".into(), 2)]);
    }

    #[test]
    fn staged_file_write_blocks_import_and_restores_its_receipt() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        replace_canonical_workspace(&connection, "first", "initial", &[], false).unwrap();
        let pending = AndroidPendingWrite {
            operation_id: "write".into(),
            workspace_id: "first".into(),
            folder_uri: "content://folder".into(),
            files: vec![AndroidPendingFile {
                relative_path: "tasks/new.json".into(),
                previous_content: None,
                content: Some("new task".into()),
            }],
            idempotency_key: "retry-key".into(),
            request_hash: "hash".into(),
            response_json: "{}".into(),
            created_at: "now".into(),
        };
        stage_pending_write(&connection, &pending).unwrap();
        assert!(replace_canonical_workspace(&connection, "first", "next", &[], false).is_err());
        assert!(complete_pending_write(&connection, "wrong").is_err());
        assert!(read_pending_write(&connection).unwrap().is_some());
        complete_pending_write(&connection, "write").unwrap();
        replace_canonical_workspace(&connection, "first", "next", &[], false).unwrap();
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());
    }
}
