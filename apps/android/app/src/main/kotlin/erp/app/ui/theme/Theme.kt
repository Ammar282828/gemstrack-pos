package erp.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.colorResource
import erp.app.R

/**
 * The house's palette (generated from the iPhone's colorsets) on Material 3 expressive.
 * colorResource follows the device's day/night, so [dark] only picks the scheme's shape;
 * a per-app override of the device's choice will need its own resource context.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ErpTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme = houseColorScheme(
        dark = dark,
        accent = colorResource(R.color.house_accent),
        onAccent = colorResource(R.color.house_on_accent),
        ground = colorResource(R.color.house_ground),
        card = colorResource(R.color.house_card),
    )
    MaterialExpressiveTheme(
        colorScheme = scheme,
        motionScheme = MotionScheme.expressive(),
        content = content,
    )
}

fun houseColorScheme(dark: Boolean, accent: Color, onAccent: Color, ground: Color, card: Color): ColorScheme {
    // text is near-black on a light ground and near-white on a dark one, tinted toward the ground
    val ink = lerp(ground, if (dark) Color.White else Color.Black, 0.88f)
    val inkSoft = lerp(ground, ink, 0.66f)
    val line = lerp(ground, ink, 0.18f)
    val high = lerp(card, ink, 0.06f)
    val highest = lerp(card, ink, 0.10f)
    val container = lerp(ground, accent, if (dark) 0.22f else 0.14f)

    return if (dark) {
        darkColorScheme(
            primary = accent, onPrimary = onAccent,
            primaryContainer = container, onPrimaryContainer = lerp(accent, Color.White, 0.55f),
            secondary = accent, onSecondary = onAccent,
            secondaryContainer = container, onSecondaryContainer = lerp(accent, Color.White, 0.55f),
            tertiary = accent, onTertiary = onAccent,
            background = ground, onBackground = ink,
            surface = ground, onSurface = ink,
            surfaceVariant = high, onSurfaceVariant = inkSoft,
            surfaceTint = accent,
            surfaceContainerLowest = lerp(ground, Color.Black, 0.3f),
            surfaceContainerLow = lerp(ground, card, 0.5f),
            surfaceContainer = card,
            surfaceContainerHigh = high,
            surfaceContainerHighest = highest,
            outline = inkSoft, outlineVariant = line,
        )
    } else {
        lightColorScheme(
            primary = accent, onPrimary = onAccent,
            primaryContainer = container, onPrimaryContainer = lerp(accent, Color.Black, 0.45f),
            secondary = accent, onSecondary = onAccent,
            secondaryContainer = container, onSecondaryContainer = lerp(accent, Color.Black, 0.45f),
            tertiary = accent, onTertiary = onAccent,
            background = ground, onBackground = ink,
            surface = ground, onSurface = ink,
            surfaceVariant = high, onSurfaceVariant = inkSoft,
            surfaceTint = accent,
            surfaceContainerLowest = card,
            surfaceContainerLow = lerp(ground, card, 0.5f),
            surfaceContainer = card,
            surfaceContainerHigh = high,
            surfaceContainerHighest = highest,
            outline = inkSoft, outlineVariant = line,
        )
    }
}
