package erp.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.materialkolor.blend.Blend
import com.materialkolor.dynamiccolor.ColorSpec
import com.materialkolor.hct.Hct
import com.materialkolor.palettes.TonalPalette
import com.materialkolor.scheme.DynamicScheme
import com.materialkolor.scheme.SchemeTonalSpot
import erp.app.config.Business
import erp.app.config.parseHexColor
import erp.app.ui.Tone

// Material You on the business's own colour. Google's Material Color Utilities (pure Kotlin, no Compose in it) turn one seed
// into every role of the Material 3 scheme, the way Android's wallpaper colours do: TonalSpot, the Pixel's own variant.
// The seed is the business's accent, because one app holds Taheri (gold) and House of Mina (pink) and staff tell them
// apart by it; "Wallpaper colours" (Settings > This phone) swaps in the phone's own scheme instead.

object ErpScheme {
    /** Taheri's gold: what a bare preview or a business whose colours cannot be read wears. */
    const val FallbackSeed: Int = 0xFF8A6B42.toInt()

    /**
     * The one colour a business's schemes grow from, light and dark alike. Its light accent, unless that is too dark to
     * carry a hue (Mina's maroon sits at tone 10, where TonalSpot would draw brown): then its dark accent, the pink.
     */
    fun seedOf(palette: Business.Palette?): Int {
        if (palette == null) return FallbackSeed
        val light = parseHexColor(palette.light.accent)?.toInt()
        val dark = parseHexColor(palette.dark.accent)?.toInt()
        return when {
            light != null && Hct.fromInt(light).tone >= 25.0 -> light
            dark != null -> dark
            light != null -> light
            else -> FallbackSeed
        }
    }

    fun dynamic(seed: Int, dark: Boolean): DynamicScheme =
        SchemeTonalSpot(Hct.fromInt(seed), dark, 0.0, ColorSpec.SpecVersion.SPEC_2021, DynamicScheme.Platform.PHONE)

    /** Every role of the Material 3 scheme from [seed]. */
    fun colors(seed: Int, dark: Boolean): ColorScheme = dynamic(seed, dark).toColorScheme(dark)

    private fun Int.c() = Color(this)

    private fun DynamicScheme.toColorScheme(dark: Boolean): ColorScheme =
        if (dark) {
            darkColorScheme(
                primary = primary.c(), onPrimary = onPrimary.c(), primaryContainer = primaryContainer.c(), onPrimaryContainer = onPrimaryContainer.c(),
                inversePrimary = inversePrimary.c(),
                secondary = secondary.c(), onSecondary = onSecondary.c(), secondaryContainer = secondaryContainer.c(), onSecondaryContainer = onSecondaryContainer.c(),
                tertiary = tertiary.c(), onTertiary = onTertiary.c(), tertiaryContainer = tertiaryContainer.c(), onTertiaryContainer = onTertiaryContainer.c(),
                background = background.c(), onBackground = onBackground.c(),
                surface = surface.c(), onSurface = onSurface.c(), surfaceVariant = surfaceVariant.c(), onSurfaceVariant = onSurfaceVariant.c(),
                surfaceTint = primary.c(), inverseSurface = inverseSurface.c(), inverseOnSurface = inverseOnSurface.c(),
                error = error.c(), onError = onError.c(), errorContainer = errorContainer.c(), onErrorContainer = onErrorContainer.c(),
                outline = outline.c(), outlineVariant = outlineVariant.c(), scrim = scrim.c(),
                surfaceBright = surfaceBright.c(), surfaceDim = surfaceDim.c(),
                surfaceContainer = surfaceContainer.c(), surfaceContainerHigh = surfaceContainerHigh.c(), surfaceContainerHighest = surfaceContainerHighest.c(),
                surfaceContainerLow = surfaceContainerLow.c(), surfaceContainerLowest = surfaceContainerLowest.c(),
            )
        } else {
            lightColorScheme(
                primary = primary.c(), onPrimary = onPrimary.c(), primaryContainer = primaryContainer.c(), onPrimaryContainer = onPrimaryContainer.c(),
                inversePrimary = inversePrimary.c(),
                secondary = secondary.c(), onSecondary = onSecondary.c(), secondaryContainer = secondaryContainer.c(), onSecondaryContainer = onSecondaryContainer.c(),
                tertiary = tertiary.c(), onTertiary = onTertiary.c(), tertiaryContainer = tertiaryContainer.c(), onTertiaryContainer = onTertiaryContainer.c(),
                background = background.c(), onBackground = onBackground.c(),
                surface = surface.c(), onSurface = onSurface.c(), surfaceVariant = surfaceVariant.c(), onSurfaceVariant = onSurfaceVariant.c(),
                surfaceTint = primary.c(), inverseSurface = inverseSurface.c(), inverseOnSurface = inverseOnSurface.c(),
                error = error.c(), onError = onError.c(), errorContainer = errorContainer.c(), onErrorContainer = onErrorContainer.c(),
                outline = outline.c(), outlineVariant = outlineVariant.c(), scrim = scrim.c(),
                surfaceBright = surfaceBright.c(), surfaceDim = surfaceDim.c(),
                surfaceContainer = surfaceContainer.c(), surfaceContainerHigh = surfaceContainerHigh.c(), surfaceContainerHighest = surfaceContainerHighest.c(),
                surfaceContainerLow = surfaceContainerLow.c(), surfaceContainerLowest = surfaceContainerLowest.c(),
            )
        }
}

