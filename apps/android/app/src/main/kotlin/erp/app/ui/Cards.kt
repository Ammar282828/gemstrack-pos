package erp.app.ui

import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType

// MARK: Cards

/** Content on the house's card: the padding and corner every ledger card shares. */
@Composable
fun Modifier.ledgerCard(padding: Dp = 16.dp): Modifier =
    fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(padding)

/**
 * A titled card: [LedgerHeading] over the content, on the house's card. Use it for a block of rows or figures
 * on a page of cards (a list of rows uses [LedgerSection]).
 */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    trailing: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LedgerHeading(title, count = count, trailing = trailing)
        content()
    }
}

/**
 * The one hero card of a screen, in place of [ledgerCard]: a faint wash of the house's accent from the top
 * corner, a hairline edge and, now and then, a slow light across it. Still when animations are off. Once per
 * screen; every other card is a [ledgerCard].
 */
@Composable
fun Modifier.heroSheen(padding: Dp = 16.dp): Modifier {
    val accent = ErpColors.accent
    val reduce = reduceMotion()
    // One pass of light when the card first appears, then it rests: nothing on a screen loops.
    val phase = remember { Animatable(if (reduce) 1f else 0f) }
    if (!reduce) LaunchedEffect(Unit) { phase.animateTo(1f, tween(1100, delayMillis = 250, easing = Motion.TravelEasing)) }
    return fillMaxWidth()
        .clip(Radius.cardShape)
        .background(ErpColors.card)
        .drawBehind {
            drawRect(Brush.linearGradient(listOf(accent.copy(alpha = 0.10f), Color.Transparent), Offset.Zero, Offset(size.width * 0.5f, size.height * 0.5f)))
            val t = phase.value
            if (t < 1f) {
                val x = -size.width * 0.5f + (size.width * 2f) * t
                drawRect(
                    Brush.linearGradient(
                        listOf(Color.Transparent, accent.copy(alpha = 0.07f), Color.Transparent),
                        Offset(x, 0f), Offset(x + size.width * 0.5f, size.height * 0.5f),
                    ),
                )
            }
        }
        .border(BorderStroke(0.5.dp, accent.copy(alpha = 0.18f)), Radius.cardShape)
        .padding(padding)
}

/** A dashed hairline, like the tear on a receipt: between a bill's lines and its totals. */
@Composable
fun PerforationDivider(modifier: Modifier = Modifier) {
    val line = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.25f)
    Canvas(modifier.fillMaxWidth().height(1.dp).clearAndSetSemantics {}) {
        drawLine(
            line, Offset(0f, size.height / 2), Offset(size.width, size.height / 2),
            strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
        )
    }
}

// MARK: Sections of rows

/** A row inside a [LedgerSection]: the card's own inset and a comfortable height. */
fun Modifier.ledgerRow(): Modifier = defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp)

/** The line between two rows of a [LedgerSection]. */
@Composable
fun LedgerDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier.padding(start = 16.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Secondary pages use the same headings and row surfaces as the main ledger: the name over a card of rows
 * (give each row [ledgerRow] and put a [LedgerDivider] between), with an optional footnote under it.
 * [collapsible] folds the rows under their title.
 */
@Composable
fun LedgerSection(
    title: String,
    modifier: Modifier = Modifier,
    collapsible: Boolean = false,
    footer: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val reduce = reduceMotion()
    val foot: @Composable () -> Unit = {
        if (footer != null) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                androidx.compose.material3.ProvideTextStyle(MaterialTheme.typography.bodySmall) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { footer() }
                }
            }
        }
    }
    if (collapsible) {
        var open by rememberSaveable(title) { mutableStateOf(true) }
        Column(modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 56.dp)
                    .clickable(role = Role.Button) { open = !open }
                    .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, Modifier.weight(1f), style = ErpType.heading, color = MaterialTheme.colorScheme.onSurface)
                Icon(
                    Icons.Filled.ExpandMore, contentDescription = null,
                    Modifier.rotate(if (open) 0f else -90f),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            AnimatedVisibility(
                open,
                enter = expandVertically(Motion.enter(reduce)) + fadeIn(Motion.enter(reduce)),
                exit = shrinkVertically(Motion.exit(reduce)) + fadeOut(Motion.exit(reduce)),
            ) {
                Column { content(); foot() }
            }
        }
    } else {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerHeading(title, Modifier.padding(horizontal = 4.dp))
            Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) { content() }
            foot()
        }
    }
}
