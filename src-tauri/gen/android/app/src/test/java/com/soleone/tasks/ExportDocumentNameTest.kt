package com.soleone.tasks

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportDocumentNameTest {
  @Test
  fun acceptsOnlySupportedExportArchiveAndBackupNames() {
    val timestamp = "2026-09-23T060121Z"

    assertTrue(isSupportedExportDocumentName("tasks-$timestamp.json"))
    assertTrue(isSupportedExportDocumentName("tasks-archive-$timestamp.json"))
    assertTrue(isSupportedExportDocumentName("tasks-backup-$timestamp.json"))
  }

  @Test
  fun rejectsPathsAndUnsupportedOrMalformedNames() {
    val invalidNames = listOf(
      "../tasks-2026-09-23T060121Z.json",
      "tasks-archive-../tasks-2026-09-23T060121Z.json",
      "tasks-backup-..\\tasks-2026-09-23T060121Z.json",
      "/storage/emulated/0/tasks-2026-09-23T060121Z.json",
      "tasks-export-2026-09-23T060121Z.json",
      "tasks-2026-9-23T060121Z.json",
      "tasks-2026-09-23T06:01:21Z.json",
      "tasks-archive-2026-09-23T060121.json",
      "tasks-backup-2026-09-23T060121Z.txt",
    )

    invalidNames.forEach { name ->
      assertFalse("should reject $name", isSupportedExportDocumentName(name))
    }
  }
}
