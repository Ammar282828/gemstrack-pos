package erp.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.window.DialogProperties

/**
 * A dialog's content arriving: it scales up from 85% on the spatial spring while it fades in on the effects spring (Material 3
 * Expressive's dialog). Put it on the dialog's own content (the surface), not on a full-screen scrim. Nothing moves under Reduce
 * Motion. Layer-only, so it costs no recomposition.
 */
@Composable
fun Modifier.dialogEnter(): Modifier {
    val motion = rememberErpMotion()
    if (motion.reduce) return this
    val scale = remember { Animatable(DIALOG_FROM_SCALE) }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        scale.animateTo(1f, motion.spatial())
    }
    LaunchedEffect(Unit) {
        alpha.animateTo(1f, motion.effects())
    }
    return graphicsLayer {
        scaleX = scale.value
        scaleY = scale.value
        this.alpha = alpha.value.coerceIn(0f, 1f)
    }
}

private const val DIALOG_FROM_SCALE = 0.85f

/**
 * Material's alert dialog with [dialogEnter]: the stock arguments, so a screen imports this one in place of
 * `androidx.compose.material3.AlertDialog` and its dialogs scale and fade in on the theme's motion.
 */
@Composable
fun AlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    icon: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
    shape: Shape = AlertDialogDefaults.shape,
    containerColor: Color = AlertDialogDefaults.containerColor,
    iconContentColor: Color = AlertDialogDefaults.iconContentColor,
    titleContentColor: Color = AlertDialogDefaults.titleContentColor,
    textContentColor: Color = AlertDialogDefaults.textContentColor,
    tonalElevation: Dp = AlertDialogDefaults.TonalElevation,
    properties: DialogProperties = DialogProperties(),
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = confirmButton,
        modifier = modifier.dialogEnter(),
        dismissButton = dismissButton,
        icon = icon,
        title = title,
        text = text,
        shape = shape,
        containerColor = containerColor,
        iconContentColor = iconContentColor,
        titleContentColor = titleContentColor,
        textContentColor = textContentColor,
        tonalElevation = tonalElevation,
        properties = properties,
    )
}
