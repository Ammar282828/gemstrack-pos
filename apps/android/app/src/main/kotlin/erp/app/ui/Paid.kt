package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money

/** What has been paid of a total, as a thin bar: the house's accent while owed, green once settled. */
@Composable
fun PaidBar(paid: Double, total: Double, modifier: Modifier = Modifier) {
    val whole = maxOf(total, 1.0)
    val done = total - paid < 1
    val reduce = reduceMotion()
    val progress by animateFloatAsState(
        (paid.coerceIn(0.0, whole) / whole).toFloat(), Motion.travel(reduce), label = "paidBar",
    )
    val spoken = if (done) "Paid in full" else "Paid ${Money.pkr(paid)} of ${Money.pkr(total)}"
    LinearProgressIndicator(
        progress = { progress },
        modifier = modifier.fillMaxWidth().height(4.dp).clearAndSetSemantics { contentDescription = spoken },
        color = if (done) Tone.settled.fill() else ErpColors.accent,
        trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
        gapSize = 0.dp,
        drawStopIndicator = {},
    )
}

/**
 * What has been paid of a total, as a ring: the house's accent while owed, green with a tick once settled.
 * The ring travels on the kit's curve; with animations off it jumps and the tick does not bounce.
 */
@Composable
fun PaidRing(paid: Double, total: Double, modifier: Modifier = Modifier, size: Dp = 64.dp) {
    val settled = total > 0 && total - paid < 1
    val fraction = if (total > 0) (paid / total).coerceIn(0.0, 1.0).toFloat() else 0f
    val reduce = reduceMotion()
    val colour = if (settled) Tone.settled.fill() else ErpColors.accent
    val track = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f)
    val sweep by animateFloatAsState(fraction, Motion.travel(reduce), label = "paidRing")

    // The tick is always in the tree so the bounce has an image to play on when it turns on.
    val bounce = remember { Animatable(1f) }
    var wasSettled by remember { mutableStateOf(settled) }
    LaunchedEffect(settled) {
        if (settled && !wasSettled && !reduce) {
            bounce.animateTo(1.3f, tween(110))
            bounce.animateTo(1f, spring(Spring.DampingRatioMediumBouncy))
        }
        wasSettled = settled
    }

    val spoken = "Paid ${Money.pkr(paid)} of ${Money.pkr(total)}"
    Box(modifier.size(size).padding(3.5.dp).clearAndSetSemantics { contentDescription = spoken }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val stroke = 7.dp.toPx()
            val inset = stroke / 2
            val arc = Size(this.size.width - stroke, this.size.height - stroke)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = Offset(inset, inset), size = arc, style = Stroke(stroke))
            drawArc(colour, -90f, 360f * sweep, useCenter = false, topLeft = Offset(inset, inset), size = arc, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Icon(
            Symbols.Check, contentDescription = null,
            Modifier.size(size * 0.36f).scale(bounce.value),
            tint = colour.copy(alpha = if (settled) 1f else 0f),
        )
    }
}

/** Total · Paid · Due (or In credit): the three sums of an order or an invoice, side by side, over the bar. */
@Composable
fun MoneySplit(
    total: Double,
    paid: Double,
    /** What is still owed; below zero is the customer's credit. */
    due: Double,
    modifier: Modifier = Modifier,
    totalLabel: String = "Total",
    paidLabel: String = "Paid",
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Cell(totalLabel, total, Money.pkr(total), MaterialTheme.colorScheme.onSurface, Alignment.Start, Modifier.weight(1f))
            Cell(paidLabel, paid, Money.pkr(paid), MaterialTheme.colorScheme.onSurfaceVariant, Alignment.CenterHorizontally, Modifier.weight(1f))
            when {
                due <= -1 -> Cell("In credit", -due, Money.pkr(-due), Tone.credit.color(), Alignment.End, Modifier.weight(1f))
                due >= 1 -> Cell("Due", due, Money.pkr(due), Tone.owed.color(), Alignment.End, Modifier.weight(1f))
                else -> Cell("Due", 0.0, "Nil", Tone.settled.color(), Alignment.End, Modifier.weight(1f))
            }
        }
        PaidBar(paid, total)
    }
}

@Composable
private fun Cell(label: String, amount: Double, value: String, tint: Color, align: Alignment.Horizontal, modifier: Modifier) {
    Column(modifier, horizontalAlignment = align, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = when (align) {
                Alignment.End -> TextAlign.End
                Alignment.CenterHorizontally -> TextAlign.Center
                else -> TextAlign.Start
            },
        )
        NumericText(
            value, amount,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = tint,
            autoSize = true,
        )
    }
}
