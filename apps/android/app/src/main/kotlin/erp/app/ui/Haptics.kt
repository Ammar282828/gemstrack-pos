package erp.app.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView

/**
 * The phone's taps (the iPhone's `sensoryFeedback`): CONFIRM and REJECT where the system has them (API 30),
 * the nearest older constant otherwise. Nothing here needs the VIBRATE permission.
 */
class Haptics(private val view: View) {
    fun success() = perform(
        if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP,
    )

    fun failure() = perform(
        if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS,
    )

    /** A warning as a destructive step is reached (the delete code asked, a refund confirmed). */
    fun warning() = failure()

    /** A light tick as a choice changes (a chip, a step). */
    fun selection() = perform(
        if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK,
    )

    /** The system's switch tick (API 34 has an on and an off), the segment tick before it. */
    fun toggle(on: Boolean) = perform(
        when {
            Build.VERSION.SDK_INT >= 34 -> if (on) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.TOGGLE_OFF
            else -> HapticFeedbackConstants.CLOCK_TICK
        },
    )

    private fun perform(constant: Int) {
        view.performHapticFeedback(constant)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}

/** Runs [block] when [key] changes, never for the value it first has. */
@Composable
internal fun OnChange(key: Any?, block: () -> Unit) {
    var seen by remember { mutableStateOf(key) }
    LaunchedEffect(key) {
        if (seen != key) {
            seen = key
            block()
        }
    }
}

/**
 * A tap for money (`.moneyFeedback`): success when [success] changes, an error when [failure] changes. Pass values
 * that change only on the event (a counter bumped on a taken payment, a failure message set), never one that
 * also changes while typing.
 */
@Composable
fun MoneyFeedback(success: Any?, failure: Any?) {
    val haptics = rememberHaptics()
    OnChange(success) { haptics.success() }
    OnChange(failure) { haptics.failure() }
}

/** A warning tap as a destructive step is reached (`.destructiveFeedback`). */
@Composable
fun DestructiveFeedback(trigger: Any?) {
    val haptics = rememberHaptics()
    OnChange(trigger) { haptics.warning() }
}

/** A light tick as [trigger] changes (`.sensoryFeedback(.selection)`). */
@Composable
fun SelectionFeedback(trigger: Any?) {
    val haptics = rememberHaptics()
    OnChange(trigger) { haptics.selection() }
}
