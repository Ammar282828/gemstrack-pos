package erp.app.ui.theme

import android.app.Activity
import android.content.res.Configuration
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import erp.app.R
import erp.app.ui.LocalReduceMotion
import erp.app.ui.Radius
import erp.app.ui.rememberSystemReduceMotion

/**
 * The house's four colours (Theme.swift): the accent for what can be pressed and what is chosen, the ground
 * screens sit on, the card that cards and tiles sit on, and the words on the accent (a filled button's label).
 * [dark] says which set they are, so a tone can pick its own light/dark value.
 */
@Immutable
class HouseColors(
    val accent: Color,
    val ground: Color,
    val card: Color,
    val onAccent: Color,
    val dark: Boolean,
)

/** Outside [ErpTheme] (a bare preview) these keep the kit drawable: Taheri's light set. */
private val FallbackHouseColors = HouseColors(
    accent = Color(0xFF8A6B42), ground = Color(0xFFF2F3F6), card = Color.White, onAccent = Color.White, dark = false,
)

val LocalHouseColors = staticCompositionLocalOf { FallbackHouseColors }

/** `ErpColors.accent` etc.: the house's palette, as the iPhone's `Theme.accent`, `Theme.card`. */
object ErpColors {
    val accent: Color @Composable @ReadOnlyComposable get() = LocalHouseColors.current.accent
    val ground: Color @Composable @ReadOnlyComposable get() = LocalHouseColors.current.ground
    val card: Color @Composable @ReadOnlyComposable get() = LocalHouseColors.current.card
    val onAccent: Color @Composable @ReadOnlyComposable get() = LocalHouseColors.current.onAccent
    val dark: Boolean @Composable @ReadOnlyComposable get() = LocalHouseColors.current.dark
}

/**
 * The system font everywhere, as on the iPhone; the serif (the iPhone's New York) is for figures and headings
 * only ([ErpType]). FuturaLT-Light is the website-weight overlay's face and nothing else.
 */
object ErpFonts {
    val futuraLight: FontFamily = FontFamily(Font(R.font.futura_lt_light))
}

/** Tabular digits, so a sum never jumps sideways as it changes (the iPhone's `.monospacedDigit()`). */
const val TabularDigits = "tnum"

object ErpType {
    /** A screen's one big sum (`.largeTitle` serif, semibold). */
    val heroNumber = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, lineHeight = 40.sp, fontFeatureSettings = TabularDigits)

    /** "PKR" beside it (`.title3` serif, medium). */
    val heroUnit = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Medium, fontSize = 20.sp, lineHeight = 26.sp)

    /** A section's name (`.title3` serif, semibold). */
    val heading = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp)

    /** A figure tile's value (`.title2` serif, semibold). */
    val tileValue = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, fontFeatureSettings = TabularDigits)
}

/** The stock type scale in the system font. */
private val ErpTypography = Typography()

/** Corners from [Radius]: the slots the stock Material components pick map onto the kit's four radii. */
private val ErpShapes = Shapes(
    extraSmall = RoundedCornerShape(Radius.thumb),
    small = RoundedCornerShape(Radius.tile),
    medium = RoundedCornerShape(Radius.chip),
    large = RoundedCornerShape(Radius.card),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * The house's palette (generated from the iPhone's colorsets) on Material 3 expressive.
 *
 * [themeOverride] is the shop's or the phone's theme (RootGate.preferredScheme): "default" is light,
 * "taheri" and "slate" are dark, anything else (or null) follows the device. The colours are resources
 * (values / values-night), so a scheme the device is not in is read through a context whose configuration
 * says night or day (`createConfigurationContext`), not guessed.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ErpTheme(themeOverride: String? = null, content: @Composable () -> Unit) {
    val system = isSystemInDarkTheme()
    val dark = when (themeOverride) {
        "default" -> false
        "taheri", "slate" -> true
        else -> system
    }
    val house = rememberHouseColors(dark)
    val scheme = remember(house) { houseColorScheme(dark, house.accent, house.onAccent, house.ground, house.card) }
    val reduce = rememberSystemReduceMotion()

    // A forced scheme needs the bars' icons to follow it, not the device.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }
    }

    CompositionLocalProvider(LocalHouseColors provides house, LocalReduceMotion provides reduce) {
        MaterialExpressiveTheme(
            colorScheme = scheme,
            motionScheme = MotionScheme.expressive(),
            shapes = ErpShapes,
            typography = ErpTypography,
            content = content,
        )
    }
}

@Composable
private fun rememberHouseColors(dark: Boolean): HouseColors {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val inspecting = LocalInspectionMode.current
    return remember(context, configuration, dark, inspecting) {
        val night = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        val forced = Configuration(configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
        }
        // The IDE's preview already runs in the scheme it was asked for; a derived context can lack the app's resources there.
        val source = if (inspecting) context else context.createConfigurationContext(forced)
        HouseColors(
            accent = Color(source.getColor(R.color.house_accent)),
            ground = Color(source.getColor(R.color.house_ground)),
            card = Color(source.getColor(R.color.house_card)),
            onAccent = Color(source.getColor(R.color.house_on_accent)),
            dark = dark,
        )
    }
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
