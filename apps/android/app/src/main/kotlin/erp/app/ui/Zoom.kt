package erp.app.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.RememberObserver
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection

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

/**
 * What the morphs know of each other, kept outside composition (it is read while an overlay is clipped, per frame).
 * One source per id: an invoice listed twice on a page (Home's Needs you and Recent sales) lets the first one morph,
 * because two shared elements with one key in one scope is an error.
 */
object ZoomRegistry {
    private val owners = HashMap<String, Any>()
    private val heights = HashMap<String, Float>()
    private val seen = LinkedHashSet<String>()

    internal fun claim(id: String, token: Any): Boolean {
        val held = owners[id]
        if (held != null && held !== token) return false
        owners[id] = token
        if (seen.size > 600) seen.clear()
        seen.add(id)
        return true
    }

    internal fun release(id: String, token: Any) {
        if (owners[id] === token) owners.remove(id)
    }

    internal fun height(id: String): Float = heights[id] ?: 0f
    internal fun setHeight(id: String, h: Float) { heights[id] = h }

    /** A row has opened this path before: its page morphs out of the row (and back), instead of sliding in. */
    fun morphs(id: String?): Boolean = id != null && id in seen
}

/** A source's claim on its id, held for as long as it is composed. */
private class ZoomClaim(val id: String) : RememberObserver {
    val owns = ZoomRegistry.claim(id, this)
    override fun onRemembered() {}
    override fun onForgotten() = ZoomRegistry.release(id, this)
    override fun onAbandoned() = ZoomRegistry.release(id, this)
}

/**
 * The container's corner while it travels: the row's own radius, falling to square as the bounds grow to the page.
 * Worked out from the bounds' height between the row's and most of the screen's, so the corner and the size agree.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
private class MorphClip(val id: String, val cornerPx: Float, val screenHeight: () -> Float) : SharedTransitionScope.OverlayClip {
    override fun getClipPath(
        sharedContentState: SharedTransitionScope.SharedContentState,
        bounds: Rect,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Path? {
        val from = ZoomRegistry.height(id).takeIf { it > 0f } ?: (96f * density.density)
        val to = (screenHeight() * 0.9f).coerceAtLeast(from + 1f)
        val t = ((bounds.height - from) / (to - from)).coerceIn(0f, 1f)
        val smooth = t * t * (3f - 2f * t)
        val r = cornerPx * (1f - smooth)
        return Path().apply { addRoundRect(RoundRect(bounds, CornerRadius(r, r))) }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Modifier.zoom(id: String, source: Boolean, corner: Dp): Modifier {
    val scopes = LocalSharedScopes.current ?: return this
    val claim = if (source) remember(id) { ZoomClaim(id) } else null
    if (claim != null && !claim.owns) return this
    val reduce = reduceMotion()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val window = LocalWindowInfo.current
    val clip = remember(id, corner, density) { MorphClip(id, with(density) { corner.toPx() }) { window.containerSize.height.toFloat() } }
    val transform = BoundsTransform { _, _ -> if (reduce) snap() else tween(Motion.TravelMillis, easing = Motion.TravelEasing) }
    val shared = with(scopes.shared) {
        this@zoom.sharedBounds(
            sharedContentState = rememberSharedContentState(key = "zoom:$id"),
            animatedVisibilityScope = scopes.visibility,
            // The arriving content covers the leaving one before it lets go, so the moving shape is solid all the
            // way: in over the first half of the travel, out over the second (never both half-clear at once).
            enter = if (reduce) EnterTransition.None else fadeIn(tween(Motion.TravelMillis / 2, easing = Motion.EnterEasing)),
            exit = if (reduce) ExitTransition.None else fadeOut(tween(Motion.TravelMillis / 3, delayMillis = Motion.TravelMillis * 2 / 3, easing = Motion.ExitEasing)),
            boundsTransform = transform,
            resizeMode = if (source) {
                SharedTransitionScope.ResizeMode.scaleToBounds(ContentScale.FillWidth)
            } else {
                SharedTransitionScope.ResizeMode.RemeasureToBounds
            },
            clipInOverlayDuringTransition = clip,
        )
    }
    return if (source) shared.onSizeChanged { ZoomRegistry.setHeight(id, it.height.toFloat()) } else shared
}

/**
 * On a row (or card) that opens a page: the page grows out of it, and shrinks back into it on Back. Use the
 * destination's route path as the id. [corner] is the row's own radius (the card's by default). Does nothing where
 * navigation has not provided [LocalSharedScopes].
 */
@Composable
fun Modifier.zoomSource(id: String, corner: Dp = Radius.card): Modifier = zoom(id, source = true, corner = corner)

/**
 * On the page's root: it grows out of the row with the same id. Does nothing without [LocalSharedScopes];
 * with animations off the bounds simply change.
 */
@Composable
fun Modifier.zoomDestination(id: String, corner: Dp = Radius.card): Modifier = zoom(id, source = false, corner = corner)
