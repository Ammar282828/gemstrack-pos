package erp.core

import erp.core.logic.PhotoLabel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** label-ink.test.ts, value for value, and the Photo weights page's carats line and geometry. */
class PhotoLabelTests {
    private fun px(r: Int, g: Int, b: Int) = (r shl 16) or (g shl 8) or b

    @Test fun inkIsWhiteOnADarkCornerAndDarkOnALightOne() {
        assertEquals(PhotoLabel.WHITE_INK, PhotoLabel.inkFor(PhotoLabel.meanLuminance(intArrayOf(px(20, 60, 40), px(30, 70, 50)))))
        assertEquals(PhotoLabel.DARK_INK, PhotoLabel.inkFor(PhotoLabel.meanLuminance(intArrayOf(px(235, 230, 225)))))
    }

    @Test fun inkTurnsAtTheContrastCrossoverAboutPoint20() {
        assertEquals(PhotoLabel.WHITE_INK, PhotoLabel.inkFor(0.19))
        assertEquals(PhotoLabel.DARK_INK, PhotoLabel.inkFor(0.21))
    }

    @Test fun luminanceEndsAndTheEmptyCase() {
        assertEquals(0.0, PhotoLabel.meanLuminance(IntArray(0)))
        assertEquals(0.0, PhotoLabel.meanLuminance(intArrayOf(px(0, 0, 0))))
        assertEquals(1.0, PhotoLabel.meanLuminance(intArrayOf(px(255, 255, 255))), 1e-12)
    }

    @Test fun theCornerScalesWithThePhotoAndStaysInside() {
        assertEquals(PhotoLabel.Area(80, 40, 900, 400), PhotoLabel.area(3000, 3000))
        assertEquals(PhotoLabel.Area(13, 6, 150, 67), PhotoLabel.area(500, 500))
        // A short photo never reads past its bottom edge.
        assertEquals(PhotoLabel.Area(80, 40, 900, 60), PhotoLabel.area(3000, 100))
    }

    @Test fun caratsReadTwoPlacesWithCt() {
        assertEquals("0.50ct", PhotoLabel.caratsText(0.5))
        assertEquals("0.24ct", PhotoLabel.caratsText(0.24))
        assertEquals("1.00ct", PhotoLabel.caratsText(1.005))
        assertEquals("12.30ct", PhotoLabel.caratsText(12.3))
    }

    @Test fun theLineJoinsTheSolitaireAndTheSmallOnesAfterAPlus() {
        assertEquals("0.50ct + 0.24ct", PhotoLabel.caratsLine(0.5, 0.24))
        assertEquals("0.50ct", PhotoLabel.caratsLine(0.5, 0.0))
        assertEquals("0.24ct", PhotoLabel.caratsLine(0.0, 0.24))
        assertEquals("", PhotoLabel.caratsLine(0.0, 0.0))
    }

    @Test fun typedCaratsAreEmptyNumbersOrNotANumber() {
        assertEquals(null, PhotoLabel.parseCarats("  "))
        assertEquals(0.5, PhotoLabel.parseCarats("0,5"))
        assertTrue(PhotoLabel.parseCarats("abc")!!.isNaN())
        assertTrue(PhotoLabel.caratsValid(null))
        assertTrue(PhotoLabel.caratsValid(0.24))
        assertTrue(!PhotoLabel.caratsValid(0.0))
        assertTrue(!PhotoLabel.caratsValid(500.0))
        assertTrue(!PhotoLabel.caratsValid(Double.NaN))
    }

    @Test fun theGeometryIsTheSitesAgainst3000() {
        assertEquals(257.3, PhotoLabel.WEIGHT_BASELINE, 1e-9)
        assertEquals(257.3 + 117.0, PhotoLabel.CT_BASELINE, 1e-9)
        assertEquals(90.0, PhotoLabel.CT_SIZE)
    }
}
