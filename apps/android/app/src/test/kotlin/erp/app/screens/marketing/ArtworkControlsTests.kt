package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ArtworkControlsTests {
    private fun frame(w: Double, h: Double? = null, iz: Double? = null): MarketingValue {
        var v = MarketingValue.obj("w" to w)
        if (h != null) v = v.with("h", h)
        if (iz != null) v = v.with("iz", iz)
        return v
    }

    @Test fun panningKeepsThePhotoCoveringItsFrame() {
        // A 1000 x 500 picture in a 400 x 400 frame: it covers by height, so only across has room (200 px spare... 400 * 1000/500 = 800 wide, 400 spare).
        val (fx, fy) = ArtworkPixels.panned(frame(400.0, 400.0), 1000.0 to 500.0, 0.5, 0.5, dx = -100.0, dy = 50.0)
        assertEquals(0.75, fx)
        assertEquals(0.5, fy)
        // dragged past the edge it stops at the edge
        assertEquals(1.0, ArtworkPixels.panned(frame(400.0, 400.0), 1000.0 to 500.0, 0.5, 0.5, dx = -5000.0, dy = 0.0).first)
        assertEquals(0.0, ArtworkPixels.panned(frame(400.0, 400.0), 1000.0 to 500.0, 0.5, 0.5, dx = 5000.0, dy = 0.0).first)
    }

    @Test fun zoomMakesRoomInBothDirections() {
        val (fx, fy) = ArtworkPixels.panned(frame(400.0, 400.0, iz = 2.0), 500.0 to 500.0, 0.5, 0.5, dx = 40.0, dy = -40.0)
        // spare = 400 * 2 - 400 = 400 each way; the crop moves 40/400 against the drag
        assertEquals(0.4, fx)
        assertEquals(0.6, fy)
    }

    @Test fun anUnknownPictureSizeTakesTheFramesOwn() {
        val (fx, fy) = ArtworkPixels.panned(frame(300.0), null, 0.2, 0.9, dx = 10.0, dy = 10.0)
        // the frame has no height: the picture is as wide as it, so there is no room and the crop centres
        assertEquals(0.5, fx)
        assertEquals(0.5, fy)
    }

    @Test fun anSvgsSizeIsItsWidthAndHeightElseItsViewBox() {
        assertEquals(120.0 to 40.0, ArtworkLogo.svgSize("""<svg xmlns="x" width="120" height="40"><rect/></svg>"""))
        assertEquals(300.0 to 100.0, ArtworkLogo.svgSize("""<svg viewBox="0 0 300 100"><g/></svg>"""))
        assertEquals(24.0 to 24.0, ArtworkLogo.svgSize("""<SVG VIEWBOX='0,0,24,24'></SVG>"""))
        assertEquals(600.0 to 600.0, ArtworkLogo.svgSize("<svg></svg>"))
    }

    @Test fun aLogoFileIsAnImageLayerCentredAtMostSixHundredWide() {
        val svg = """<svg width="1200" height="600"></svg>""".toByteArray()
        val layer = assertNotNull(ArtworkLogo.uploadLayer(svg, 1080.0, 1920.0))
        assertEquals("image", layer.s("kind"))
        assertTrue(layer.s("src").startsWith("data:image/svg+xml;base64,"))
        assertEquals(600.0, layer.n("w"))
        // 600 wide, 300 tall; centred across, at 45% down
        assertEquals(240.0, layer.n("x"))
        assertEquals(714.0, layer.n("y"))
        assertEquals("Logo file", layer.s("name"))
        assertTrue(layer.s("id").startsWith("upload-"))
        assertTrue(layer["border"].isNull)
    }

    @Test fun aPngLogoReadsItsSizeFromItsHeader() {
        val header = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 128.toByte())
        assertEquals(256.0 to 128.0, ArtworkPixels.pngSize(header))
        val layer = assertNotNull(ArtworkLogo.uploadLayer(header, 1080.0, 1080.0))
        assertTrue(layer.s("src").startsWith("data:image/png;base64,"))
        assertEquals(256.0, layer.n("w"))
        assertEquals(412.0, layer.n("x"))
    }

    @Test fun anythingElseIsNotALogo() {
        assertNull(ArtworkLogo.uploadLayer("hello".toByteArray(), 1080.0, 1920.0))
        assertNull(ArtworkLogo.uploadLayer(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0, 0, 0, 0, 0), 1080.0, 1920.0))
    }

    @Test fun theMonogramIsTheTallTTopRight() {
        val m = ArtworkLogo.monogram("#FFFFFF")
        assertEquals("wordmark", m.s("kind"))
        assertEquals("t", m.s("mark"))
        assertEquals(930.0, m.n("x"))
        assertEquals(140.0, m.n("y"))
        assertEquals(60.0, m.n("width"))
        assertEquals("#FFFFFF", m.s("color"))
        assertTrue(m.s("id").matches(Regex("t-[0-9a-f]{6}")))
    }

    @Test fun theInkFollowsThePhotoOrTheGround() {
        assertEquals("#FFFFFF", ArtworkLogo.ink(NativeArtwork.blank("p1")))
        // the default cream ground is light: dark ink
        assertEquals("#111111", ArtworkLogo.ink(NativeArtwork.blank()))
        assertEquals("#FFFFFF", ArtworkLogo.ink(NativeArtwork.blank().withPath(listOf("bg", "color"), MarketingValue.string("#101820"))))
        assertEquals("#111111", ArtworkLogo.ink(NativeArtwork.blank().withPath(listOf("bg", "color"), MarketingValue.string("not a colour"))))
    }

    @Test fun coloursAreSixDigitHexInCapitals() {
        assertEquals(Triple(255, 0, 128), ArtworkColor.parse("#FF0080"))
        assertEquals(Triple(170, 187, 204), ArtworkColor.parse("abc"))
        assertNull(ArtworkColor.parse("#12345"))
        assertNull(ArtworkColor.parse("#GGGGGG"))
        assertEquals("#FF0080", ArtworkColor.hex(255, 0, 128))
        // out of range bytes (a wide-gamut colour) are clamped, never more than six digits
        assertEquals("#00FF00", ArtworkColor.hex(-5, 300, 0))
    }

    @Test fun propertiesAreNamedInTheEditorsWords() {
        assertEquals("Across", ArtworkProperties.label("x"))
        assertEquals("Mirror down", ArtworkProperties.label("flipY"))
        assertEquals("Letter spacing", ArtworkProperties.label("spacing"))
        assertEquals("Font Size", ArtworkProperties.label("fontSize"))
        assertEquals("Serif italic", ArtworkProperties.label("serif-italic"))
        assertEquals("Heading", ArtworkProperties.label("heading"))
        assertTrue(ArtworkProperties.isColorKey("fill2"))
        assertTrue(ArtworkProperties.isColorKey("bgColor"))
        assertEquals(14, ArtworkProperties.choices.getValue("font").size)
        assertEquals("12", ArtworkProperties.numberText(12.0))
        assertEquals("0.35", ArtworkProperties.numberText(0.35))
        assertEquals("1.5", ArtworkProperties.numberText(1.5))
    }

    @Test fun theGradientStartsAsTheWebsDefault() {
        val s = ArtworkShade.standard
        assertEquals("#000000", s.s("from"))
        assertEquals(0.7, s.n("toAlpha"))
        assertEquals(180.0, s.n("angle"))
        assertEquals(0.4, s.n("start"))
        assertEquals(6, ArtworkShade.ways.size)
        assertEquals(Triple(135, "↘", "Down and right"), ArtworkShade.ways[4])
    }
}
