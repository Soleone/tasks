package com.soleone.tasks

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive

// A fixed number of workers, not one suspended coroutine per file. Called on Dispatchers.IO.
internal suspend fun <T, R : Any> boundedOrderedMap(
  items: List<T>,
  concurrency: Int,
  transform: suspend (T) -> R,
): List<R> = coroutineScope {
  require(concurrency > 0)
  val next = AtomicInteger(0)
  val results = MutableList<R?>(items.size) { null }
  List(minOf(concurrency, items.size)) {
    async {
      while (true) {
        coroutineContext.ensureActive()
        val index = next.getAndIncrement()
        if (index >= items.size) break
        results[index] = transform(items[index])
      }
    }
  }.awaitAll()
  results.map { checkNotNull(it) }
}
