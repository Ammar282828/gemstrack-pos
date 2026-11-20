package erp.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// The success moment at the end of a sale, an order and a payment (owner 2026-11-19, "Motion principles, second pass";
// the web's `.done-tick`, the iPhone's `PeakTick`). The banner's own success tap comes with the note (NoteHost), so one
// event is felt once.

/** The tick's elbow and ends in a 24 x 24 box (Material's check, as Symbols.Check draws it). */
internal val TickPoints = listOf(Offset(6.5f, 12.5f), Offset(10.5f, 16.5f), Offset(17.5f, 8f))

/** The tick as a path in a [size]-px square. */
internal fun tickPath(size: Float): Path {
    val k = size / 24f
    return Path().apply {
        moveTo(TickPoints[0].x * k, TickPoints[0].y * k)
        lineTo(TickPoints[1].x * k, TickPoints[1].y * k)
        lineTo(TickPoints[2].x * k, TickPoints[2].y * k)
    }
}

/**
 * A filled circle with a check drawn into it: the stroke is trimmed from nothing to whole on the effects spring (it never
 * overshoots) while the circle lands from 50% on the spatial spring, which overshoots slightly. Under Reduce Motion the
 * finished tick is simply there. [disc] is the circle, [mark] the check's colour.
 */
@Composable
fun PeakTick(disc: Color, mark: Color, modifier: Modifier = Modifier) {
    val motion = rememberErpMotion()
    val landed = remember { Animatable(if (motion.reduce) 1f else 0.5f) }
    val drawn = remember { Animatable(if (motion.reduce) 1f else 0f) }
    LaunchedEffect(motion.reduce) {
        if (motion.reduce) {
            landed.snapTo(1f); drawn.snapTo(1f)
        } else {
            // The circle lands and the stroke follows a beat behind it, so the eye sees the disc arrive and the tick written.
            kotlinx.coroutines.coroutineScope {
                launch { landed.animateTo(1f, motion.spatial()) }
                launch { kotlinx.coroutines.delay(60); drawn.animateTo(1f, motion.slowEffects()) }
            }
        }
    }
    Canvas(modifier.size(24.dp).graphicsLayer { scaleX = landed.value; scaleY = landed.value }) {
        drawCircle(disc, radius = size.minDimension / 2f)
        val path = tickPath(size.minDimension)
        val measure = PathMeasure().also { it.setPath(path, false) }
        val part = Path()
        measure.getSegment(0f, measure.length * drawn.value.coerceIn(0f, 1f), part, true)
        drawPath(part, mark, style = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
