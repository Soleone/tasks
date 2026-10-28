package com.soleone.tasks

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlin.concurrent.thread

private const val MAX_IMAGE_BYTES = 10 * 1024 * 1024
private val IMAGE_EXTENSIONS = mapOf(
  "image/png" to "png",
  "image/jpeg" to "jpg",
  "image/webp" to "webp",
  "image/gif" to "gif",
)

@InvokeArg
class ShareImageArgs {
  lateinit var dataUrl: String
}

@TauriPlugin
class ImageAttachmentsPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun pickImage(invoke: Invoke) {
    try {
      val intent = PickVisualMedia().createIntent(activity, PickVisualMediaRequest(PickVisualMedia.ImageOnly))
      startActivityForResult(invoke, intent, "imagePicked")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "The photo picker could not be opened.")
    }
  }

  @ActivityCallback
  fun imagePicked(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.resolve(JSObject().put("dataUrl", org.json.JSONObject.NULL))
      return
    }
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.reject("The image could not be selected. Try again.")
      return
    }
    // Read while the picker's temporary URI permission is held, without blocking the UI.
    thread {
      try {
        val resolver = activity.contentResolver
        val type = resolver.getType(uri)
        require(IMAGE_EXTENSIONS.containsKey(type)) { "Only PNG, JPEG, WebP and GIF images can be added." }
        val bytes = resolver.openInputStream(uri)?.use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          var count = input.read(buffer)
          while (count != -1) {
            require(output.size() + count <= MAX_IMAGE_BYTES) { "Images must be at most 10 MiB." }
            output.write(buffer, 0, count)
            count = input.read(buffer)
          }
          output.toByteArray()
        } ?: throw IllegalStateException("The selected image could not be read.")
        val data = Base64.encodeToString(bytes, Base64.NO_WRAP)
        invoke.resolve(JSObject().put("dataUrl", "data:$type;base64,$data"))
      } catch (error: Exception) {
        invoke.reject(error.message ?: "The selected image could not be read.")
      }
    }
  }

  @Command
  fun shareImage(invoke: Invoke) {
    val args = invoke.parseArgs(ShareImageArgs::class.java)
    thread {
      try {
        val header = args.dataUrl.substringBefore(',')
        val type = header.removePrefix("data:").removeSuffix(";base64")
        val extension = IMAGE_EXTENSIONS[type]
        require(extension != null && header == "data:$type;base64") { "This image type cannot be shared." }
        val encoded = args.dataUrl.substringAfter(',')
        require(encoded.length <= ((MAX_IMAGE_BYTES + 2) / 3) * 4) { "Images must be at most 10 MiB." }
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size <= MAX_IMAGE_BYTES) { "Images must be at most 10 MiB." }
        val folder = File(activity.cacheDir, "shared-images")
        check(folder.isDirectory || folder.mkdirs()) { "The image could not be prepared for sharing." }
        // Keep recent shares readable after returning to Tasks; retire old temporary copies only.
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000
        folder.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
        val file = File(folder, "image-${UUID.randomUUID()}.$extension")
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.images", file)
        val send = Intent(Intent.ACTION_SEND).apply {
          setType(type)
          putExtra(Intent.EXTRA_STREAM, uri)
          clipData = ClipData.newUri(activity.contentResolver, "Image", uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.runOnUiThread {
          try {
            activity.startActivity(Intent.createChooser(send, "Share image"))
            invoke.resolve()
          } catch (error: Exception) {
            invoke.reject(error.message ?: "The image could not be shared.")
          }
        }
      } catch (error: Exception) {
        invoke.reject(error.message ?: "The image could not be shared.")
      }
    }
  }
}
