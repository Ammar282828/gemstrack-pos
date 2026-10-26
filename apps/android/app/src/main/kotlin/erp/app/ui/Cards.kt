package erp.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.layout.Layout
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType

// MARK: Cards

// Material You: a card is a tonal surface (surfaceContainer on the page's surface), never a shadow or a hairline.

/**
 * Content on the scheme's card tone: the padding and corner every ledger card shares. [lit] is "yours" (the person's own
 * order or sale): a short bar of the primary at the leading edge, as a list row has it (`mineRow`), never an outline or a wash.
 */
@Composable
fun Modifier.ledgerCard(padding: Dp = 16.dp, lit: Boolean = false): Modifier =
    fillMaxWidth().houseCardSurface(lit).padding(padding)

/** The card's surface: the extraLarge shape on `surfaceContainer`. Flat: lifted by tone, not by a shadow. */
@Composable
fun Modifier.houseCardSurface(lit: Boolean = false): Modifier =
    clip(Radius.cardShape).background(ErpColors.card).then(if (lit) Modifier.mineBar() else Modifier)

/**
 * A titled card: [LedgerHeading] over the content, on the scheme's card tone. Use it for a block of figures or free
 * content on a page of cards (a list of rows uses [LedgerSection], which draws each row as its own tile).
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
 * The one hero card of a screen, in place of [ledgerCard]: the scheme's primary container, as Material 3 Expressive
 * marks the one thing a screen is about. Once per screen; every other card is a [ledgerCard].
 */
@Composable
fun Modifier.heroSheen(padding: Dp = 16.dp): Modifier =
    fillMaxWidth().clip(Radius.cardShape).background(MaterialTheme.colorScheme.primaryContainer).padding(padding)

/** A dashed hairline, like the tear on a receipt: between a bill's lines and its totals. */
@Composable
fun PerforationDivider(modifier: Modifier = Modifier) {
    val line = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(1.dp).clearAndSetSemantics {}) {
        drawLine(
            line, Offset(0f, size.height / 2), Offset(size.width, size.height / 2),
            strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
        )
    }
}

// MARK: Sections of rows

/** A row inside a [LedgerSection]: the tile's own inset and a comfortable height. */
fun Modifier.ledgerRow(): Modifier = defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp)

/**
 * The line between two rows. In a segmented group ([LedgerSection], [FormSection]) it is only a marker: the gap between
 * two tiles is the line. In a plain card it is the hairline it always was.
 */
@Composable
fun LedgerDivider(modifier: Modifier = Modifier) {
    if (LocalInSegments.current) {
        Layout({}, modifier.segmentGap()) { _, _ -> layout(0, 0) {} }
    } else {
        HorizontalDivider(modifier.padding(start = 16.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/**
 * Secondary pages use the same headings and row surfaces as the main ledger: the name over a group of rows, each its
 * own tile (give each row [ledgerRow]; a [LedgerDivider] between is optional), with an optional footnote under it.
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
            CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
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
                // The rows are tiles one step up from the card they sit in, with a 4 dp margin as a card holds its rows.
                Column(Modifier.padding(start = 4.dp, end = 4.dp, bottom = 4.dp)) {
                    SegmentedColumn(color = MaterialTheme.colorScheme.surfaceContainerHigh, outer = Radius.chip, content = content)
                    foot()
                }
            }
        }
    } else {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerHeading(title, Modifier.padding(horizontal = 16.dp))
            SegmentedColumn(content = content)
            foot()
        }
    }
}
