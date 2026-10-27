package erp.app.ui

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.Stable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode

/**
 * The web's three curves (docs/decisions.md "Motion"). The Android app no longer moves on them: it moves on the theme's
 * Material 3 Expressive springs ([ErpMotion]). What is left here is read only by the inert shared-element code (Zoom.kt).
 */
object Motion {
    /** ease-enter (0.22, 1, 0.36, 1): what arrives, a revealed row, a chosen filter's results. */
    val EnterEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

    /** ease-exit (0.4, 0, 1, 1): what leaves. */
    val ExitEasing = CubicBezierEasing(0.4f, 0f, 1f, 1f)

    /** ease-sheet (0.32, 0.72, 0, 1): what travels across the page. */
    val TravelEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

    const val EnterMillis = 220
    const val ExitMillis = 150
    const val TravelMillis = 300

    fun <T> enter(reduce: Boolean = false): FiniteAnimationSpec<T> =
        if (reduce) snap() else tween(EnterMillis, easing = EnterEasing)

    fun <T> exit(reduce: Boolean = false): FiniteAnimationSpec<T> =
        if (reduce) snap() else tween(ExitMillis, easing = ExitEasing)

    fun <T> travel(reduce: Boolean = false): FiniteAnimationSpec<T> =
        if (reduce) snap() else tween(TravelMillis, easing = TravelEasing)
}

/** Whether the person asked for less motion; [ErpTheme][erp.app.ui.theme.ErpTheme] provides it. */
val LocalReduceMotion = staticCompositionLocalOf { false }

/**
 * Animations are off (Developer options' animator scale at 0, which Accessibility's "Remove animations" also sets).
 * Screens pass it on to [Motion] and to anything they animate; the kit already honours it.
 */
@Composable
fun reduceMotion(): Boolean = LocalReduceMotion.current

/** A size change in the card, on the spatial spring, or not at all under [reduceMotion]. */
@Composable
fun Modifier.motionContentSize(): Modifier {
    val motion = rememberErpMotion()
    return if (motion.reduce) this else animateContentSize(motion.spatial())
}

