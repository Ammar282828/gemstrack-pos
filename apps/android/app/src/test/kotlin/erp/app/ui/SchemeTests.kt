package erp.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import com.materialkolor.hct.Hct
import erp.app.config.Business
import erp.app.ui.theme.ErpScheme
import erp.app.ui.theme.ToneColors
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Material You (docs/features/android-app.md "Material You"): the scheme grown from a business's colour, and the meaning-colours on it.
// Plain Kotlin, no device: the contrast every word is read at is the thing that must not slip when a palette changes.

class SchemeTests {
    private val taheri = Business.Palette(Business.Side("#8A6B42", "#ECE8E1", "#FFFFFF", "#FFFFFF", "#FFFFFF"), Business.Side("#D3B47F", "#030606", "#172020", "#0B1414", "#202A29"))
    private val mina = Business.Palette(Business.Side("#380000", "#F2E9E4", "#FFFFFF", "#FBF9F9", "#FFFFFF"), Business.Side("#EBA9B3", "#090405", "#22131A", "#251318", "#2C1A21"))

    private fun contrast(a: Color, b: Color): Double {
        val hi = maxOf(a.luminance(), b.luminance()).toDouble()
        val lo = minOf(a.luminance(), b.luminance()).toDouble()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun hue(c: Color) = Hct.fromInt(c.toArgb()).hue

    @Test fun theSeedIsTheBusinessColourThatCarriesAHue() {
        assertEquals(0xFF8A6B42.toInt(), ErpScheme.seedOf(taheri))
        // Mina's light accent is a maroon at tone 10, which TonalSpot would draw as brown: the pink is the seed.
        assertEquals(0xFFEBA9B3.toInt(), ErpScheme.seedOf(mina))
        assertEquals(ErpScheme.FallbackSeed, ErpScheme.seedOf(null))
    }

    @Test fun eachBusinessKeepsItsOwnHue() {
        val gold = ErpScheme.colors(ErpScheme.seedOf(taheri), dark = false).primary
        val pink = ErpScheme.colors(ErpScheme.seedOf(mina), dark = false).primary
        assertTrue(hue(gold) in 55.0..100.0, "gold hue ${hue(gold)}")
        assertTrue(hue(pink) > 330.0 || hue(pink) < 25.0, "pink hue ${hue(pink)}")
    }

    @Test fun theSchemeReadsInLightAndDark() {
        for (palette in listOf(taheri, mina)) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(palette), dark)
            assertTrue(contrast(s.onSurface, s.surface) >= 7.0, "words on the page")
            assertTrue(contrast(s.onSurface, s.surfaceContainer) >= 7.0, "words on a card")
            assertTrue(contrast(s.onSurfaceVariant, s.surfaceContainer) >= 4.5, "quiet words on a card")
            assertTrue(contrast(s.onPrimary, s.primary) >= 4.5, "a filled button's words")
            assertTrue(contrast(s.onPrimaryContainer, s.primaryContainer) >= 4.5, "a hero card's words")
            assertTrue(contrast(s.primary, s.surface) >= 3.0, "the accent on the page")
        }
    }

    @Test fun everyToneIsReadableOnTheSurfacesItSitsOn() {
        for (palette in listOf(taheri, mina)) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(palette), dark)
            val tones = ToneColors.of(s, dark)
            for (t in Tone.entries) {
                val r = tones[t]
                for (ground in listOf(s.surface, s.surfaceContainer, s.primaryContainer)) {
                    assertTrue(contrast(r.ink, ground) >= 4.5, "$t words on a surface (dark=$dark): ${contrast(r.ink, ground)}")
                }
                assertTrue(contrast(r.onContainer, r.container) >= 4.5, "$t pill words (dark=$dark)")
            }
        }
    }

    @Test fun lateStaysRedWhateverTheBusinessColour() {
        for (palette in listOf(taheri, mina)) for (dark in listOf(false, true)) {
            val s = ErpScheme.colors(ErpScheme.seedOf(palette), dark)
            val late = ToneColors.of(s, dark)[Tone.late].ink
            assertTrue(hue(late) in 15.0..40.0, "late hue ${hue(late)}")
            assertEquals(ToneColors.of(s, dark)[Tone.late].ink, ToneColors.of(s, dark)[Tone.problem].ink)
        }
    }
}
