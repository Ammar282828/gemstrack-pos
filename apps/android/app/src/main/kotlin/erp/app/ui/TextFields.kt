package erp.app.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextFieldColors
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation

/**
 * The app's one text field: Material 3's filled field, as Pixel's own forms draw it (tonal container, floating label, no
 * outline). Its corners are the kit's field radius and its only line is the focus indicator, in the primary (error when wrong),
 * so a field sits on a card or a sheet without a border. Every standalone box says `TextField`, from here; the label-and-value
 * rows of a form (`ValueInput`, `QuietField`) are the Settings list's inline entry and stay on their tile.
 */
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    textStyle: TextStyle = LocalTextStyle.current,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    prefix: (@Composable () -> Unit)? = null,
    suffix: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1,
    interactionSource: MutableInteractionSource? = null,
    shape: Shape = Radius.chipShape,
    colors: TextFieldColors = erpTextFieldColors(),
) {
    androidx.compose.material3.TextField(
        value = value, onValueChange = onValueChange, modifier = modifier, enabled = enabled, readOnly = readOnly,
        textStyle = textStyle, label = label, placeholder = placeholder, leadingIcon = leadingIcon, trailingIcon = trailingIcon,
        prefix = prefix, suffix = suffix, supportingText = supportingText, isError = isError,
        visualTransformation = visualTransformation, keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        singleLine = singleLine, maxLines = maxLines, minLines = minLines, interactionSource = interactionSource,
        shape = shape, colors = colors,
    )
}

/** The filled field's colours: the highest container tone, no resting line, a primary indicator while focused. */
@Composable
fun erpTextFieldColors(): TextFieldColors {
    val scheme = MaterialTheme.colorScheme
    return TextFieldDefaults.colors(
        focusedContainerColor = scheme.surfaceContainerHighest,
        unfocusedContainerColor = scheme.surfaceContainerHighest,
        disabledContainerColor = scheme.surfaceContainerHighest.copy(alpha = 0.5f),
        errorContainerColor = scheme.surfaceContainerHighest,
        focusedIndicatorColor = scheme.primary,
        unfocusedIndicatorColor = Color.Transparent,
        disabledIndicatorColor = Color.Transparent,
        errorIndicatorColor = scheme.error,
    )
}
