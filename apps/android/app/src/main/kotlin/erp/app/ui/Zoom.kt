package erp.app.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale

/**
 * The two scopes a list->detail shared element needs: the `SharedTransitionLayout` around the navigation
 * and the `AnimatedContent` / `AnimatedVisibilityScope` of the screen being composed. Navigation provides them
 * ([ProvideSharedScopes]) around each destination; screens only use [zoomSource] and [zoomDestination].
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Stable
class SharedScopes(val shared: SharedTransitionScope, val visibility: AnimatedVisibilityScope)

val LocalSharedScopes = compositionLocalOf<SharedScopes?> { null }

@Composable
fun ProvideSharedScopes(shared: SharedTransitionScope, visibility: AnimatedVisibilityScope, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalSharedScopes provides SharedScopes(shared, visibility), content = content)
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Modifier.zoom(id: String, remeasure: Boolean): Modifier {
    val scopes = LocalSharedScopes.current ?: return this
    val reduce = reduceMotion()
    val transform = BoundsTransform { _, _ -> if (reduce) snap() else tween(Motion.TravelMillis, easing = Motion.TravelEasing) }
    return with(scopes.shared) {
        this@zoom.sharedBounds(
            sharedContentState = rememberSharedContentState(key = "zoom:$id"),
            animatedVisibilityScope = scopes.visibility,
            enter = fadeIn(Motion.enter(reduce)),
            exit = fadeOut(Motion.exit(reduce)),
            boundsTransform = transform,
            resizeMode = if (remeasure) {
                SharedTransitionScope.ResizeMode.RemeasureToBounds
            } else {
                SharedTransitionScope.ResizeMode.scaleToBounds(ContentScale.FillWidth)
            },
        )
    }
}

/**
 * On a row (or card) that opens a page: the page grows out of it. Use the destination's route path as the id.
 * Does nothing where navigation has not provided [LocalSharedScopes].
 */
@Composable
fun Modifier.zoomSource(id: String): Modifier = zoom(id, remeasure = false)

/**
 * On the page's root: it grows out of the row with the same id. Does nothing without [LocalSharedScopes];
 * with animations off the bounds simply change.
 */
@Composable
fun Modifier.zoomDestination(id: String): Modifier = zoom(id, remeasure = true)
