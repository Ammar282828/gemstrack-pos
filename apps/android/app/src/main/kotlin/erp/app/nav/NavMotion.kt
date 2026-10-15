package erp.app.nav

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.scene.Scene
import erp.app.ui.Motion
import erp.app.ui.ZoomRegistry

/**
 * How a page arrives and leaves (docs/decisions.md "Motion": the ERP's curves, 150-400 ms, nothing when animations
 * are off). Three kinds:
 *  - a page whose row morphs into it (a `zoomSource` with the page's path was shown): the page grows out of the row
 *    and shrinks back on Back; the pages around it only fade, so the container is the one thing that travels;
 *  - any other page: Material's shared axis on X, 30 dp and a fade, reversed on Back;
 *  - the back gesture: the same pair, scrubbed by the finger. Without a row to return to, the page scales toward
 *    0.9 with rounded corners and slides off its edge, as Android's own predictive back does.
 */
internal class NavMotion(private val reduce: Boolean, private val density: Density) {
    private val none = ContentTransform(EnterTransition.None, ExitTransition.None)
    private val slide = tween<androidx.compose.ui.unit.IntOffset>(Motion.TravelMillis, easing = Motion.TravelEasing)

    // Material's shared axis on X, as Google's own apps open and close pages on Android: the pages move 30 dp, and
    // fade *through* (the old one gone in the first 35%, the new one in over the rest), so never both at once.
    private val axis get() = with(density) { 30.dp.roundToPx() }
    private val move = tween<androidx.compose.ui.unit.IntOffset>(300, easing = Motion.TravelEasing)
    private val outFade = tween<Float>(105, easing = androidx.compose.animation.core.FastOutLinearInEasing)
    private val inFade = tween<Float>(195, delayMillis = 105, easing = androidx.compose.animation.core.LinearOutSlowInEasing)

    /** Open: in from the right, the old page out to the left. */
    fun push(s: AnimatedContentTransitionScope<Scene<NavKey>>): ContentTransform = with(s) {
        BackGesture.end()
        if (reduce) return none
        ContentTransform(
            slideInHorizontally(move) { axis } + fadeIn(inFade),
            slideOutHorizontally(move) { -axis } + fadeOut(outFade),
            targetContentZIndex = 1f,
        )
    }

    /** Back (the button): the same axis reversed. */
    fun pop(s: AnimatedContentTransitionScope<Scene<NavKey>>): ContentTransform = with(s) {
        BackGesture.end()
        if (reduce) return none
        ContentTransform(
            slideInHorizontally(move) { -axis } + fadeIn(inFade),
            slideOutHorizontally(move) { axis } + fadeOut(outFade),
            targetContentZIndex = -1f,
        )
    }

    /**
     * The back gesture, scrubbed by the finger as Android's own predictive back: the page shrinks a little with rounded
     * corners and drifts away from the edge the gesture started at; the page beneath is solid the whole time. Letting
     * go finishes the slide off; pulling back cancels it.
     */
    fun predictivePop(s: AnimatedContentTransitionScope<Scene<NavKey>>, edge: Int): ContentTransform = with(s) {
        if (reduce) return none
        BackGesture.begin(toRight = edge == 0)
        // The page's own movement is drawn by RoundedOnExit from the transition's clock (BackGesture.draw); the page
        // beneath is solid and drifts in a little, linearly, so it moves with the finger.
        ContentTransform(
            slideInHorizontally(tween(BackGesture.Millis, easing = androidx.compose.animation.core.LinearEasing)) { w ->
                if (BackGesture.toRight) -w / 12 else w / 12
            },
            ExitTransition.KeepUntilTransitionsFinished,
            targetContentZIndex = -1f,
        )
    }
}

/**
 * The back gesture as Android draws its own (predictive back): while the finger moves, the page only shrinks to 90%,
 * rounds its corners and nudges a few percent toward the finger's side; it leaves only once the finger lets go, and
 * springs back if the swipe is cancelled. The transition's timeline is the gesture's progress: the first 60% is the
 * drag (where a swipe actually lives), the rest is the page leaving after release.
 */
internal object BackGesture {
    const val Millis = 450
    var active by androidx.compose.runtime.mutableStateOf(false)
        private set
    var toRight by androidx.compose.runtime.mutableStateOf(true)
        private set

    fun begin(toRight: Boolean) { active = true; this.toRight = toRight }
    fun end() { active = false }

    private const val DRAG = 0.6f

    /** [p] 0 (resting) .. 1 (gone). */
    fun draw(scope: androidx.compose.ui.graphics.GraphicsLayerScope, p: Float, cornerPx: Float) = with(scope) {
        val drag = (p / DRAG).coerceIn(0f, 1f)
        val eased = 1f - (1f - drag) * (1f - drag) // decelerating, as the finger slows
        val leave = ((p - DRAG) / (1f - DRAG)).coerceIn(0f, 1f)
        val sign = if (toRight) 1f else -1f
        val s = 1f - 0.1f * eased
        scaleX = s
        scaleY = s
        translationX = sign * (size.width * 0.04f * eased + size.width * leave * leave)
        alpha = if (leave > 0.7f) 1f - (leave - 0.7f) / 0.3f else 1f
        clip = true
        shape = RoundedCornerShape(cornerPx * eased)
    }
}

/**
 * Draws a page leaving by the back gesture (BackGesture.draw), on the transition's own clock, so the finger scrubs it.
 * Layer-only: no recomposition, and nothing at rest or for any other transition.
 */
@Composable
internal fun RoundedOnExit(scope: AnimatedContentScope, enabled: Boolean, content: @Composable () -> Unit) {
    if (!enabled) return content()
    val progress by scope.transition.animateFloat(
        transitionSpec = { tween(BackGesture.Millis, easing = androidx.compose.animation.core.LinearEasing) },
        label = "backGesture",
    ) { state -> if (state == EnterExitState.PostExit) 1f else 0f }
    val corner = with(androidx.compose.ui.platform.LocalDensity.current) { 32.dp.toPx() }
    Box(
        Modifier.graphicsLayer {
            if (BackGesture.active && progress > 0f) BackGesture.draw(this, progress, corner)
        },
    ) { content() }
}
