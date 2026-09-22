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
    },
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
    content: String,
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

fn read_canonical_meta(connection: &Connection) -> Result<Value, String> {
    Ok(json!({
        "workspaceId": cache_meta_value(connection, "workspace_id")?,
        "fingerprint": cache_meta_value(connection, "canonical_fingerprint")?,
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

fn replace_canonical_workspace(
    connection: &Connection,
    workspace_id: &str,
    fingerprint: &str,
    tasks: &[AndroidImportedTask],
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

    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(storage_error)?;
    let result = (|| {
        // Receipts survive a cache rebuild within the same workspace, including
        // the rebuild triggered by our own SAF write on the next request.
        // Otherwise a retry of a successful create would add a second task.
        if cache_meta_value(connection, "workspace_id")?.as_deref() != Some(workspace_id) {
            connection
                .execute("DELETE FROM command_receipts", [])
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
        } => {
            if transaction_guard.is_some() {
                return Err(storage_error(
                    "cannot replace the canonical workspace while a transaction is active",
                ));
            }
            replace_canonical_workspace(connection, &workspace_id, &fingerprint, &tasks)
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
        replace_canonical_workspace(&connection, "first", "initial", &[]).unwrap();
        write_receipt(&connection, "retry-key", "task.create", "hash", "{}", "now").unwrap();

        replace_canonical_workspace(&connection, "first", "after-write", &[]).unwrap();
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());

        assert!(replace_canonical_workspace(&connection, "second", "new-workspace", &[]).is_err());
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
            replace_canonical_workspace(&connection, "incoming", "fingerprint", &[]).unwrap_err();
        assert!(error.contains("LOCAL_TASKS_NOT_EMPTY"));
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn staged_file_write_blocks_import_and_restores_its_receipt() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        replace_canonical_workspace(&connection, "first", "initial", &[]).unwrap();
        let pending = AndroidPendingWrite {
            operation_id: "write".into(),
            workspace_id: "first".into(),
            folder_uri: "content://folder".into(),
            files: vec![AndroidPendingFile {
                relative_path: "tasks/new.json".into(),
                previous_content: None,
                content: "new task".into(),
            }],
            idempotency_key: "retry-key".into(),
            request_hash: "hash".into(),
            response_json: "{}".into(),
            created_at: "now".into(),
        };
        stage_pending_write(&connection, &pending).unwrap();
        assert!(replace_canonical_workspace(&connection, "first", "next", &[]).is_err());
        assert!(complete_pending_write(&connection, "wrong").is_err());
        assert!(read_pending_write(&connection).unwrap().is_some());
        complete_pending_write(&connection, "write").unwrap();
        replace_canonical_workspace(&connection, "first", "next", &[]).unwrap();
        assert!(read_receipt(&connection, "retry-key").unwrap()["receipt"].is_object());
    }
}
