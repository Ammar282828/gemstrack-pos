package erp.app.nav

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.drawToBitmap
import erp.app.device.Foreground
import erp.app.ui.Motion
import erp.app.ui.reduceMotion
import kotlinx.coroutines.withTimeoutOrNull
import java.lang.ref.WeakReference

/**
 * The business switch as one smooth change (owner, 2026-11-03: "switching business through double tap is jittery"; the iPhone's
 * BusinessSwitchVeil.swift). A switch tears down the books and rebuilds the shell on the new id, and what the platform drew in
 * between (the old screens half-recomposed for the new business, the new Activity's blank window) was the jitter. So:
 *
 *  1. before anything changes, a picture of the window is taken and laid over it ([cover], called first thing in `Businesses.switchTo`);
 *     the old screens beneath it are dropped at once ([isFrozen], read by `AppShell`) so they are not recomposed for the new business
 *     on their way out: the one recomposition is the new shell's;
 *  2. the new shell starts with no platform transition (`AppRouter.restartShell`) and its window already wears the same picture
 *     ([adopt]), so there is no blank frame between the two Activities;
 *  3. once the new root has drawn a few frames the picture fades out on the app's travel curve ([BusinessSwitchVeilLayer]), and no
 *     later than a second, whatever is still loading. Under Reduce Motion it is simply taken away.
 */
object BusinessSwitchVeil {
    private var picture: Bitmap? = null
    private var covered: WeakReference<Activity>? = null
    private var overlay: WeakReference<View>? = null

    /** Bumped when a cover goes up, so a composition that asks [isFrozen] is asked again. */
    private var coverCount by mutableIntStateOf(0)

    private var coveredAt = 0L

    /** Whether a picture waits for the next shell to adopt (one older than a few seconds is a switch that never came: it is let go). */
    val pending: Boolean
        get() {
            if (picture != null && android.os.SystemClock.uptimeMillis() - coveredAt > 4000) release(null)
            return picture != null
        }

    /**
     * Lays a picture of the window in front over it. Does nothing (the switch goes without one) when there is no window, no
     * picture can be drawn, or one is already up.
     */
    fun cover() {
        if (pending) return
        val activity = Foreground.activity ?: return
        val decor = activity.window?.decorView as? ViewGroup ?: return
        if (decor.width <= 0 || decor.height <= 0) return
        val shot = runCatching { decor.drawToBitmap(Bitmap.Config.ARGB_8888) }.getOrNull() ?: return
        val view = ImageView(activity).apply {
            setImageBitmap(shot)
            scaleType = ImageView.ScaleType.FIT_XY
            // Nothing underneath can be touched while it is changing.
            isClickable = true
            isFocusable = false
        }
        decor.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        picture = shot
        coveredAt = android.os.SystemClock.uptimeMillis()
        covered = WeakReference(activity)
        overlay = WeakReference(view)
        coverCount += 1
    }

    /** Whether the screens of [context]'s Activity are the ones being switched away from (they draw nothing, under the picture). */
    @Composable
    fun isFrozen(context: Context): Boolean {
        @Suppress("UNUSED_VARIABLE") val read = coverCount
        val activity = activityOf(context) ?: return false
        return picture != null && covered?.get() === activity
    }

    private var adopted: Bitmap? = null
    private var before: android.graphics.drawable.Drawable? = null

    /**
     * Called as the next shell's Activity starts: its window wears the picture at once, so the first frame it shows is the picture, and
     * [BusinessSwitchVeilLayer] takes it from here. False for a start that is not a switch.
     */
    fun adopt(activity: Activity): Boolean {
        val shot = picture ?: return false
        // The Activity that was covered is on its way out; a start of the same Activity is not a new shell.
        if (covered?.get() === activity) return false
        before = activity.window.decorView.background
        activity.window.setBackgroundDrawable(android.graphics.drawable.BitmapDrawable(activity.resources, shot))
        adopted = shot
        return true
    }

    internal fun takeAdopted(): Bitmap? = adopted.also { adopted = null }

    /** The new shell has drawn and the picture has faded: the window is its own again, and everything the cover held is let go. */
    internal fun release(activity: Activity?) {
        activity?.window?.setBackgroundDrawable(before ?: android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
        before = null
        (overlay?.get())?.let { v -> (v.parent as? ViewGroup)?.removeView(v) }
        overlay = null
        covered = null
        picture = null
        coverCount += 1
    }

    private fun activityOf(context: Context): Activity? {
        var c: Context? = context
        while (c is ContextWrapper) {
            if (c is Activity) return c
            c = c.baseContext
        }
        return null
    }
}

/** The picture over the new shell, fading away once the shell has drawn. Place it last in the shell's box: it is the top layer. */
@Composable
fun BusinessSwitchVeilLayer() {
    val context = LocalContext.current
    val activity = remember(context) { var c: Context? = context; while (c is ContextWrapper && c !is Activity) c = c.baseContext; c as? Activity }
    val shot = remember { BusinessSwitchVeil.takeAdopted() } ?: return
    var gone by remember { mutableStateOf(false) }
    val alpha = remember { Animatable(1f) }
    val reduce = reduceMotion()
    LaunchedEffect(Unit) {
        // A few frames of the new root first (its shelves paint from the snapshot), and no later than a second.
        withTimeoutOrNull(1000) { repeat(3) { androidx.compose.runtime.withFrameNanos { } } }
        if (!reduce) alpha.animateTo(0f, tween(350, easing = Motion.TravelEasing))
        gone = true
        BusinessSwitchVeil.release(activity)
    }
    if (!gone) {
        Box(
            Modifier.fillMaxSize().alpha(alpha.value).background(MaterialTheme.colorScheme.surface)
                // Nothing underneath can be touched while it is changing.
                .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent().changes.forEach { it.consume() } } },
        ) {
            Image(shot.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
        }
    }
}