/**
 * How the app moves (Material 3 Expressive, owner 2026-10-27: "add proper Material You animations"). Every spec is the theme's
 * [MotionScheme] (`MotionScheme.expressive()`, set in `ErpTheme`), never a tween picked here: spatial springs for what moves or
 * resizes (they overshoot a little), effects springs for colour and opacity (they never do). Get one with [rememberErpMotion]
 * where the content is composed and hand it to `AnimatedContent`/`AnimatedVisibility` specs, which are not composable.
 * Under Reduce Motion (animator scale 0) every spec is a `snap()` and every transition is `None`: only the change.
 *
 * Pages are not here on purpose: a pushed page is an Activity and Android draws its transition and predictive Back.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Stable
class ErpMotion internal constructor(
    val reduce: Boolean,
    private val scheme: MotionScheme,
    private val axisPx: Float,
) {
    /** Moves and resizes: a card growing, a page's tab sliding, a row arriving. */
    fun <T> spatial(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.defaultSpatialSpec()
    fun <T> fastSpatial(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.fastSpatialSpec()
    fun <T> slowSpatial(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.slowSpatialSpec()

    /** Colour and opacity: a pill's colour, a fade, a figure's cross-fade. */
    fun <T> effects(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.defaultEffectsSpec()
    fun <T> fastEffects(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.fastEffectsSpec()
    fun <T> slowEffects(): FiniteAnimationSpec<T> = if (reduce) snap() else scheme.slowEffectsSpec()

    /** A section opening: its height on the spatial spring, its words fading in behind it. */
    val expandIn: EnterTransition
        get() = if (reduce) EnterTransition.None else expandVertically(spatial()) + fadeIn(effects())

    /** A section folding: the height shrinks on the spatial spring while the words go quickly. */
    val collapseOut: ExitTransition
        get() = if (reduce) ExitTransition.None else shrinkVertically(spatial()) + fadeOut(fastEffects())

    /** The same sideways (a chip's check making room for itself). */
    val expandInX: EnterTransition
        get() = if (reduce) EnterTransition.None else expandHorizontally(spatial()) + fadeIn(effects())

    val collapseOutX: ExitTransition
        get() = if (reduce) ExitTransition.None else shrinkHorizontally(spatial()) + fadeOut(fastEffects())

    /** Something small arriving in place (a count, a check): a scale up from [from] with its fade. */
    fun popIn(from: Float = 0.6f): EnterTransition =
        if (reduce) EnterTransition.None else scaleIn(spatial(), initialScale = from) + fadeIn(effects())

    fun popOut(to: Float = 0.6f): ExitTransition =
        if (reduce) ExitTransition.None else scaleOut(fastSpatial(), targetScale = to) + fadeOut(fastEffects())

    /** A banner or toast from an edge: [fromTop] slides down from above, otherwise up from below. */
    fun slideIn(fromTop: Boolean): EnterTransition =
        if (reduce) fadeIn(snap()) else slideInVertically(spatial()) { if (fromTop) -it else it } + fadeIn(effects())

    fun slideOut(toTop: Boolean): ExitTransition =
        if (reduce) fadeOut(snap()) else slideOutVertically(fastSpatial()) { if (toTop) -it else it } + fadeOut(fastEffects())

    /**
     * Material's fade through, for peers (the tabs): the old one fades out quickly (about 90 ms, the fast effects spring), the new
     * one fades in and grows from 92% on the spatial spring.
     */
    fun fadeThrough(): ContentTransform =
        if (reduce) ContentTransform(EnterTransition.None, ExitTransition.None)
        else (fadeIn(effects()) + scaleIn(spatial(), initialScale = FADE_THROUGH_SCALE))
            .togetherWith(fadeOut(fastEffects()))

    /** A plain cross-fade on the effects spring (a state replacing another in place: books arriving over the skeleton). */
    fun crossFade(): ContentTransform =
        if (reduce) ContentTransform(EnterTransition.None, ExitTransition.None)
        else fadeIn(effects()).togetherWith(fadeOut(fastEffects()))

    /**
     * Material's shared axis, Y: the step moves 30 dp on its axis as it fades, forward (down the page: Continue) or back; the
     * container resizes on the spatial spring. For steps of one task (New order's Customer, Pieces, Payment, Review).
     */
    fun sharedAxisY(forward: Boolean): ContentTransform = sharedAxis(forward, vertical = true)

    /** Shared axis, X: for peers of one set side by side (the sections of a picker, Sources | Kinds, a period). */
    fun sharedAxisX(forward: Boolean): ContentTransform = sharedAxis(forward, vertical = false)

    private fun sharedAxis(forward: Boolean, vertical: Boolean): ContentTransform {
        if (reduce) return ContentTransform(EnterTransition.None, ExitTransition.None)
        val shift = axisPx.toInt()
        val into = if (forward) shift else -shift
        val enter = fadeIn(effects()) + if (vertical) slideInVertically(spatial()) { into } else slideInHorizontally(spatial()) { into }
        val exit = fadeOut(fastEffects()) + if (vertical) slideOutVertically(fastSpatial()) { -into } else slideOutHorizontally(fastSpatial()) { -into }
        val resize = SizeTransform(clip = false) { _, _ -> spatial() }
        return ContentTransform(enter, exit, sizeTransform = resize)
    }

    /** A figure that changes rolls: the new one in from [up] (it grew) or from below, the old one out the other way. */
    fun roll(up: Boolean): ContentTransform =
        if (reduce) ContentTransform(EnterTransition.None, ExitTransition.None)
        else ContentTransform(
            slideInVertically(spatial()) { h -> if (up) h / 3 else -h / 3 } + fadeIn(effects()),
            slideOutVertically(fastSpatial()) { h -> if (up) -h / 3 else h / 3 } + fadeOut(fastEffects()),
            sizeTransform = SizeTransform(clip = false) { _, _ -> snap() },
        )

    companion object {
        /** How far a shared axis moves, dp (Material's 30). */
        const val AXIS_DP = 30

        /** Where a fade through's arriving content starts. */
        const val FADE_THROUGH_SCALE = 0.92f

        /** The rows of a list that get to arrive on first paint, and the gap between them. */
        const val APPEAR_ROWS = 6
        const val APPEAR_STAGGER_MILLIS = 30L

        /** The wait before row [index] arrives; a row past the sixth does not arrive at all (null). */
        fun appearDelay(index: Int): Long? = if (index in 0 until APPEAR_ROWS) index * APPEAR_STAGGER_MILLIS else null

        /** Which way a step moves: later in the list is forward. */
        fun forward(from: Int, to: Int): Boolean = to >= from

        /** A figure that does not grow rolls down. */
        fun rollsUp(from: Double, to: Double): Boolean = to >= from
    }
}

/** The theme's motion, with Reduce Motion folded in. Remember it where content is composed; specs read it outside composition. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun rememberErpMotion(): ErpMotion {
    val reduce = reduceMotion()
    val scheme = MaterialTheme.motionScheme
    val density = LocalDensity.current
    return remember(reduce, scheme, density) { ErpMotion(reduce, scheme, with(density) { ErpMotion.AXIS_DP.dp.toPx() }) }
}

private fun animatorOff(context: Context): Boolean = try {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
} catch (e: Exception) {
    false
}

/** Reads the animator scale and follows it while the screen is up. */
@Composable
internal fun rememberSystemReduceMotion(): Boolean {
    val context = LocalContext.current
    if (LocalInspectionMode.current) return false
    var reduce by remember(context) { mutableStateOf(animatorOff(context)) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduce = animatorOff(context)
            }
        }
        context.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer,
        )
        reduce = animatorOff(context)
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return reduce
}

/**
 * Content that swaps in place along a shared axis (see [ErpMotion.sharedAxisX]): the list under Sources | Kinds, the words under
 * a period. [forward] says which way, from the old state to the new; the default is later = forward. [content] draws the state
 * it is handed, which is the leaving one while it leaves.
 */
@Composable
fun <T> AxisSwap(
    target: T,
    modifier: Modifier = Modifier,
    vertical: Boolean = false,
    forward: (from: T, to: T) -> Boolean = { _, _ -> true },
    content: @Composable (T) -> Unit,
) {
    val motion = rememberErpMotion()
    val next = if (vertical) motion.sharedAxisY(true) else motion.sharedAxisX(true)
    val back = if (vertical) motion.sharedAxisY(false) else motion.sharedAxisX(false)
    androidx.compose.animation.AnimatedContent(
        targetState = target,
        modifier = modifier,
        transitionSpec = { if (forward(initialState, targetState)) next else back },
        label = "axisSwap",
    ) { shown -> content(shown) }
}
