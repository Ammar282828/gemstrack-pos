package erp.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
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
            // Owed is a fixed deep orange, not harmonised: blended toward Taheri's gold it became the gold itself, and money
            // owed must read as a warning beside the house's own colour (found in the 2026-10-26 screenshots).
            val orange = roles(TonalPalette.fromHueAndChroma(45.0, 72.0))
            return ToneColors(
                late = red,
                owed = orange,
                settled = harmonised(settledBase),
                credit = harmonised(creditBase),
                working = harmonised(workingBase),
                quiet = ToneRoles(scheme.onSurfaceVariant, scheme.onSurfaceVariant, scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
                house = ToneRoles(scheme.primary, scheme.primary, scheme.primaryContainer, scheme.onPrimaryContainer),
            )
        }
    }
}

/**
 * WCAG contrast, and the quiet colours that never fall under it (owner, 2026-11-14: "the contrast in dark mode between the
 * text and the background is terrible in a lot of places"). The old code drew captions, placeholders and chevrons as
 * `onSurfaceVariant.copy(alpha = 0.5..0.8)`: a fade of a colour that already sat near 4.5:1 on a card, so on a dark card or on
 * the hero's primary container it fell to 2-3:1. A fade is now asked of these helpers, which return a solid colour moved
 * toward the scheme's `onSurface` only as far as it takes to read on **every** ground a screen draws words on.
 */
object ErpContrast {
    fun ratio(a: Color, b: Color): Double {
        val hi = maxOf(a.luminance(), b.luminance()).toDouble()
        val lo = minOf(a.luminance(), b.luminance()).toDouble()
        return (hi + 0.05) / (lo + 0.05)
    }

    /** Every ground the quiet colours sit on: the page, the card tiers and the hero's primary container. */
    fun grounds(s: ColorScheme): List<Color> = listOf(
        s.surface, s.surfaceContainerLowest, s.surfaceContainerLow, s.surfaceContainer, s.surfaceContainerHigh,
        s.surfaceContainerHighest, s.primaryContainer,
    )

    /**
     * [fg] (shown at [alpha] over the page tone, as the old fade was), moved toward [toward] until it reads at [min]:1 on
     * every one of [on]. The answer is solid, so a caller never has to wonder what it sits on. [min] is 4.5 for words, 3.0
     * for icons and shapes.
     */
    fun readable(fg: Color, alpha: Float, toward: Color, on: List<Color>, min: Double): Color {
        val start = fg.copy(alpha = alpha).compositeOver(on.first()).copy(alpha = 1f)
        fun worst(c: Color) = on.minOf { g -> ratio(c, g) }
        var t = 0f
        while (worst(lerp(start, toward, t)) < min && t < 1f) t += 0.02f
        return lerp(start, toward, t.coerceAtMost(1f))
    }

    /** A pill of a free [color]: its words (the colour, moved toward the on-colour until they read) over their own 16% wash on [ground]. */
    fun pillInk(s: ColorScheme, color: Color, ground: Color): Color =
        readable(color, 1f, s.onSurface, listOf(color.copy(alpha = 0.16f).compositeOver(ground)), 4.5)

    /** Words or an icon on a solid fill (a destructive button, a swipe's background): white or black, whichever reads better. */
    fun onFill(bg: Color): Color = if (ratio(Color.White, bg) >= ratio(Color.Black, bg)) Color.White else Color.Black

    /** Captions and secondary words (4.5:1 on every ground). */
    fun quiet(s: ColorScheme): Color = readable(s.onSurfaceVariant, 1f, s.onSurface, grounds(s), 4.5)

    /** A faded caption, as the old `onSurfaceVariant.copy(alpha = a)`: it reads as [quiet] does, on every ground. */
    fun faded(s: ColorScheme, alpha: Float): Color = readable(s.onSurfaceVariant, alpha, s.onSurface, grounds(s), 4.5)

    /** A placeholder: a hint beside typed words, and it still reads (4.5:1). */
    fun hint(s: ColorScheme): Color = quiet(s)

    /** A chevron, a drag handle, a decorative icon: no words, so 3:1 on every ground. */
    fun faint(s: ColorScheme): Color = readable(s.onSurfaceVariant, 0.7f, s.onSurface, grounds(s), 3.0)
}
