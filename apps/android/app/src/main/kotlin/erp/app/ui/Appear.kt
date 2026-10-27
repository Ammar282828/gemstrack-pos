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

/**
 * A list's first rows rise 12 dp and fade in on the theme's spatial spring, 30 ms apart, the first time the list is shown
 * (the books arriving over the skeleton) and never again: the played flag is saved with the row, so scrolling back,
 * returning from a page or a recomposition shows it still. Only the first six rows move ([ErpMotion.appearDelay]).
 * Off with animations off; layer-only, no recomposition.
 */
@Composable
fun Modifier.appearOnce(index: Int): Modifier {
    val motion = rememberErpMotion()
    val delayMillis = ErpMotion.appearDelay(index)
    if (delayMillis == null || motion.reduce) return this
    var played by rememberSaveable { mutableStateOf(false) }
    val progress = remember { Animatable(if (played) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!played) {
            delay(delayMillis)
            progress.animateTo(1f, motion.spatial())
            played = true
        }
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
