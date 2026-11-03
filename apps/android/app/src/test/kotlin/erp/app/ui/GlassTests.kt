package erp.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import erp.app.config.Business
import erp.app.ui.theme.ErpScheme
import org.junit.Test
import kotlin.test.assertTrue

// Liquid Glass (ui/Glass.kt): the words stay AA on the see-through card in both themes and both businesses. Plain Kotlin: the
// backdrop under a blur is anything the page shows, so the worst case is a backdrop half-way to the ink colour (heavy content
// smeared by the blur) and the ground's washes stacked at their strongest.

class GlassTests {
    private val taheri = Business.Palette(Business.Side("#8A6B42", "#ECE8E1", "#FFFFFF", "#FFFFFF", "#FFFFFF"), Business.Side("#D3B47F", "#030606", "#172020", "#0B1414", "#202A29"))
    private val mina = Business.Palette(Business.Side("#380000", "#F2E9E4", "#FFFFFF", "#FBF9F9", "#FFFFFF"), Business.Side("#EBA9B3", "#090405", "#22131A", "#251318", "#2C1A21"))

    private fun contrast(a: Color, b: Color): Double {
        val hi = maxOf(a.luminance(), b.luminance()).toDouble()
        val lo = minOf(a.luminance(), b.luminance()).toDouble()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun lerp(a: Color, b: Color, t: Float) = GlassTokens.over(b.copy(alpha = t), a)

    @Test fun wordsOnTheRowLookAreAA() {
        for (palette in listOf(taheri, mina)) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(palette), dark)
            // The strongest the ground can be: the three washes on top of each other, at their alphas.
            val wash = GlassTokens.groundAlphas(dark).sum()
            val ground = GlassTokens.over(s.primary.copy(alpha = wash.coerceAtMost(1f)), s.surface)
            val tile = GlassTokens.over(s.surfaceContainer.copy(alpha = GlassTokens.RowAlpha), ground)
            assertTrue(contrast(s.onSurface, tile) >= 7.0, "words on a row, dark=$dark: ${contrast(s.onSurface, tile)}")
            assertTrue(contrast(s.onSurfaceVariant, tile) >= 4.5, "quiet words on a row, dark=$dark: ${contrast(s.onSurfaceVariant, tile)}")
        }
    }

    @Test fun wordsOnTrueGlassAreAAOverAHeavyBackdrop() {
        for (palette in listOf(taheri, mina)) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(palette), dark)
            val backdrop = lerp(s.surface, s.onSurface, 0.5f)
            val card = GlassTokens.over(s.surfaceContainer.copy(alpha = GlassTokens.CardAlpha), backdrop)
            assertTrue(contrast(s.onSurface, card) >= 4.5, "words on glass, dark=$dark: ${contrast(s.onSurface, card)}")
            assertTrue(contrast(s.onSurfaceVariant, card) >= 4.5, "quiet words on glass, dark=$dark: ${contrast(s.onSurfaceVariant, card)}")
            val hero = GlassTokens.over(s.primaryContainer.copy(alpha = GlassTokens.CardAlpha), backdrop)
            assertTrue(contrast(s.onPrimaryContainer, hero) >= 4.5, "hero words, dark=$dark: ${contrast(s.onPrimaryContainer, hero)}")
        }
    }

    @Test fun theBrandCardsKeepTheirInk() {
        // Taheri's champagne on #0B1414 and Mina's maroon on blush, at the picker's tint, over the same heavy backdrop in either theme.
        for ((ground, ink) in listOf(Color(0xFF0B1414) to Color(0xFFD3B47F), Color(0xFFF2E9E4) to Color(0xFF380000))) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(taheri), dark)
            val backdrop = lerp(s.surface, s.onSurface, 0.5f)
            val card = GlassTokens.over(ground.copy(alpha = 0.84f), backdrop)
            assertTrue(contrast(ink, card) >= 4.5, "wordmark on $ground, dark=$dark: ${contrast(ink, card)}")
        }
    }
}
