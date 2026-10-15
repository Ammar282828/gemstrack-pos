package erp.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** How many rows of a list get to arrive; the rest are simply there. */
private const val APPEAR_ROWS = 6

/**
 * A list's first rows rise 12 dp and fade in, 40 ms apart, the first time the list is shown (the books arriving over
 * the skeleton) and never again: the played flag is saved with the row, so scrolling back, returning from a page or
 * a recomposition shows it still. Only the first six rows move. Off with animations off; layer-only, no recomposition.
 */
@Composable
fun Modifier.appearOnce(index: Int): Modifier {
    if (index >= APPEAR_ROWS || reduceMotion()) return this
    var played by rememberSaveable { mutableStateOf(false) }
    val progress = remember { Animatable(if (played) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!played) {
            delay(index * 40L)
            progress.animateTo(1f, Motion.enter())
            played = true
        }
    }
    return graphicsLayer {
        val p = progress.value
        if (p < 1f) {
            alpha = p
            translationY = (1f - p) * 12.dp.toPx()
        }
    }
}
