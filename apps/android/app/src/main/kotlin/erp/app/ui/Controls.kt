package erp.app.ui

import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwitchColors
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

// The Material 3 controls the kit wears. Screens import these in place of the stock ones where Material You asks for more
// than the default: a switch carries its icon, a search box is the search bar.

/**
 * Material 3's switch with its thumb icon (a check when on, a cross when off), as Android's Settings draws it. Same
 * arguments as the stock `Switch` minus the thumb slot; pass `onCheckedChange = null` inside a row that toggles itself.
 */
@Composable
fun Switch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: SwitchColors = SwitchDefaults.colors(),
) {
    val haptics = rememberHaptics()
    androidx.compose.material3.Switch(
        checked = checked,
        // The system's switch tick as it flips; the thumb and track spring on the theme's motion scheme by themselves.
        onCheckedChange = onCheckedChange?.let { change -> { on -> haptics.toggle(on); change(on) } },
        modifier = modifier,
        thumbContent = {
            Icon(if (checked) Icons.Filled.Check else Icons.Filled.Close, contentDescription = null, Modifier.size(SwitchDefaults.IconSize))
        },
        enabled = enabled,
        colors = colors,
    )
}

/**
 * Material 3's search bar field: a full-round field on the container tone with the search glyph first and no outline,
 * as Android's own search boxes draw it. Takes the arguments of a `TextField` that a search box uses, so a list's search
 * says what it always said; [shape] is accepted and ignored (a search bar is always round).
 */
@Composable
fun SearchBarField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: (@Composable () -> Unit)? = null,
    label: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    singleLine: Boolean = true,
    @Suppress("UNUSED_PARAMETER") shape: Shape? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val tone = MaterialTheme.colorScheme.surfaceContainerHigh
    TextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.defaultMinSize(minHeight = 56.dp),
        enabled = enabled,
        placeholder = placeholder,
        label = label,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon,
        singleLine = singleLine,
        shape = CircleShape,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = tone,
            unfocusedContainerColor = tone,
            disabledContainerColor = tone,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
        ),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
    )
}

/**
 * Material 3 Expressive's loading indicator (the morphing shape) in place of the plain arc, for a wait the person sees:
 * a save in a button, a page being made. Size it with the modifier; [color] follows the button's label when inside one.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun Loading(modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    androidx.compose.material3.LoadingIndicator(modifier, if (color == Color.Unspecified) MaterialTheme.colorScheme.primary else color)
}

/** The same on its own round container, for a wait that fills a place (a form saving, a list on its way). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ContainedLoading(modifier: Modifier = Modifier) {
    androidx.compose.material3.ContainedLoadingIndicator(modifier)
}
