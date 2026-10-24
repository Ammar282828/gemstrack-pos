package erp.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.data.Outbox

/**
 * What the person just did, shown before the books say so (the iPhone's `localStatus`, `localDone`, `patches`…).
 * A save through the Outbox leaves its screen at once, so the screen keeps the change here until the shelf agrees
 * with it ([reconcile]), and drops all of it when the Outbox says something did not save ([rememberLocalChanges]
 * clears on a new failure), so the screen never keeps showing what was not saved.
 */
@Stable
class LocalChanges<K : Any, V : Any> {
    private val map = mutableStateMapOf<K, V>()

    operator fun get(key: K): V? = map[key]

    operator fun set(key: K, value: V) { map[key] = value }

    fun remove(key: K) { map.remove(key) }

    fun clear() = map.clear()

    val isEmpty: Boolean get() = map.isEmpty()

    /** Every change as it stands (a read: the screen redraws when one moves). */
    val entries: List<Pair<K, V>> get() = map.entries.map { it.key to it.value }

    /** Drops what the books now agree with. */
    fun reconcile(agrees: (K, V) -> Boolean) {
        for ((k, v) in entries) if (agrees(k, v)) map.remove(k)
    }
}

@Composable
fun <K : Any, V : Any> rememberLocalChanges(): LocalChanges<K, V> {
    val local = remember { LocalChanges<K, V>() }
    val failure by Outbox.failure.collectAsStateWithLifecycle()
    OnChange(failure?.id) { local.clear() }
    return local
}
