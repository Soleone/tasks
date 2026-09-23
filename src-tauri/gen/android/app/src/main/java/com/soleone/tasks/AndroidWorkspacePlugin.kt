package com.soleone.tasks

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.SystemClock
import android.provider.DocumentsContract
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit

@InvokeArg
class ExportDocumentArgs {
  lateinit var content: String
  lateinit var suggestedName: String
}

private val EXPORT_DOCUMENT_NAME_PATTERN =
  Regex("""\Atasks-(?:archive-|backup-)?\d{4}-\d{2}-\d{2}T\d{6}Z\.json\z""")

internal fun isSupportedExportDocumentName(name: String): Boolean =
  EXPORT_DOCUMENT_NAME_PATTERN.matches(name)

@InvokeArg
class CanonicalWriteFileArgs {
  lateinit var relativePath: String
  var content: String? = null
  var previousContent: String? = null
  var modifiedAt: Long? = null
}

@InvokeArg
class CanonicalWriteArgs {
  var files: List<CanonicalWriteFileArgs> = emptyList()
}

@TauriPlugin
class AndroidWorkspacePlugin(private val activity: Activity) : Plugin(activity) {
  private val preferences by lazy {
    activity.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  }

  private val ioScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  private val canonicalWriteMutex = Mutex()
  private val readSlots = Semaphore(MAX_CONCURRENT_READS)

  @Command
  fun pickDirectory(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)

