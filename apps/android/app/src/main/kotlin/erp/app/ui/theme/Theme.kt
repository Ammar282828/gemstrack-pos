package erp.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
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
import erp.app.ui.rememberSystemReduceMotion

/**
 * The business's palette as the rest of the kit says it, now read off the Material 3 scheme (Material You, 2026-10-26):
 * the accent is the scheme's primary, the ground its surface, the card the container tiles sit on, the elevated one a
 * step higher (sheets, menus). Screens that name these keep compiling; new code says `MaterialTheme.colorScheme.*`.
 */
object ErpColors {
    val accent: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primary
    val ground: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surface
    val card: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceContainer
    val onAccent: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onPrimary
    val elevated: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceContainerHigh
    val dark: Boolean @Composable @ReadOnlyComposable get() = LocalErpDark.current
}

/** Whether the theme is the dark one (the device's choice or the shop's). */
val LocalErpDark = staticCompositionLocalOf { false }

/** The meaning-colours on the current scheme ([erp.app.ui.Tone]). */
val LocalToneColors = staticCompositionLocalOf<ToneColors> { error("ErpTheme not provided") }

/**
 * The system sans everywhere (Google Sans on a Pixel, Roboto elsewhere): Material You has no serif. FuturaLT-Light is
 * the website-weight overlay's face and nothing else.
 */
object ErpFonts {
    val futuraLight: FontFamily = FontFamily(Font(R.font.futura_lt_light))
}

/** Tabular digits, so a sum never jumps sideways as it changes. */
const val TabularDigits = "tnum"

/**
 * The kit's four figure styles on the Material 3 type scale, emphasized as Material 3 Expressive does it (a heavier
 * weight at the same size), digits tabular: the hero number is displaySmall, a tile's value titleLarge.
 */
object ErpType {
    /** A screen's one big sum (displaySmall, emphasized). */
    val heroNumber = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 36.sp, lineHeight = 44.sp, letterSpacing = 0.sp, fontFeatureSettings = TabularDigits)

    /** "PKR" beside it (titleLarge). */
    val heroUnit = TextStyle(fontWeight = FontWeight.Medium, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = 0.sp)

    /** A section's name or a short title (titleMedium, emphasized). */
    val heading = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.15.sp)

    /** A figure tile's value (titleLarge, emphasized). */
    val tileValue = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = 0.sp, fontFeatureSettings = TabularDigits)
}

/** The stock Material 3 type scale in the system font, with its Expressive emphasized styles. */
private val ErpTypography = Typography()

/** Material 3 Expressive's shape scale; [erp.app.ui.Radius] names the ones the kit draws with. */
private val ErpShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    largeIncreased = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
    extraLargeIncreased = RoundedCornerShape(32.dp),
    extraExtraLarge = RoundedCornerShape(48.dp),
)

/**
 * Material You on Material 3 Expressive: the whole colour scheme grown from the open business's accent ([ErpScheme]),
 * or the phone's own wallpaper colours when [wallpaperColors] is on (Android 12+; the business's colour is how staff
 * tell the businesses apart, so it is off unless chosen).
 *
 * [themeOverride] is the shop's or the phone's theme (RootGate.preferredScheme): "default" is light,
 * "taheri" and "slate" are dark, anything else (or null) follows the device.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ErpTheme(themeOverride: String? = null, wallpaperColors: Boolean = false, content: @Composable () -> Unit) {
    val system = isSystemInDarkTheme()
    val dark = when (themeOverride) {
        "default" -> false
        "taheri", "slate" -> true
        else -> system
    }
    val context = LocalContext.current
    val inspecting = LocalInspectionMode.current
    // The open business's own palette (its descriptor's hex colours): one app holds many businesses. A bare preview wears Taheri's gold.
    val business = if (inspecting) null else erp.app.config.Businesses.current
    val wallpaper = wallpaperColors && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val scheme = remember(business, dark, wallpaper, context) {
        if (wallpaper) {
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        } else {
            ErpScheme.colors(ErpScheme.seedOf(business?.palette), dark)
        }
    }
    val tones = remember(scheme, dark) { ToneColors.of(scheme, dark) }
    val reduce = rememberSystemReduceMotion()

    // A forced scheme needs the bars' icons to follow it, not the device.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
            // The window behind Compose wears the scheme's surface too (the resource ground is only the launch's), so the bars and
            // an overscroll or a resize never show another colour.
            window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(scheme.surface.toArgb()))
        }
    }

    CompositionLocalProvider(LocalErpDark provides dark, LocalToneColors provides tones, LocalReduceMotion provides reduce) {
        MaterialExpressiveTheme(
            colorScheme = scheme,
            motionScheme = MotionScheme.expressive(),
            shapes = ErpShapes,
            typography = ErpTypography,
            content = content,
        )
    }
}
