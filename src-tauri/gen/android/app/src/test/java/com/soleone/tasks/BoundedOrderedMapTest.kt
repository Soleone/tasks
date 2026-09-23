package com.soleone.tasks

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedOrderedMapTest {
  @Test
  fun capsConcurrentReadsAndPreservesListingOrder() = runBlocking(Dispatchers.IO) {
    val started = CountDownLatch(4)
    val active = AtomicInteger(0)
    val peak = AtomicInteger(0)
    val paths = listOf("workspace.json") + (0 until 40).map { "tasks/$it.json" } + listOf("order/root.json")

    val results = boundedOrderedMap(paths, 4) { path ->
      val count = active.incrementAndGet()
      peak.updateAndGet { maxOf(it, count) }
      try {
        started.countDown()
        check(started.await(5, TimeUnit.SECONDS)) { "four readers did not start" }
        if (path == "workspace.json") Thread.sleep(30)
        path
      } finally {
        active.decrementAndGet()
      }
    }

    assertEquals(paths, results)
    assertEquals(4, peak.get())
    assertEquals(0, active.get())
  }

  @Test
  fun sharedSlotsCapOverlappingScans() = runBlocking(Dispatchers.IO) {
    val slots = Semaphore(4)
    val started = CountDownLatch(4)
    val active = AtomicInteger(0)
    val peak = AtomicInteger(0)
    val scans = List(2) {
      async {
        boundedOrderedMap((0 until 20).toList(), 4) { index ->
          slots.withPermit {
            val count = active.incrementAndGet()
            peak.updateAndGet { maxOf(it, count) }
            try {
              started.countDown()
              check(started.await(5, TimeUnit.SECONDS)) { "four readers did not start" }
              index
            } finally {
              active.decrementAndGet()
            }
          }
        }
      }
    }
    assertEquals((0 until 20).toList(), scans[0].await())
    assertEquals((0 until 20).toList(), scans[1].await())
    assertEquals(4, peak.get())
  }

  @Test
  fun worksSequentiallyAndWithNoFiles() = runBlocking(Dispatchers.IO) {
    assertEquals(listOf(2, 4, 6), boundedOrderedMap(listOf(1, 2, 3), 1) { it * 2 })
    assertTrue(boundedOrderedMap(emptyList<Int>(), 4) { it * 2 }.isEmpty())
  }

  @Test
  fun propagatesProviderErrors() {
    val error = assertThrows(IllegalStateException::class.java) {
      runBlocking(Dispatchers.IO) {
        boundedOrderedMap((0 until 40).toList(), 2) { index ->
          if (index == 1) throw IllegalStateException("provider refused read")
          index
        }
      }
    }
    assertEquals("provider refused read", error.message)
  }
}
