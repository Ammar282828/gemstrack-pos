package erp.app.widget

import android.content.Context
import android.os.Build
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.glance.color.ColorProvider
import androidx.glance.color.ColorProviders
import androidx.glance.unit.ColorProvider as ColorProviderType
import androidx.glance.material3.ColorProviders
import erp.app.nav.ThemeChoice
import erp.app.config.Prefs
import erp.app.ui.Tone
import erp.app.ui.theme.ErpScheme
import erp.app.ui.theme.ToneColors

/**
 * What the widget wears for one business (Material You, as the app does): the Material 3 scheme grown from the business's own
 * colour ([ErpScheme], light and dark), or the phone's wallpaper colours when Settings > This phone > "Wallpaper colours" is on and
 * the phone is Android 12+. The Glance widget and the preview read the same object, so they cannot differ.
 */
class WidgetColors(val light: ColorScheme, val dark: ColorScheme) {
    private val lightTones = ToneColors.of(light, false)
    private val darkTones = ToneColors.of(dark, true)

    /** For `GlanceTheme(colors = …)`: the roles Glance's own components read. */
    val glance: ColorProviders = ColorProviders(light, dark)

    fun scheme(night: Boolean): ColorScheme = if (night) dark else light

    /** Any role (Glance's ColorProviders carry no surfaceContainer*), as a day/night pair. */
    fun color(pick: (ColorScheme) -> Color): ColorProviderType = ColorProvider(day = pick(light), night = pick(dark))

    /** The ink of a meaning-colour (late is red, owed orange, settled green), for words and small marks. */
    fun tone(tone: Tone): ColorProviderType = ColorProvider(day = lightTones[tone].ink, night = darkTones[tone].ink)

    fun toneInk(tone: Tone, night: Boolean): Color = (if (night) darkTones else lightTones)[tone].ink

    companion object {
        /** A look's colours; [wallpaper] only counts where the phone has them to give. */
        fun of(look: WidgetLook?, wallpaper: Boolean, context: Context): WidgetColors =
            if (wallpaper && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                WidgetColors(dynamicLightColorScheme(context), dynamicDarkColorScheme(context))
            } else {
                val seed = ErpScheme.seedOf(look?.palette)
                WidgetColors(ErpScheme.colors(seed, false), ErpScheme.colors(seed, true))
            }

        /** Whether the phone asked for its wallpaper colours (the app's own switch; the widget reads it as it draws). */
        fun wantsWallpaper(): Boolean = Prefs.bool(ThemeChoice.WALLPAPER_KEY) == true
    }
}

/** The colours of the business whose tile is being drawn. */
internal val LocalWidgetColors = staticCompositionLocalOf<WidgetColors> { error("no widget colours") }

/**
 * The corners the system gives a widget (Android 12+: the launcher's own `system_app_widget_background_radius` for the widget
 * and `system_app_widget_inner_radius` for what sits inside it); before that, Material's 24 and 16.
 */
object WidgetShape {
    fun outer(context: Context): Dp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) dimen(context, android.R.dimen.system_app_widget_background_radius, 24.dp) else 24.dp
    fun inner(context: Context): Dp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) dimen(context, android.R.dimen.system_app_widget_inner_radius, 16.dp) else 16.dp

    private fun dimen(context: Context, res: Int, fallback: Dp): Dp {
        val d = context.resources.displayMetrics.density
        return runCatching { (context.resources.getDimension(res) / d).dp }.getOrDefault(fallback)
    }
}
