package erp.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape

// Material 3 Expressive's buttons: the round shape that morphs to a rounded square while pressed. The stock composables
// draw a fixed shape unless they are given `shapes`; these take the stock arguments and give them, so a screen
// imports the kit's `Button` and gets the press morph without saying so. Pass `shape` to keep one fixed shape.

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun Button(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape? = null,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    if (shape != null) androidx.compose.material3.Button(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)
    else androidx.compose.material3.Button(onClick, ButtonDefaults.shapes(), modifier, enabled, colors, elevation, border, contentPadding, interactionSource, content)
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FilledTonalButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape? = null,
    colors: ButtonColors = ButtonDefaults.filledTonalButtonColors(),
    elevation: ButtonElevation? = ButtonDefaults.filledTonalButtonElevation(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    if (shape != null) androidx.compose.material3.FilledTonalButton(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)
    else androidx.compose.material3.FilledTonalButton(onClick, ButtonDefaults.shapes(), modifier, enabled, colors, elevation, border, contentPadding, interactionSource, content)
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun OutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape? = null,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    if (shape != null) androidx.compose.material3.OutlinedButton(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)
    else androidx.compose.material3.OutlinedButton(onClick, ButtonDefaults.shapes(), modifier, enabled, colors, elevation, border, contentPadding, interactionSource, content)
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape? = null,
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    if (shape != null) androidx.compose.material3.TextButton(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)
    else androidx.compose.material3.TextButton(onClick, ButtonDefaults.shapes(), modifier, enabled, colors, elevation, border, contentPadding, interactionSource, content)
}

/** An icon button whose shape morphs from a circle to a rounded square while pressed. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun IconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.iconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    androidx.compose.material3.IconButton(onClick, IconButtonDefaults.shapes(), modifier, enabled, colors, interactionSource, content)
}