      val currentUri = preferences.getString(SELECTED_URI_KEY, null)
      if (currentUri != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(currentUri))
      }
    }
    startActivityForResult(invoke, intent, "onDirectoryPicked")
  }

  @ActivityCallback
  private fun onDirectoryPicked(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("ANDROID_FOLDER_PICKER_CANCELLED")
      return
    }

    val uri = result.data?.data
    if (uri == null) {
      invoke.reject("ANDROID_FOLDER_PICKER_EMPTY_RESULT")
      return
    }

    val grantedFlags = (result.data?.flags ?: 0) and
      (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    val requiredFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    if (grantedFlags != requiredFlags) {
      invoke.reject("ANDROID_FOLDER_PICKER_NO_PERMISSION")
      return
    }

    try {
      activity.contentResolver.takePersistableUriPermission(uri, grantedFlags)
    } catch (error: SecurityException) {
      invoke.reject("ANDROID_FOLDER_PICKER_PERMISSION_FAILED: ${error.message}")
      return
    }

    val previous = preferences.getString(SELECTED_URI_KEY, null)?.let(Uri::parse)
    if (previous != null && previous != uri) releaseDirectoryGrant(previous)
    preferences.edit().putString(SELECTED_URI_KEY, uri.toString()).apply()
    invoke.resolve(directoryResponse(uri))
  }

  @Command
  fun getPersistedDirectory(invoke: Invoke) {
    val uriText = preferences.getString(SELECTED_URI_KEY, null)
    if (uriText == null) {
      invoke.resolve(directoryResponse(null))
      return
    }

    val uri = Uri.parse(uriText)
    val stillGranted = activity.contentResolver.persistedUriPermissions.any { permission ->
      permission.uri == uri && permission.isReadPermission && permission.isWritePermission
    }
    if (!stillGranted) {
      releaseDirectoryGrant(uri)
      preferences.edit().remove(SELECTED_URI_KEY).apply()
      invoke.resolve(directoryResponse(null))
      return
    }

    invoke.resolve(directoryResponse(uri))
  }

  @Command
  fun clearDirectory(invoke: Invoke) {
    val uriText = preferences.getString(SELECTED_URI_KEY, null)
    if (uriText != null) releaseDirectoryGrant(Uri.parse(uriText))
    preferences.edit().remove(SELECTED_URI_KEY).apply()
    invoke.resolve(JSObject())
  }

  private fun releaseDirectoryGrant(uri: Uri) {
    val grant = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri } ?: return
    val flags = (if (grant.isReadPermission) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0) or
      (if (grant.isWritePermission) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
    try {
      activity.contentResolver.releasePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // The persisted grant may already have been revoked by Android.
    }
  }

  @Command
  fun exportTaskDocument(invoke: Invoke) {
    val args = invoke.parseArgs(ExportDocumentArgs::class.java)
    if (args.content.toByteArray(Charsets.UTF_8).size > MAX_EXPORT_BYTES ||
      !isSupportedExportDocumentName(args.suggestedName)) {
      invoke.reject("ANDROID_EXPORT_INVALID_DOCUMENT")
      return
    }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = JSON_MIME_TYPE
      putExtra(Intent.EXTRA_TITLE, args.suggestedName)
    }
    // Launch the picker on the activity thread; document access happens after its result on IO.
    startActivityForResult(invoke, intent, "onExportDocumentPicked")
  }

  @ActivityCallback
  private fun onExportDocumentPicked(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("ANDROID_EXPORT_CANCELLED")
      return
    }
    val uri = result.data?.data ?: run {
      invoke.reject("ANDROID_EXPORT_EMPTY_RESULT")
      return
    }
    val args = try {
      invoke.parseArgs(ExportDocumentArgs::class.java)
    } catch (error: Exception) {
      invoke.reject("ANDROID_EXPORT_FAILED: ${error.message ?: error.javaClass.simpleName}")
      return
    }

    ioScope.launch {
      val startedAtNanos = SystemClock.elapsedRealtimeNanos()
      val response = try {
        writeUtf8(uri, args.content, MAX_EXPORT_BYTES)
        val name = try {
          activity.contentResolver.query(
            uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null,
          )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
          }
        } catch (_: Exception) {
          null
        }
        JSObject().apply {
          put("destinationPath", uri.toString())
          put("displayName", name ?: args.suggestedName)
        }
      } catch (error: Exception) {
        recordSafTiming("export", startedAtNanos, "failed", 1)
        invoke.reject("ANDROID_EXPORT_FAILED: ${error.message ?: error.javaClass.simpleName}")
        return@launch
      }
      recordSafTiming("export", startedAtNanos, "ok", 1)
      invoke.resolve(response)
    }
  }

  @Command
  fun readCanonicalFiles(invoke: Invoke) {
    ioScope.launch {
      val startedAtNanos = SystemClock.elapsedRealtimeNanos()
      var fileCount = 0
      val response = try {
        val uri = selectedUri(requireWrite = false)
        if (uri == null) {
          canonicalFilesResponse(false, JSONArray())
        } else {
          val files = readCanonicalFilesInternal(uri)
          fileCount = files.length()
          canonicalFilesResponse(true, files)
        }
      } catch (error: Exception) {
        recordSafTiming("read", startedAtNanos, "failed", fileCount)
        invoke.reject("ANDROID_WORKSPACE_READ_FAILED: ${error.message ?: error.javaClass.simpleName}")
        return@launch
      }
      recordSafTiming("read", startedAtNanos, "ok", fileCount)
      invoke.resolve(response)
    }
  }

  private fun isWorkspaceConflictCopy(name: String): Boolean {
    return name.startsWith("workspace.sync-conflict-") && name.endsWith(JSON_SUFFIX)
  }

  private suspend fun readCanonicalFilesInternal(uri: Uri): JSONArray {
    val rootId = DocumentsContract.getTreeDocumentId(uri)
    val rootChildren = childDocuments(uri, rootId)

    // Collect canonical files and workspace conflict copies, then tasks/ and order/ entries.
    val reads = mutableListOf<Pair<TreeDocument, String>>()
    rootChildren.firstOrNull { it.name == WORKSPACE_FILE && !it.isDirectory }?.let { document ->
      reads += document to WORKSPACE_FILE
    }
    rootChildren
      .filter { !it.isDirectory && isWorkspaceConflictCopy(it.name) }
      .sortedBy { it.name }
      .forEach { document -> reads += document to document.name }
    for (directoryName in CANONICAL_DIRECTORIES) {
      val directory = rootChildren.firstOrNull { it.name == directoryName && it.isDirectory } ?: continue
      for (document in childDocuments(uri, directory.id)) {
        if (!document.isDirectory && document.name.endsWith(JSON_SUFFIX)) {
          reads += document to "$directoryName/${document.name}"
        }
      }
    }

    // Bound queued coroutines per scan and open streams across overlapping scans.
    val results = boundedOrderedMap(reads, MAX_CONCURRENT_READS) { (document, relativePath) ->
      readSlots.withPermit { canonicalFile(uri, document, relativePath) }
    }

    val files = JSONArray()
    for (result in results) files.put(result)
    return files
  }

  @Command
  fun writeCanonicalFiles(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(CanonicalWriteArgs::class.java)
    } catch (error: Exception) {
      invoke.reject("ANDROID_WORKSPACE_WRITE_FAILED: ${error.message ?: error.javaClass.simpleName}")
      return
    }

    ioScope.launch {
      val startedAtNanos = SystemClock.elapsedRealtimeNanos()
      val result = try {
        canonicalWriteMutex.withLock { writeCanonicalFilesInternal(args) }
      } catch (error: Exception) {
        recordSafTiming("write", startedAtNanos, "failed", args.files.size)
        invoke.reject("ANDROID_WORKSPACE_WRITE_FAILED: ${error.message ?: error.javaClass.simpleName}")
        return@launch
      }
      recordSafTiming("write", startedAtNanos, "ok", args.files.size)
      invoke.resolve(result)
    }
  }

  private fun writeCanonicalFilesInternal(args: CanonicalWriteArgs): JSObject {
    val uri = selectedUri(requireWrite = true)
      ?: throw IllegalStateException("no writable Android sync folder is selected")
    val written = JSONArray()
    val rootId = DocumentsContract.getTreeDocumentId(uri)
    for (file in args.files) {
      val segments = validatedPath(file.relativePath)
      val parentId = ensureDirectory(uri, rootId, segments.dropLast(1))
      val parentUri = DocumentsContract.buildDocumentUriUsingTree(uri, parentId)
      val existing = childDocuments(uri, parentId).firstOrNull { it.name == segments.last() }
      if (existing?.isDirectory == true) {
        throw IllegalArgumentException("${file.relativePath} is a directory")
      }
      val actual = existing?.let {
        readUtf8(DocumentsContract.buildDocumentUriUsingTree(uri, it.id))
      }
      val content = file.content
      if (content == null) {
        if (actual != null) {
          if (actual != file.previousContent) {
            throw IllegalStateException("${file.relativePath} changed since the Android deletion was staged")
          }
          val existingUri = DocumentsContract.buildDocumentUriUsingTree(uri, existing?.id ?: throw IllegalStateException("missing document to delete"))
          if (!DocumentsContract.deleteDocument(activity.contentResolver, existingUri)) {
            throw IllegalStateException("could not delete ${file.relativePath}")
          }
        }
        written.put(file.relativePath)
        continue
      }
      if (actual != content && actual != file.previousContent &&
        (actual == null || !content.startsWith(actual))) {
        throw IllegalStateException("${file.relativePath} changed since the Android write was staged")
      }
      if (actual == content) {
        written.put(file.relativePath)
        continue
      }
      val fileId = existing?.id
        ?: DocumentsContract.createDocument(
          activity.contentResolver,
          parentUri,
          JSON_MIME_TYPE,
          segments.last(),
        )?.let { DocumentsContract.getDocumentId(it) }
        ?: throw IllegalStateException("could not create ${file.relativePath}")
      val fileUri = DocumentsContract.buildDocumentUriUsingTree(uri, fileId)
      writeUtf8(fileUri, content)
      written.put(file.relativePath)
    }
    return JSObject().apply { put("written", written) }
  }

  private fun recordSafTiming(operation: String, startedAtNanos: Long, outcome: String, fileCount: Int) {
    if (!BuildConfig.DEBUG) return
    val durationNanos = SystemClock.elapsedRealtimeNanos() - startedAtNanos
    Log.d(SAF_LOG_TAG, "operation=$operation durationNs=$durationNanos outcome=$outcome fileCount=$fileCount")
  }

  private fun selectedUri(requireWrite: Boolean): Uri? {
    val uriText = preferences.getString(SELECTED_URI_KEY, null) ?: return null
    val uri = Uri.parse(uriText)
    val stillGranted = activity.contentResolver.persistedUriPermissions.any { permission ->
      permission.uri == uri && permission.isReadPermission && (!requireWrite || permission.isWritePermission)
    }
    if (!stillGranted) {
      releaseDirectoryGrant(uri)
      preferences.edit().remove(SELECTED_URI_KEY).apply()
      return null
    }
    return uri
  }

  private fun childDocuments(treeUri: Uri, parentId: String): List<TreeDocument> {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    val documents = mutableListOf<TreeDocument>()
    val cursor = activity.contentResolver.query(childrenUri, columns, null, null, null)
      ?: throw IllegalStateException("Android storage provider did not return folder contents")
    cursor.use {
      val idIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
      val sizeIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
      val modifiedIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
      while (it.moveToNext()) {
        documents += TreeDocument(
          id = it.getString(idIndex),
          name = it.getString(nameIndex) ?: "",
          isDirectory = it.getString(mimeIndex) == DocumentsContract.Document.MIME_TYPE_DIR,
          size = if (it.isNull(sizeIndex)) null else it.getLong(sizeIndex),
          modifiedAt = if (it.isNull(modifiedIndex)) null else it.getLong(modifiedIndex),
        )
      }
    }
    return documents
  }

  private fun canonicalFile(treeUri: Uri, document: TreeDocument, relativePath: String): JSObject {
    if (document.size != null && document.size > MAX_CANONICAL_FILE_BYTES) {
      throw IllegalArgumentException("$relativePath is too large")
    }
    val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, document.id)
    val result = JSObject()
    result.put("relativePath", relativePath)
    result.put("content", readUtf8(documentUri))
    if (document.modifiedAt == null) result.put("modifiedAt", JSONObject.NULL) else result.put("modifiedAt", document.modifiedAt)
    return result
  }

  private fun readUtf8(uri: Uri): String {
    val input = activity.contentResolver.openInputStream(uri)
      ?: throw IllegalStateException("Android storage provider could not open $uri")
    return input.use { stream ->
      stream.readBounded(MAX_CANONICAL_FILE_BYTES).toString(Charsets.UTF_8)
    }
  }

  private fun writeUtf8(uri: Uri, content: String, maxBytes: Long = MAX_CANONICAL_FILE_BYTES) {
    if (content.toByteArray(Charsets.UTF_8).size > maxBytes) {
      throw IllegalArgumentException("file is too large")
    }
    val output = activity.contentResolver.openOutputStream(uri, "wt")
      ?: throw IllegalStateException("Android storage provider could not open $uri for writing")
    output.use { stream -> stream.write(content.toByteArray(Charsets.UTF_8)) }
  }

  private fun ensureDirectory(treeUri: Uri, rootId: String, directories: List<String>): String {
    var parentId = rootId
    for (directoryName in directories) {
      val existing = childDocuments(treeUri, parentId).firstOrNull { it.name == directoryName }
      if (existing != null) {
        if (!existing.isDirectory) throw IllegalArgumentException("$directoryName is not a directory")
        parentId = existing.id
        continue
      }
      val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentId)
      val created = DocumentsContract.createDocument(
        activity.contentResolver,
        parentUri,
        DocumentsContract.Document.MIME_TYPE_DIR,
        directoryName,
      ) ?: throw IllegalStateException("could not create $directoryName")
      parentId = DocumentsContract.getDocumentId(created)
    }
    return parentId
  }

  private fun validatedPath(relativePath: String): List<String> {
    val segments = relativePath.split('/')
    if (segments.any { it.isEmpty() || it == "." || it == ".." }) {
      throw IllegalArgumentException("invalid canonical path $relativePath")
    }
    val valid = relativePath == WORKSPACE_FILE ||
      (segments.size == 2 && segments[0] in CANONICAL_DIRECTORIES && segments[1].endsWith(JSON_SUFFIX))
    if (!valid) throw IllegalArgumentException("invalid canonical path $relativePath")
    return segments
  }

  private fun canonicalFilesResponse(selected: Boolean, files: JSONArray): JSObject {
    val result = JSObject()
    result.put("selected", selected)
    result.put("files", files)
    return result
  }

  private fun directoryResponse(uri: Uri?): JSObject {
    val result = JSObject()
    if (uri == null) {
      result.put("uri", JSONObject.NULL)
      result.put("displayName", JSONObject.NULL)
      result.put("path", JSONObject.NULL)
      return result
    }

    val path = sharedStoragePath(uri)
    result.put("uri", uri.toString())
    result.put("displayName", path?.substringAfterLast('/') ?: uri.lastPathSegment?.let(Uri::decode) ?: "Selected folder")
    result.put("path", path ?: JSONObject.NULL)
    return result
  }

  private fun sharedStoragePath(uri: Uri): String? {
    if (uri.authority != "com.android.externalstorage.documents") return null
    val documentId = try {
      DocumentsContract.getTreeDocumentId(uri)
    } catch (_: IllegalArgumentException) {
      return null
    }
    val separator = documentId.indexOf(':')
    if (separator <= 0) return null
    if (documentId.substring(0, separator) != "primary") return null

    val relative = Uri.decode(documentId.substring(separator + 1)).trim('/')
    val root = Environment.getExternalStorageDirectory().absolutePath
    return if (relative.isEmpty()) root else "$root/$relative"
  }

  private data class TreeDocument(
    val id: String,
    val name: String,
    val isDirectory: Boolean,
    val size: Long?,
    val modifiedAt: Long?,
  )

  private companion object {
    const val PREFERENCES_NAME = "tasks.android.workspace"
    const val SELECTED_URI_KEY = "sync_folder_uri"
    const val WORKSPACE_FILE = "workspace.json"
    const val JSON_SUFFIX = ".json"
    const val JSON_MIME_TYPE = "application/json"
    const val MAX_CANONICAL_FILE_BYTES = 4L * 1024L * 1024L
    const val MAX_CONCURRENT_READS = 4
    const val MAX_EXPORT_BYTES = 8L * 1024L * 1024L
    const val SAF_LOG_TAG = "TasksSAF"
    val CANONICAL_DIRECTORIES = listOf("tasks", "order")
  }
}

private fun InputStream.readBounded(maxBytes: Long): ByteArray {
  val output = java.io.ByteArrayOutputStream()
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
  var total = 0L
  while (true) {
    val count = read(buffer)
    if (count < 0) break
    total += count
    if (total > maxBytes) throw IllegalArgumentException("canonical file is too large")
    output.write(buffer, 0, count)
  }
  return output.toByteArray()
}
