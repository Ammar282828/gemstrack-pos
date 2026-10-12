package erp.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import kotlin.math.max
import kotlin.math.min

// MARK: Figures

/**
 * One figure: a label, its value large, and a line under it. A tile grows with its words rather than clipping
 * the detail or shrinking the amount. [number] is the value as a number when there is one, so the figure rolls
 * up or down as it changes.
 */
@Composable
fun FigureTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    tint: Color = Color.Unspecified,
    number: Double = 0.0,
) {
    Column(modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        NumericText(value, number, style = ErpType.tileValue, color = tint, maxLines = Int.MAX_VALUE)
        if (!detail.isNullOrEmpty()) {
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** What a [FigureRow]'s content can ask of its place: [share] gives a figure its equal part of the row. */
@Stable
interface FigureScope {
    fun Modifier.share(): Modifier
}

private class SideBySide(private val row: RowScope) : FigureScope {
    override fun Modifier.share(): Modifier = with(row) { this@share.weight(1f) }
}

private object Stacked : FigureScope {
    override fun Modifier.share(): Modifier = this.fillMaxWidth()
}

/**
 * Figures stay side by side at ordinary sizes and read top to bottom at large text sizes. Put `Modifier.share()`
 * on each figure (a [FigureTile] takes a `modifier`).
 */
@Composable
fun FigureRow(
    modifier: Modifier = Modifier,
    spacing: Dp = 12.dp,
    verticalAlignment: Alignment.Vertical = Alignment.Top,
    content: @Composable FigureScope.() -> Unit,
) {
    if (isLargeText()) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing)) { Stacked.content() }
    } else {
        Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = verticalAlignment) {
            SideBySide(this).content()
        }
    }
}

/**
 * Figures in two to four columns by the width there is (a column per 240 dp), one at large text sizes. Tiles
 * in a row take the row's tallest height. Not lazy: it sits inside a page that scrolls.
 */
@Composable
fun FigureGrid(
    modifier: Modifier = Modifier,
    spacing: Dp = 12.dp,
    content: @Composable () -> Unit,
) {
    val large = isLargeText()
    val gap = with(LocalDensity.current) { spacing.roundToPx() }
    val minColumn = with(LocalDensity.current) { 240.dp.roundToPx() }
    Layout(content, modifier.fillMaxWidth()) { measurables, constraints ->
        val width = constraints.maxWidth
        val columns = if (large) 1 else max(2, min(4, width / minColumn))
        val cell = max(0, (width - gap * (columns - 1)) / columns)
        var y = 0
        val placements = mutableListOf<Triple<androidx.compose.ui.layout.Placeable, Int, Int>>()
        measurables.chunked(columns).forEachIndexed { rowIndex, row ->
            // Equal heights: the tallest natural height in the row is every tile's minimum.
            val rowHeight = row.maxOf { it.minIntrinsicHeight(cell) }
            val placed = row.map { it.measure(Constraints(minWidth = cell, maxWidth = cell, minHeight = rowHeight)) }
            val tallest = placed.maxOf { it.height }
            placed.forEachIndexed { col, p -> placements += Triple(p, col * (cell + gap), y) }
            y += tallest + if (rowIndex < (measurables.size - 1) / columns) gap else 0
        }
        layout(width, y) { placements.forEach { (p, x, py) -> p.placeRelative(x, py) } }
    }
}

// MARK: A row's two lines

/** A row's two lines: what it is, and what to know about it; the sum at the right, under it at large text. */
@Composable
fun TwoLine(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: String? = null,
    trailingTint: Color = Color.Unspecified,
    trailingLabel: String? = null,
) {
    val words: @Composable (Modifier) -> Unit = { m ->
        Column(m, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
            if (!subtitle.isNullOrEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    val amount: @Composable (Boolean) -> Unit = { start ->
        if (trailing != null) {
            Column(
                horizontalAlignment = if (start) Alignment.Start else Alignment.End,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    trailing,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                    color = if (trailingTint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else trailingTint,
                    textAlign = if (start) TextAlign.Start else TextAlign.End,
                )
                if (trailingLabel != null) {
                    Text(trailingLabel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    if (isLargeText()) {
        Column(modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            words(Modifier.fillMaxWidth())
            amount(true)
        }
    } else {
        Row(modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            words(Modifier.weight(1f))
            amount(false)
        }
    }
}

// MARK: Wide windows

/**
 * Columns of cards for a wide window: as many as fit at [minimum] each (at most [limit]), all the same width,
 * so a lone card keeps a card's width rather than stretching across a tablet.
 */
object CardColumns {
    fun count(width: Dp, minimum: Dp = 340.dp, spacing: Dp = 20.dp, limit: Int = 3): Int =
        max(1, min(limit, ((width.value + spacing.value) / (minimum.value + spacing.value)).toInt()))

    /** For a `LazyVerticalGrid`'s `columns`. */
    fun cells(width: Dp, minimum: Dp = 340.dp, spacing: Dp = 20.dp, limit: Int = 3): GridCells =
        GridCells.Fixed(count(width, minimum, spacing, limit))
}

/** Hands its content the number of card columns the space it is given has room for. */
@Composable
fun CardColumnsHost(
    modifier: Modifier = Modifier,
    minimum: Dp = 340.dp,
    spacing: Dp = 20.dp,
    limit: Int = 3,
    content: @Composable (columns: Int) -> Unit,
) {
    BoxWithConstraints(modifier) { content(CardColumns.count(maxWidth, minimum, spacing, limit)) }
}

/**
 * A page's rows in a readable column on a wide window (about 70 characters of a form), centred, the ground and
 * the scrolling still the whole window's. Phones are never touched: the limit is wider than they are.
 */
fun Modifier.readableColumn(maxWidth: Dp = 720.dp): Modifier = layout { measurable, constraints ->
    val limit = maxWidth.roundToPx()
    val width = min(constraints.maxWidth, limit)
    val placeable = measurable.measure(constraints.copy(minWidth = min(constraints.minWidth, width), maxWidth = width))
    val outer = if (constraints.hasBoundedWidth) constraints.maxWidth else placeable.width
    layout(outer, placeable.height) { placeable.placeRelative((outer - placeable.width) / 2, 0) }
}

@Composable
fun ReadableColumn(modifier: Modifier = Modifier, maxWidth: Dp = 720.dp, content: @Composable () -> Unit) {
    Box(modifier.readableColumn(maxWidth)) { content() }
}
