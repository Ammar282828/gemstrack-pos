package erp.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ToggleButton
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

// Material 3 Expressive's connected button group for a choice of one (Sources | Kinds, a period, a section). The kit keeps
// the segmented button's names and call shape, so a screen that chooses one of a few says what it always said and
// the choice is drawn the Material You way: toggle buttons 2 dp apart, the chosen one fully round, every one morphing as pressed.

/** Where a button stands in its group; [SegmentedButtonDefaults.itemShape] says it and the button reads it back. */
private class ConnectedSlot(val index: Int, val count: Int) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline = RectangleShape.createOutline(size, layoutDirection, density)
}

/** Stands in for `SegmentedButtonDefaults`: the position of a button, and colours (the scheme's own are right, so these only keep old calls compiling). */
object SegmentedButtonDefaults {
    fun itemShape(index: Int, count: Int): Shape = ConnectedSlot(index, count)

    fun colors(activeContainerColor: Color = Color.Unspecified, activeContentColor: Color = Color.Unspecified): SegmentedColors = SegmentedColors
}

object SegmentedColors

/** Which button of a group is held down, so the others can give way to it. */
@Stable
class SqueezeState {
    var pressed by mutableIntStateOf(-1)
}

/** The scope of a group's buttons: a row, so each can take its [RowScope.weight]. */
class ConnectedRowScope(row: RowScope, internal val squeeze: SqueezeState) : RowScope by row

/** A connected group of toggle buttons for one choice among a few; its buttons share the width. */
@Composable
fun SingleChoiceSegmentedButtonRow(modifier: Modifier = Modifier, content: @Composable ConnectedRowScope.() -> Unit) {
    val squeeze = remember { SqueezeState() }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) { ConnectedRowScope(this, squeeze).content() }
}

/** How much wider than its share a held button grows, as its neighbours give way (Material's ButtonGroup `animateWidth`). */
internal const val SQUEEZE_GROWTH = 0.16f

/** The weight a button takes: its share, plus [SQUEEZE_GROWTH] while it is held; the rest of the row shrinks to make room. */
internal fun squeezeWeight(pressed: Int, index: Int): Float = if (pressed == index) 1f + SQUEEZE_GROWTH else 1f

/**
 * One button of the group. [label] is the trailing lambda; [icon] is drawn before it. A button that is chosen is fully round
 * and in the primary, the others a tonal surface with the small connected corners; all of them morph while pressed.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ConnectedRowScope.SegmentedButton(
    selected: Boolean,
    onClick: () -> Unit,
    shape: Shape,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    @Suppress("UNUSED_PARAMETER") colors: SegmentedColors? = null,
    @Suppress("UNUSED_PARAMETER") border: BorderStroke? = null,
    icon: @Composable () -> Unit = {},
    label: @Composable () -> Unit,
) {
    val slot = shape as? ConnectedSlot
    val last = (slot?.count ?: 1) - 1
    val index = slot?.index ?: 0
    val motion = rememberErpMotion()
    val haptics = rememberHaptics()
    val source = remember { MutableInteractionSource() }
    val held by source.collectIsPressedAsState()
    // A held button widens on the fast spatial spring and its neighbours narrow with it; they spring back on release.
    LaunchedEffect(held) {
        if (held && !motion.reduce) squeeze.pressed = index else if (squeeze.pressed == index) squeeze.pressed = -1
    }
    val weight by animateFloatAsState(squeezeWeight(squeeze.pressed, index), motion.fastSpatial(), label = "squeeze")
    val shapes = when (slot?.index ?: 0) {
        0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
        last -> ButtonGroupDefaults.connectedTrailingButtonShapes()
        else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
    }
    ToggleButton(
        checked = selected,
        // The system's segment tick as a choice is made.
        onCheckedChange = { if (it) { haptics.selection(); onClick() } },
        modifier = with(this as RowScope) { modifier.weight(weight.coerceAtLeast(0.1f)) }.semantics { role = Role.RadioButton },
        enabled = enabled,
        shapes = shapes,
        interactionSource = source,
        contentPadding = PaddingValues(horizontal = 12.dp),
    ) {
        icon()
        label()
    }
}
