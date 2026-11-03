package erp.app.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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

/**
 * One document of a shelf by id, recomposing when it changes (`shelf.item(id)` alone would not). It follows the shelf's
 * revision and derives the item, so a change to another document recomposes nothing here: the item is the same object.
 */
@Composable
fun <T : Any> rememberShelfItem(shelf: Shelf<T>, id: String): T? {
    LaunchedEffect(shelf) { shelf.need() }
    val revision = shelf.revision.collectAsStateWithLifecycle()
    val item by remember(shelf, id) { derivedStateOf { revision.value; shelf.item(id) } }
    return item
}

/**
 * Works `calc` out on Dispatchers.Default whenever a key changes and holds the last answer meanwhile (null until the first),
 * so a whole-collection pass (totals, groups, filters) never runs in a frame. Show the skeleton while it is null.
 */
@Composable
fun <T> rememberOffMain(vararg keys: Any?, initial: T? = null, calc: () -> T): State<T?> {
    val latest by rememberUpdatedState(calc)
    return produceState(initial, *keys) {
        val run = latest
        value = withContext(Dispatchers.Default) { run() }
    }
}

/** The shop's settings document, started and followed. */
@Composable
fun <T : Any> rememberSingle(single: Single<T>): State<T?> {
    LaunchedEffect(single) { single.need() }
    return single.value.collectAsStateWithLifecycle()
}
