package erp.app.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import erp.app.ui.theme.ErpColors

/**
 * A card that is itself the button: its corners morph from extraLarge to large while it is pressed and spring back
 * (Material 3 Expressive's press, in place of the old 0.98 scale), with the ripple on top. The card's tone, its clip and its
 * click are one modifier so the shape that is clipped is the shape that morphs. Nothing moves with animations off. Put the
 * padding after it.
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun Modifier.morphCard(
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    onLongClickLabel: String? = null,
    color: Color = ErpColors.card,
    rest: Dp = Radius.card,
    pressed: Dp = Radius.chip,
): Modifier {
    val source = remember { MutableInteractionSource() }
    val down by source.collectIsPressedAsState()
    val reduce = reduceMotion()
    val corner by animateDpAsState(if (down && !reduce) pressed else rest, MaterialTheme.motionScheme.fastSpatialSpec(), label = "cardMorph")
    return this
        .clip(RoundedCornerShape(corner))
        .background(color)
        .combinedClickable(
            interactionSource = source,
            indication = LocalIndication.current,
            role = Role.Button,
            onClickLabel = onClickLabel,
            onLongClickLabel = onLongClickLabel,
            onLongClick = onLongClick,
            onClick = onClick,
        )
}
