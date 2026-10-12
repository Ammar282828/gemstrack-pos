package erp.app.ui

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.animateContentSize
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
 * How the app moves: the ERP's three curves (docs/decisions.md "Motion"), so a filter, a reveal or a figure
 * changes here at the pace it does in the browser. With animations removed there is no movement, only the change.
 *
 * Every function takes `reduce` (from [reduceMotion]); with it set the spec is a `snap()`.
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

/** The card, a size change in it, eased on the enter curve, or not at all under [reduceMotion]. */
@Composable
fun Modifier.motionContentSize(): Modifier {
    val reduce = reduceMotion()
    return if (reduce) this else animateContentSize(Motion.enter())
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
