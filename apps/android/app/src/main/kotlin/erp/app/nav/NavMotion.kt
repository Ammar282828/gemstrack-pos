package erp.app.nav

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateDp
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

    private fun path(scene: Scene<NavKey>): String? = (scene.entries.lastOrNull()?.contentKey as? Route)?.path

    private val axis get() = with(density) { 30.dp.roundToPx() }

    private val enterFade = tween<Float>(Motion.EnterMillis, delayMillis = 70, easing = Motion.EnterEasing)
    private val exitFade = tween<Float>(Motion.ExitMillis, easing = Motion.ExitEasing)
    private val travel = tween<androidx.compose.ui.unit.IntOffset>(Motion.TravelMillis, easing = Motion.TravelEasing)

    fun push(s: AnimatedContentTransitionScope<Scene<NavKey>>): ContentTransform = with(s) {
        if (reduce) return none
        if (ZoomRegistry.morphs(path(targetState))) {
            ContentTransform(fadeIn(tween(Motion.EnterMillis, easing = Motion.EnterEasing)), fadeOut(exitFade), targetContentZIndex = 1f)
        } else {
            ContentTransform(
                slideInHorizontally(travel) { axis } + fadeIn(enterFade),
                slideOutHorizontally(travel) { -axis } + fadeOut(exitFade),
                targetContentZIndex = 1f,
            )
        }
    }

    fun pop(s: AnimatedContentTransitionScope<Scene<NavKey>>): ContentTransform = with(s) {
        if (reduce) return none
        if (ZoomRegistry.morphs(path(initialState))) {
            ContentTransform(fadeIn(tween(Motion.EnterMillis, easing = Motion.EnterEasing)), fadeOut(exitFade), targetContentZIndex = -1f)
        } else {
            ContentTransform(
                slideInHorizontally(travel) { -axis } + fadeIn(enterFade),
                slideOutHorizontally(travel) { axis } + fadeOut(exitFade),
                targetContentZIndex = -1f,
            )
        }
    }

    /** [edge] is the side the gesture starts from (0 left, 1 right): the page leaves toward the other. */
    fun predictivePop(s: AnimatedContentTransitionScope<Scene<NavKey>>, edge: Int): ContentTransform = with(s) {
        if (reduce) return none
        if (ZoomRegistry.morphs(path(initialState))) {
            // The page folds into its row (the shared bounds do it); only the fades are ours.
            ContentTransform(fadeIn(tween(Motion.EnterMillis, easing = Motion.EnterEasing)), fadeOut(exitFade), targetContentZIndex = -1f)
        } else {
            val toRight = edge == 0
            ContentTransform(
                fadeIn(tween(Motion.EnterMillis, easing = Motion.EnterEasing), initialAlpha = 0.6f),
                scaleOut(tween(Motion.TravelMillis, easing = Motion.TravelEasing), targetScale = 0.9f) +
                    slideOutHorizontally(travel) { w -> if (toRight) w / 10 else -w / 10 } +
                    fadeOut(tween(Motion.TravelMillis, easing = Motion.ExitEasing)),
                targetContentZIndex = -1f,
            )
        }
    }
}

/**
 * Gives a page that is leaving without a row to fold into rounded corners, on the transition's own clock, so the
 * back gesture's scrub rounds them as it goes. Layer-only: no recomposition, and no clip at rest.
 */
@Composable
internal fun RoundedOnExit(scope: AnimatedContentScope, enabled: Boolean, content: @Composable () -> Unit) {
    if (!enabled) return content()
    val radius by scope.transition.animateDp(
        transitionSpec = { tween(Motion.TravelMillis, easing = Motion.TravelEasing) },
        label = "pageCorner",
    ) { state -> if (state == EnterExitState.PostExit) 28.dp else 0.dp }
    Box(
        Modifier.graphicsLayer {
            val r = radius.toPx()
            if (r > 0.5f) {
                clip = true
                shape = RoundedCornerShape(r)
            }
        },
    ) { content() }
}
