package erp.app.ui

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * The lists whose rows have come in once since the app launched (owner 2026-11-19, "Motion principles, second pass"): a list used
 * all day shows its rows at once after the first time, whatever navigation did to the screen in between. A list is named by [plays]'
 * key ("invoices", "customers"); its first row to ask opens a short window in which the rest of its first rows may still play, and
 * after the window nothing on it plays again this launch, a row scrolled into view later included.
 */
object FirstShow {
    private val opened = HashMap<String, Long>()

    /** How long after a list's first row a row may still play: the first six rows are in well inside it. */
    const val WINDOW_MILLIS = 500L

    /** True while [list]'s first showing is under way (and, with [now] given, only inside the window); false for ever after. */
    fun plays(list: String, now: Long = SystemClock.uptimeMillis()): Boolean = synchronized(opened) {
        now - opened.getOrPut(list) { now } < WINDOW_MILLIS
    }

    /** For tests: forget what has been shown. */
    internal fun reset() = synchronized(opened) { opened.clear() }
}

/**
 * A list's first rows rise 12 dp and fade in on the theme's spatial spring, 30 ms apart ([ErpMotion.APPEAR_STAGGER_MILLIS]), the
 * first time the list ([list], see [FirstShow]) is shown in this launch and never again on it: leaving for a page and coming back, a
 * tab switched away from and to, scrolling back, a recomposition, all show the rows still. Only the first six rows move
 * ([ErpMotion.appearDelay]). Off under Reduce Motion (animator scale 0); layer-only, no recomposition.
 */
@Composable
fun Modifier.appearOnce(index: Int, list: String): Modifier {
    val motion = rememberErpMotion()
    val delayMillis = ErpMotion.appearDelay(index)
    if (delayMillis == null || motion.reduce) return this
    // Decided once for this row, when it is first composed; a row composed after the window never plays.
    val plays = remember { FirstShow.plays(list) }
    if (!plays) return this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(delayMillis)
        progress.animateTo(1f, motion.spatial())
    }
    return graphicsLayer {
        val p = progress.value
        if (p < 1f) {
            // The spring may overshoot past 1; the row's opacity never does.
            alpha = p.coerceIn(0f, 1f)
            translationY = (1f - p) * 12.dp.toPx()
        }
    }
}
