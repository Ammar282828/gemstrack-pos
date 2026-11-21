package erp.app.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import erp.app.config.Business
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpContrast
import erp.app.ui.theme.ErpScheme
import erp.app.ui.theme.ToneColors
import org.junit.Test
import kotlin.test.assertTrue

// WCAG contrast for every pairing the app draws, in both schemes of both houses (the schemes are built exactly as ErpTheme
// builds them: Material Color Utilities TonalSpot from the business's seed). 4.5:1 for words, 3:1 for icons, large text and
// the shapes that carry information. Dark mode is where it slipped (owner, 2026-11-14), so a failure names the house and scheme.

class ContrastTests {
    private val taheri = Business.Palette(Business.Side("#85652A", "#F4F1EB", "#FFFFFF", "#FFFFFF", "#FFFFFF"), Business.Side("#CFAA62", "#0A1111", "#132020", "#0A1111", "#1A2828"))
    private val mina = Business.Palette(Business.Side("#8B1E2D", "#F8F1EE", "#FFFFFF", "#FFFFFF", "#FFFFFF"), Business.Side("#E8A5AE", "#140B0B", "#241416", "#2A1416", "#2E1B1E"))

    private class Case(val house: String, val dark: Boolean, val s: ColorScheme) {
        override fun toString() = "$house/${if (dark) "dark" else "light"}"
    }

    private val houseCases = listOf("taheri" to taheri, "mina" to mina).flatMap { (name, p) ->
        listOf(false, true).map { dark -> Case(name, dark, ErpScheme.colors(ErpScheme.seedOf(p), dark)) }
    }

    // "Wallpaper colours" (Settings > This phone) swaps in the phone's own scheme, which Android builds from the wallpaper by the
    // same TonalSpot recipe. The wallpaper is not known here, so a spread of seeds stands in for it: every hue family, the very
    // light and very dark ends, and a near-grey (the cases where TonalSpot lands closest to the limits).
    private val wallpaperSeeds = listOf(
        0xFF1A73E8, 0xFF0B8043, 0xFFD93025, 0xFFFFEB3B, 0xFF9334E6, 0xFF00ACC1, 0xFFFF6D00, 0xFFE91E63,
        0xFF795548, 0xFF8A8D91, 0xFFFFFFFF, 0xFF101010, 0xFFCDDC39, 0xFF3F51B5,
    ).map { it.toInt() }

    private val wallpaperCases = wallpaperSeeds.flatMap { seed ->
        listOf(false, true).map { dark -> Case("wallpaper #%06X".format(seed and 0xFFFFFF), dark, ErpScheme.colors(seed, dark)) }
    }

    private val cases = houseCases + wallpaperCases

    private fun contrast(a: Color, b: Color): Double {
        val hi = maxOf(a.luminance(), b.luminance()).toDouble()
        val lo = minOf(a.luminance(), b.luminance()).toDouble()
        return (hi + 0.05) / (lo + 0.05)
    }

    /** Every ground a screen puts words on. */
    private fun grounds(s: ColorScheme) = mapOf(
        "surface" to s.surface, "surfaceContainerLowest" to s.surfaceContainerLowest, "surfaceContainerLow" to s.surfaceContainerLow,
        "surfaceContainer" to s.surfaceContainer, "surfaceContainerHigh" to s.surfaceContainerHigh, "surfaceContainerHighest" to s.surfaceContainerHighest,
        "primaryContainer" to s.primaryContainer, "secondaryContainer" to s.secondaryContainer, "tertiaryContainer" to s.tertiaryContainer,
        "errorContainer" to s.errorContainer,
    )

    private val failures = mutableListOf<String>()

    private fun check(who: Case, what: String, fg: Color, bg: Color, min: Double) {
        val c = contrast(fg.compositeOver(bg), bg)
        if (c < min) failures += "$who: $what ${"%.2f".format(c)} < $min"
    }

    private fun done() = assertTrue(failures.isEmpty(), "\n" + failures.joinToString("\n"))

    @Test fun wordsReadOnEverySurface() {
        for (c in cases) {
            val s = c.s
            for ((gn, g) in grounds(s)) {
                if (gn.endsWith("Container") && !gn.startsWith("surface")) continue // their own on-colours, below
                check(c, "onSurface on $gn", s.onSurface, g, 7.0)
                check(c, "onSurfaceVariant on $gn", s.onSurfaceVariant, g, 4.5)
                check(c, "primary on $gn", s.primary, g, 4.5)
                check(c, "error on $gn", s.error, g, 4.5)
            }
            // A hero card is the primary container; its words are the scheme's on-colour, its quiet words the variant.
            check(c, "onPrimaryContainer on primaryContainer", s.onPrimaryContainer, s.primaryContainer, 4.5)
            check(c, "onSecondaryContainer on secondaryContainer", s.onSecondaryContainer, s.secondaryContainer, 4.5)
            check(c, "onTertiaryContainer on tertiaryContainer", s.onTertiaryContainer, s.tertiaryContainer, 4.5)
            check(c, "onErrorContainer on errorContainer", s.onErrorContainer, s.errorContainer, 4.5)
            check(c, "onPrimary on primary", s.onPrimary, s.primary, 4.5)
            check(c, "onSecondary on secondary", s.onSecondary, s.secondary, 4.5)
            check(c, "onError on error", s.onError, s.error, 4.5)
            check(c, "inverseOnSurface on inverseSurface", s.inverseOnSurface, s.inverseSurface, 4.5)
            check(c, "inversePrimary on inverseSurface", s.inversePrimary, s.inverseSurface, 4.5)
            // Quiet words and icons drawn on the primary container (a hero's captions, its chevron, its tool buttons).
            check(c, "onSurfaceVariant on primaryContainer", s.onSurfaceVariant, s.primaryContainer, 4.5)
            check(c, "onSurface on primaryContainer", s.onSurface, s.primaryContainer, 4.5)
        }
        done()
    }

