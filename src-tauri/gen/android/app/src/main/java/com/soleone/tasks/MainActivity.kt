package com.soleone.tasks

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val statusBars = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val navigationBars = insets.getInsets(
        WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      webView.evaluateJavascript(
        "document.documentElement.style.setProperty('--android-safe-area-top', '${statusBars.top}px');" +
          "document.documentElement.style.setProperty('--android-safe-area-right', '${maxOf(statusBars.right, navigationBars.right)}px');" +
          "document.documentElement.style.setProperty('--android-safe-area-bottom', '${navigationBars.bottom}px');" +
          "document.documentElement.style.setProperty('--android-safe-area-left', '${maxOf(statusBars.left, navigationBars.left)}px');",
        null,
      )
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
