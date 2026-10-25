package erp.core

import erp.core.logic.Dither
import erp.core.logic.LabelBitmap
import erp.core.logic.PNG
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** src/lib/label-bitmap.test.ts (base64, bitmaps, PNG), with the same pictures and the same bits (LabelBitmapTests.swift). */
class LabelBitmapTests {
    private fun bytes(vararg v: Int) = intArrayOf(*v)

    @Test
    fun testBase64EncodesAndDecodesWithOrWithoutPadding() {
        assertEquals("", LabelBitmap.base64Encode(bytes()))
        assertEquals("YQ==", LabelBitmap.base64Encode(bytes(0x61)))
        assertEquals("YWI=", LabelBitmap.base64Encode(bytes(0x61, 0x62)))
        assertEquals("YWJj", LabelBitmap.base64Encode(bytes(0x61, 0x62, 0x63)))
        assertContentEquals(bytes(0x61, 0x62, 0x63), LabelBitmap.base64Decode("YWJj"))
        assertContentEquals(bytes(0x61, 0x62), LabelBitmap.base64Decode("YW I=\n"))
        assertContentEquals(bytes(0x61), LabelBitmap.base64Decode("YQ"))
        assertNull(LabelBitmap.base64Decode("YQ=x"))
        assertNull(LabelBitmap.base64Decode("a\$b"))
        assertEquals("000F10FF", LabelBitmap.hex(bytes(0, 15, 16, 255)))
    }

    @Test
    fun testTurnsAPictureByQuarterTurns() {
        // 3 x 2:  1 0 0 / 0 1 1
        val b = bytes(0b10000000, 0b01100000)
        val half = LabelBitmap.rotate(b, 3, 2, 2)
        assertEquals(listOf(3, 2), listOf(half.width, half.height))
        assertContentEquals(bytes(0b11000000, 0b00100000), half.bytes)
        val quarter = LabelBitmap.rotate(b, 3, 2, 1)
        assertEquals(listOf(2, 3), listOf(quarter.width, quarter.height))
        assertContentEquals(bytes(0b01000000, 0b10000000, 0b10000000), quarter.bytes)
        val three = LabelBitmap.rotate(b, 3, 2, 3)
        assertEquals(listOf(2, 3), listOf(three.width, three.height))
        assertContentEquals(bytes(0b01000000, 0b01000000, 0b10000000), three.bytes)
        assertContentEquals(b, LabelBitmap.rotate(b, 3, 2, 4).bytes)
    }

    @Test
    fun testGivesTheGFAHexPaddedOrCutToTheSize() {
        val a = LabelBitmap.hex("qoDAwA==", 10, 2, false)
        assertEquals(listOf("AA80C0C0", "4", "2"), listOf(a?.hex, "${a?.total ?: 0}", "${a?.bytesPerRow ?: 0}"))
        val b = LabelBitmap.hex("qoDAwA==", 10, 1, false)
        assertEquals(listOf("AA80", "2", "2"), listOf(b?.hex, "${b?.total ?: 0}", "${b?.bytesPerRow ?: 0}"))
        val c = LabelBitmap.hex("qg==", 10, 2, true)
        assertEquals(listOf("00001540", "4", "2"), listOf(c?.hex, "${c?.total ?: 0}", "${c?.bytesPerRow ?: 0}"))
        assertNull(LabelBitmap.hex("***", 8, 1, false))
    }

    private fun hex(bitmap: String, w: Int, h: Int): String? = LabelBitmap.hex(bitmap, w, h, false)?.hex

    @Test
    fun testMakesABitmapFromPixelsGreyOnWhiteClearCountsAsWhite() {
        val png = assertNotNull(PNG.decodeDataURL("data:image/png;base64,${LabelFixtures.png8x2}"))
        assertEquals(listOf(8, 2), listOf(png.width, png.height))
        val b = LabelBitmap.fromRaster(png.rgba, 8, 2, 8, 2)
        assertEquals("lmU=", b)
        assertEquals("9665", hex(b, 8, 2))
        // Squeezed to 4 x 1, a dot averages a 2 x 2 block: only the last, at 45% grey, is darker than half.
        assertEquals("10", hex(LabelBitmap.fromRaster(png.rgba, 8, 2, 4, 1), 4, 1))
        // A lower threshold prints less; brightness lifts the greys.
        assertEquals("8661", hex(LabelBitmap.fromRaster(png.rgba, 8, 2, 8, 2, threshold = 0.3), 8, 2))
        assertEquals("8661", hex(LabelBitmap.fromRaster(png.rgba, 8, 2, 8, 2, brightness = 0.2), 8, 2))
        // Blown up, each pixel is several dots.
        assertEquals("C33C3C33", hex(LabelBitmap.fromRaster(png.rgba, 8, 2, 16, 2), 16, 2))
    }

    @Test
    fun testDithersAGreyRampTheWayAtkinsonAndFloydSteinbergDo() {
        val grey = intArrayOf(0, 36, 72, 108, 144, 180, 216, 252)
        val rgba = (grey.toList() + grey.toList()).flatMap { listOf(it, it, it, 255) }.toIntArray()
        fun bits(d: Dither) = hex(LabelBitmap.fromRaster(rgba, 8, 2, 8, 2, dither = d), 8, 2)
        assertEquals("F0F0", bits(Dither.threshold))
        assertEquals("F0E4", bits(Dither.atkinson))
        assertEquals("E8E8", bits(Dither.floyd))
    }

    // MARK: PNG

    @Test
    fun testInflatesAStoredBlock() {
        val z = bytes(0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63, 0x02, 0x4d, 0x01, 0x27)
        assertContentEquals(bytes(0x61, 0x62, 0x63), PNG.inflate(z))
        assertNull(PNG.inflate(bytes(0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0x00, 0x61)))
        assertNull(PNG.inflate(bytes(1, 2, 3)))
    }

    @Test
    fun testReadsEveryPixelThroughDynamicHuffmanCodesAndAllFiveFilters() {
        val img = assertNotNull(PNG.decode(assertNotNull(LabelBitmap.base64Decode(LabelFixtures.png24x20))))
        assertEquals(listOf(24, 20), listOf(img.width, img.height))
        for (y in 0 until 20) {
            for (x in 0 until 24) {
                val i = (y * 24 + x) * 4
                assertEquals(
                    listOf((x * 10) and 255, (y * 12) and 255, (x * y) and 255, 255),
                    listOf(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]),
                    "pixel $x,$y",
                )
            }
        }
    }

    @Test
    fun testGivesNilForWhatItCannotRead() {
        assertNull(PNG.decode(bytes(1, 2, 3)))
        assertNull(PNG.decodeDataURL("data:text/plain;base64,AAAA"))
        assertNull(PNG.decodeDataURL("https://example.test/a.png"))
        val cut = assertNotNull(LabelBitmap.base64Decode(LabelFixtures.png24x20)).copyOfRange(0, 120)
        assertNull(PNG.decode(cut))
        assertNull(PNG.decodeDataURL("data:image/*;base64,!!!"))
    }
}
