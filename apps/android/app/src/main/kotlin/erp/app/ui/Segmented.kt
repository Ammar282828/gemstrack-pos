package erp.app.ui

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measured
import androidx.compose.ui.layout.VerticalAlignmentLine
import androidx.compose.ui.layout.ParentDataModifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors

// Android 16's grouped list: each row its own tonal tile with a small gap between, the group's outer corners large and the
// corners where two rows meet small. One layout draws it for every list of rows in the app (LedgerSection, FormSection,
// SettingsSection, Search), so a screen only says "these are the rows".

/** True inside a [SegmentedColumn]: there a [LedgerDivider] is the gap between two tiles, anywhere else a hairline. */
val LocalInSegments = compositionLocalOf { false }

/** What a [LedgerDivider] leaves in a [SegmentedColumn]'s children, so the layout can tell it from a row. */
private object GapMarker : ParentDataModifier {
    override fun Density.modifyParentData(parentData: Any?): Any = GapMarker
}

internal fun Modifier.segmentGap(): Modifier = this.then(GapMarker)

/** A column scope with nothing to give: the rows of a group are placed by the group. */
private object SegmentScope : ColumnScope {
    override fun Modifier.weight(weight: Float, fill: Boolean): Modifier = this
    override fun Modifier.align(alignment: Alignment.Horizontal): Modifier = this
    override fun Modifier.alignBy(alignmentLine: VerticalAlignmentLine): Modifier = this
    override fun Modifier.alignBy(alignmentLineBlock: (Measured) -> Int): Modifier = this
}

@Immutable
private class Tile(val top: Int, val height: Int, val shape: RoundedCornerShape)

/**
 * Every child is a tile on [color], [gap] apart; the first has [outer] corners on top, the last at the bottom, the rest
 * [joint] where they meet. One child is a lone tile with [outer] corners all round. A child that is a [LedgerDivider] is
 * only a marker (nothing is drawn for it), and a child with no height leaves no tile and no gap.
 *
 * The tile is drawn behind the child and the child is clipped to it, so a row's press ripple and its photo keep the corners.
 */
@Composable
fun SegmentedColumn(
    modifier: Modifier = Modifier,
    color: Color = ErpColors.card,
    outer: Dp = Radius.card,
    joint: Dp = Radius.joint,
    gap: Dp = 2.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    var tiles by remember { mutableStateOf(emptyList<Tile>()) }
    val density = LocalDensity.current
    Layout(
        content = { CompositionLocalProvider(LocalInSegments provides true) { SegmentScope.content() } },
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                val layoutDirection = layoutDirection
                tiles.forEach { t ->
                    val outline = t.shape.createOutline(Size(size.width, t.height.toFloat()), layoutDirection, density)
                    translate(top = t.top.toFloat()) { drawOutline(outline, color) }
                }
            },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = constraints.maxWidth, minHeight = 0)
        val rows = measurables.filter { it.parentData !== GapMarker }.map { it.measure(loose) }.filter { it.height > 0 }
        val gapPx = gap.roundToPx()
        val last = rows.lastIndex
        var y = 0
        val placed = ArrayList<Tile>(rows.size)
        rows.forEachIndexed { i, row ->
            val top = if (i == 0) outer else joint
            val bottom = if (i == last) outer else joint
            placed += Tile(y, row.height, RoundedCornerShape(topStart = top, topEnd = top, bottomEnd = bottom, bottomStart = bottom))
            y += row.height + if (i < last) gapPx else 0
        }
        // Read back by the draw: a state write in layout, compared first so a still list does not redraw.
        if (placed.size != tiles.size || placed.indices.any { placed[it].top != tiles[it].top || placed[it].height != tiles[it].height || placed[it].shape != tiles[it].shape }) tiles = placed
        layout(constraints.maxWidth, y) {
            placed.forEachIndexed { i, t ->
                rows[i].placeRelativeWithLayer(0, t.top) {
                    clip = true
                    shape = t.shape
                }
            }
        }
    }
}
