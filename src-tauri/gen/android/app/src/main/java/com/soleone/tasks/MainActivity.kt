package com.soleone.tasks

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The page sits inside the system bars and above the soft keyboard, so no screen or dialog can
    // draw under them and the keyboard bar sits on the keyboard. The keyboard covers the navigation
    // bar, so the page ends at whichever is taller.
    val bars = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    val keyboard = WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { content, insets ->
      val inset = insets.getInsets(bars)
      val bottom = maxOf(inset.bottom, insets.getInsets(keyboard).bottom)
      content.setPadding(inset.left, inset.top, inset.right, bottom)
      WindowInsetsCompat.Builder(insets).setInsets(bars or keyboard, Insets.NONE).build()
    }
    // The backend reads and writes the task folder with plain file calls, which needs all files access.
    if (!Environment.isExternalStorageManager()) {
      startActivity(
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")),
      )
    }
  }
}