/**
 * What one [Tone] looks like on the current scheme, as Material's own roles do it: [ink] for words and icons
 * (tone 40 light, 80 dark: it reads on every surface), [fill] for bars and dots, a [container] with its [onContainer]
 * words for a pill.
 */
@Immutable
class ToneRoles(val ink: Color, val fill: Color, val container: Color, val onContainer: Color)

/** All the tones for one scheme, computed once per theme (not per Pill). */
@Immutable
class ToneColors private constructor(
    private val late: ToneRoles,
    private val owed: ToneRoles,
    private val settled: ToneRoles,
    private val credit: ToneRoles,
    private val working: ToneRoles,
    private val quiet: ToneRoles,
    private val house: ToneRoles,
) {
    operator fun get(tone: Tone): ToneRoles = when (tone) {
        Tone.late, Tone.problem -> late
        Tone.owed -> owed
        Tone.settled -> settled
        Tone.credit -> credit
        Tone.working -> working
        Tone.quiet -> quiet
        Tone.house -> house
    }

    companion object {
        // The meaning-colours' starting points (amber, green, teal, blue): each is blended toward the scheme's primary by
        // Material's own harmonisation (a hue shift of at most 15 degrees) so they belong to the scheme without ever changing
        // meaning. Red is the scheme's error and is left alone: a late promise must stay red whatever the business's colour.
        private val owedBase = 0xFFFF9500.toInt()
        private val settledBase = 0xFF34C759.toInt()
        private val creditBase = 0xFF30B0C7.toInt()
        private val workingBase = 0xFF007AFF.toInt()

        /** The tones on [scheme] (the business's, or the phone's wallpaper colours): they follow its own primary. */
        fun of(scheme: ColorScheme, dark: Boolean): ToneColors {
            val seed = scheme.primary.toArgb()
            fun roles(palette: TonalPalette) = ToneRoles(
                ink = Color(palette.tone(if (dark) 80 else 40)),
                fill = Color(palette.tone(if (dark) 70 else 50)),
                container = Color(palette.tone(if (dark) 30 else 90)),
                onContainer = Color(palette.tone(if (dark) 90 else 10)),
            )
            fun harmonised(base: Int): ToneRoles {
                val h = Hct.fromInt(Blend.harmonize(base, seed))
                return roles(TonalPalette.fromHueAndChroma(h.hue, h.chroma.coerceIn(32.0, 44.0)))
            }
            // M3's error, as its own palette: hue 25, chroma 84.
            val red = roles(TonalPalette.fromHueAndChroma(25.0, 84.0))
            return ToneColors(
                late = red,
                owed = harmonised(owedBase),
                settled = harmonised(settledBase),
                credit = harmonised(creditBase),
                working = harmonised(workingBase),
                quiet = ToneRoles(scheme.onSurfaceVariant, scheme.onSurfaceVariant, scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
                house = ToneRoles(scheme.primary, scheme.primary, scheme.primaryContainer, scheme.onPrimaryContainer),
            )
        }
    }
}