    @Test fun quietWordsStayReadableOnTheHeroToo() {
        for (c in cases) {
            val s = c.s
            check(c, "ErpColors.quiet on primaryContainer", ErpColors.quietOf(s), s.primaryContainer, 4.5)
            for ((gn, g) in grounds(s)) check(c, "ErpColors.quiet on $gn", ErpColors.quietOf(s), g, 4.5)
        }
        done()
    }

    @Test fun iconsAndHintsReadOnEverySurface() {
        for (c in cases) {
            val s = c.s
            for ((gn, g) in grounds(s)) {
                check(c, "ErpColors.hint on $gn", ErpColors.hintOf(s), g, 4.5)
                check(c, "ErpColors.faint on $gn", ErpColors.faintOf(s), g, 3.0)
                // The outline draws a border, a switch's track, a radio ring: a shape that carries information, 3:1.
                if (!gn.endsWith("Container") || gn.startsWith("surface")) check(c, "outline on $gn", s.outline, g, 3.0)
            }
        }
        done()
    }

    @Test fun everyToneOnEveryGround() {
        for (c in cases) {
            val s = c.s
            val tones = ToneColors.of(s, c.dark)
            for (t in Tone.entries) {
                val r = tones[t]
                for ((gn, g) in grounds(s)) {
                    check(c, "$t ink on $gn", r.ink, g, 4.5)
                    // fill is a bar, a dot, a ring: a graphic, 3:1.
                    check(c, "$t fill on $gn", r.fill, g, 3.0)
                }
                check(c, "$t onContainer on its container", r.onContainer, r.container, 4.5)
                // Pill: ink over its own 16% wash on a card (Ledger.Pill), a tone-coloured icon on its container.
                for (gn in listOf("surface", "surfaceContainer", "surfaceContainerHigh", "primaryContainer")) {
                    val g = grounds(s).getValue(gn)
                    val wash = r.ink.copy(alpha = 0.16f).compositeOver(g)
                    check(c, "$t pill words on their own wash over $gn", ErpContrast.pillInk(s, r.ink, g), wash, 4.5)
                }
                check(c, "$t ink on its container", r.ink, r.container, 3.0)
            }
        }
        done()
    }

    @Test fun houseAccentWordsOnTheSurfacesTheyDrawOn() {
        for (c in cases) {
            val s = c.s
            // The hero's tool buttons (Contact.kt): the primary on a 12% wash of itself over the primary container.
            val heroWash = s.primary.copy(alpha = 0.12f).compositeOver(s.primaryContainer)
            check(c, "primary on primaryContainer", s.primary, s.primaryContainer, 4.5)
            check(c, "primary icon on its 12% wash over primaryContainer", s.primary, heroWash, 3.0) // an icon, 3:1
            check(c, "onSurface on its 12% wash over primaryContainer", s.onSurface, heroWash, 4.5)
            for (gn in listOf("surface", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest")) {
                val g = grounds(s).getValue(gn)
                // A section's heading, a text button, a selected tab: the primary on the surface it sits on.
                check(c, "primary on $gn", s.primary, g, 4.5)
                // A lit row's wash of the primary container (ledgerCard(lit = true)): its words are onSurface.
                val lit = s.primaryContainer.copy(alpha = 0.35f).compositeOver(g)
                check(c, "onSurface on lit $gn", s.onSurface, lit, 7.0)
                check(c, "onSurfaceVariant on lit $gn", s.onSurfaceVariant, lit, 4.5)
                check(c, "primary on lit $gn", s.primary, lit, 4.5)
            }
        }
        done()
    }

    @Test fun noScreenFadesWordsOrIconsWithAlpha() {
        // The cause of most of the dark-mode complaints: `color = onSurfaceVariant.copy(alpha = 0.6f)` and its kin. Words and icons
        // say ErpColors.quiet / hint / faint / faded(a), which hold the contrast; a fade is for a fill, a track or a hairline.
        val bad = Regex("""(?:color|tint|contentColor)\s*=\s*[A-Za-z.]*(?:onSurfaceVariant|onSurface|outline|primary|onPrimaryContainer)\.copy\(alpha""")
        val root = java.io.File("src/main/kotlin/erp/app")
        val hits = root.walkTopDown().filter { it.isFile && it.extension == "kt" }
            .filterNot { it.path.contains("/widget/") || it.path.contains("/theme/") }
            .flatMap { f -> f.readLines().withIndex().filter { (_, l) -> bad.containsMatchIn(l) }.map { (i, l) -> "${f.path}:${i + 1}: ${l.trim().take(120)}" } }
            .toList()
        assertTrue(hits.isEmpty(), "\n" + hits.joinToString("\n"))
    }

    @Test fun fadedWordsAreNeverFaded() {
        // The old code drew captions as onSurfaceVariant at 50-80% alpha. Whatever alpha is asked now, the helper answers a
        // colour that still reads: this fails if the clamp slips.
        for (c in cases) for (g in ErpContrast.grounds(c.s)) for (a in listOf(0.35f, 0.5f, 0.6f, 0.7f, 0.8f)) {
            check(c, "ErpColors.fadedOf alpha $a", ErpColors.fadedOf(c.s, a), g, 4.5)
        }
        done()
    }
}
