package erp.app.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.withTimeoutOrNull

/**
 * A card that gives under the thumb: 0.98 while pressed, a spring back on release. One modifier for every tappable
 * card and row, so the whole app answers a touch the same way. It watches without consuming (the click still goes
 * to the card), waits 90 ms before pressing so a scroll that starts on a card does not flicker it, and does nothing
 * with animations off. The scale is read in the layer, so a press never recomposes.
 */
@Composable
fun Modifier.pressScale(to: Float = 0.98f): Modifier {
    if (reduceMotion()) return this
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        if (pressed) to else 1f,
        spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
    return this
        .pointerInput(Unit) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                var ended = false
                withTimeoutOrNull(90) {
                    waitForUpOrCancellation(PointerEventPass.Initial)
                    ended = true
                }
                if (!ended) {
                    pressed = true
                    try {
                        waitForUpOrCancellation(PointerEventPass.Initial)
                    } finally {
                        pressed = false
                    }
                }
            }
        }
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
}
