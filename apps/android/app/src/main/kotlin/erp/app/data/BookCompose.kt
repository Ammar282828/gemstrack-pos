package erp.app.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** `@Environment(Book.self)`: the shop's books for every screen. */
val LocalBook = compositionLocalOf<Book> { Book.shared }

/** What a screen reads of a shelf besides its items. */
@Immutable
data class ShelfStatus<T>(val items: List<T>, val loaded: Boolean, val offline: Boolean, val error: String?, val revision: Int)

/** Starts the shelf (once, whoever asks first) and follows its items: `val orders by rememberShelf(book.orders)`. */
@Composable
fun <T : Any> rememberShelf(shelf: Shelf<T>): State<List<T>> {
    LaunchedEffect(shelf) { shelf.need() }
    return shelf.items.collectAsStateWithLifecycle()
}

/** The shelf's items with its `loaded`, `offline`, `error` and `revision`, for screens that show a skeleton, a banner or memoise. */
@Composable
fun <T : Any> rememberShelfStatus(shelf: Shelf<T>): ShelfStatus<T> {
    LaunchedEffect(shelf) { shelf.need() }
    val items by shelf.items.collectAsStateWithLifecycle()
    val loaded by shelf.loaded.collectAsStateWithLifecycle()
    val offline by shelf.offline.collectAsStateWithLifecycle()
    val error by shelf.error.collectAsStateWithLifecycle()
    val revision by shelf.revision.collectAsStateWithLifecycle()
    return ShelfStatus(items, loaded, offline, error, revision)
}

/** One document of a shelf by id, recomposing when it changes (`shelf.item(id)` alone would not). */
@Composable
fun <T : Any> rememberShelfItem(shelf: Shelf<T>, id: String): T? {
    LaunchedEffect(shelf) { shelf.need() }
    val items by shelf.items.collectAsStateWithLifecycle()
    @Suppress("UNUSED_VARIABLE") val tick = items.size
    return shelf.item(id)
}

/** The shop's settings document, started and followed. */
@Composable
fun <T : Any> rememberSingle(single: Single<T>): State<T?> {
    LaunchedEffect(single) { single.need() }
    return single.value.collectAsStateWithLifecycle()
}
