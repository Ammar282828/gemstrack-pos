package erp.core

import erp.core.logic.DecodedImage
import erp.core.logic.LabelBitmap
import erp.core.logic.LabelLSC
import erp.core.logic.Zpl
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.models.LabelPrinterSettings
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/label-lsc.test.ts: a made-up design in Label LIVE's file shape (a 50 x 25 mm double tag at 203 dpi), the same text
 * as the TypeScript test, imported to the same fields and printed to the same ZPL (LabelLSCTests.swift).
 */
class LabelLSCTests {
    private val png = "data:image/png;base64,${LabelFixtures.png8x2}"

    /** The design as a JSON string. Each object is `[canvasRecord.objects[i], canvasRecord.fabricRep.objects[i]]`. */
    private fun design(labelConfig: String? = null, variables: String? = null): String {
        fun el(type: String, config: String, hide: Boolean = false) = """{"id":"x","type":"$type","config":$config,"hideOnPrint":$hide}"""

        /** A fabric object: the defaults, then these keys (each value is JSON text), so no key is written twice. */
        fun fo(type: String, extra: List<Pair<String, String>>): String {
            val o = mutableListOf(
                "type" to "\"$type\"", "left" to "0", "top" to "0", "width" to "10", "height" to "10", "scaleX" to "1", "scaleY" to "1",
                "angle" to "0", "originX" to "\"left\"", "originY" to "\"top\"",
            )
            for ((k, v) in extra) {
                val i = o.indexOfFirst { it.first == k }
                if (i >= 0) o[i] = k to v else o.add(k to v)
            }
            return "{" + o.joinToString(",") { "\"${it.first}\":${it.second}" } + "}"
        }
        val objects = listOf(
            el("ELEMENT_TEXT", """{"text":"{SKU_1}\n{PRODUCT_NAME_1}"}""") to
                fo("textbox", listOf("left" to "-150", "top" to "-60", "width" to "100", "height" to "60", "fontSize" to "20", "lineHeight" to "1", "textAlign" to "\"center\"")),
            el("ELEMENT_TEXT", """{"text":"{SKU_2}"}""") to
                fo("textbox", listOf("left" to "150", "top" to "-80", "width" to "60", "height" to "30", "fontSize" to "10", "lineHeight" to "1.2", "angle" to "90")),
            el("ELEMENT_BARCODE", """{"bcid":"qrcode","scale":3,"opts":{"eclevel":"Q"},"rotate":"I","text":"{STALE}"}""") to
                fo("image", listOf("left" to "-100", "top" to "50", "width" to "126", "height" to "126", "scaleX" to "0.5", "scaleY" to "0.5", "originX" to "\"center\"", "originY" to "\"center\"")),
            el("ELEMENT_BARCODE", """{"bcid":"code128","scale":2,"rotate":"N","text":"{SKU_2}","opts":{"includetext":true}}""") to
                fo("image", listOf("left" to "0", "top" to "70", "width" to "200", "height" to "80", "originX" to "\"center\"", "originY" to "\"center\"")),
            el("ELEMENT_IMAGE", """{"kindId":"DITHER_KIND_THRESHOLD"}""") to
                fo("image", listOf("left" to "100", "top" to "60", "width" to "8", "height" to "2", "scaleX" to "4", "scaleY" to "4", "originX" to "\"center\"", "originY" to "\"center\"", "src" to "\"$png\"")),
            el("ELEMENT_IMAGE", """{"kindId":"DITHER_KIND_ATKINSON"}""") to
                fo("image", listOf("left" to "-120", "top" to "60", "width" to "8", "height" to "2", "scaleX" to "2", "scaleY" to "2", "angle" to "90", "originX" to "\"center\"", "originY" to "\"center\"", "src" to "\"$png\"")),
            el("ELEMENT_SHAPE_LINE", """{"stroke":"#000000","strokeWidth":3}""") to
                fo("line", listOf("left" to "0", "top" to "-90", "width" to "100", "height" to "0", "originX" to "\"center\"", "originY" to "\"center\"", "stroke" to "\"#000000\"")),
            el("ELEMENT_SHAPE_LINE", """{"stroke":"#FEFFFF","strokeWidth":3}""") to
                fo("line", listOf("left" to "0", "top" to "0", "width" to "200", "height" to "0", "originX" to "\"center\"", "originY" to "\"center\"", "stroke" to "\"#FEFFFF\"")),
            el("ELEMENT_SHAPE_LINE", """{"stroke":"#000000","strokeWidth":2}""") to
                fo("line", listOf("left" to "180", "top" to "0", "width" to "0", "height" to "60", "originX" to "\"center\"", "originY" to "\"center\"", "stroke" to "\"#000000\"")),
            el("ELEMENT_SHAPE_LINE", """{"stroke":"#000000","strokeWidth":2}""") to
                fo("line", listOf("left" to "0", "top" to "0", "width" to "50", "height" to "50", "stroke" to "\"#000000\"")),
            el("ELEMENT_SHAPE_RECT", """{"fill":null,"stroke":"#000000","strokeWidth":4}""") to
                fo("rect", listOf("left" to "-190", "top" to "-95", "width" to "60", "height" to "30", "rx" to "15")),
            el("ELEMENT_SHAPE_RECT", """{"fill":"#000000","stroke":null,"strokeWidth":0}""", hide = true) to
                fo("rect", listOf("left" to "-190", "top" to "60", "width" to "30", "height" to "30")),
            el("ELEMENT_SHAPE_ELLIPSE", """{"fill":null,"stroke":"#000000","strokeWidth":2}""") to
                fo("ellipse", listOf("left" to "100", "top" to "70", "width" to "40", "height" to "20", "rx" to "20", "ry" to "10")),
            el("ELEMENT_SPARKLE", "{}") to fo("group", listOf("z" to "0")),
            el("ELEMENT_IMAGE", "{}") to fo("image", listOf("src" to "\"data:image/jpeg;base64,/9j/4AAQ\"")),
        )
        val config = labelConfig
            ?: """{"widthMeasure":"50","heightMeasure":"25","dpi":203,"metric":true,"printerConfig":{"DARKNESS":"18","SPEED":"4","THERMAL_MODE":"THERMAL_MODE_DIRECT","MOCK_TARGET_PRINTER":"PRIVATE-PRINTER-NAME"}}"""
        val vars = variables
            ?: """[{"name":"SKU_1","value":"SECRET-SAMPLE"},{"name":"SKU_2","value":"SECRET-SAMPLE"},{"name":"PRODUCT_NAME_1","value":"SECRET-SAMPLE"}]"""
        return """
        {"version":"4.3.3","path":"/Users/someone/designs/private.lsc",
         "labelConfig":$config,
         "canvasRecord":{"fill":"#FEFFFF","objects":[${objects.joinToString(",") { it.first }}],
          "fabricRep":{"version":"5.3.0","objects":[${objects.joinToString(",") { it.second }}]},
          "variables":$vars},
         "ui":{"windowName":"SECRET-WINDOW"},"dataImport":{"data":[{"SKU_1":"SECRET-SAMPLE"}]}}
        """
    }

    private val layout: LabelLayout by lazy { LabelLSC.importDesign(design())!! }
    private fun field(n: Int): LabelLayoutField? = layout.fields.firstOrNull { it.id == "lsc-$n" }

    @Test
    fun testTakesTheLabelSizeDpiTagsAndPrinterSettings() {
        assertEquals(listOf(400, 200, 203, 2), listOf(layout.widthDots, layout.heightDots, layout.dpi ?: 0, layout.tags ?: 0))
        assertEquals(LabelPrinterSettings(thermal = "direct", darkness = 18, speed = 4), layout.printer)
        assertEquals(listOf("lsc-import", "Imported design"), listOf(layout.id, layout.name))
        val named = LabelLSC.importDesign(design(), id = "mine", name = "My tag")!!
        assertEquals(listOf("mine", "My tag"), listOf(named.id, named.name))
    }

    @Test
    fun testReadsASizeInInches() {
        val inch = LabelLSC.importDesign(design(labelConfig = """{"widthMeasure":"2","heightMeasure":"1","dpi":300,"metric":false}"""))!!
        assertEquals(listOf(600, 300, 300), listOf(inch.widthDots, inch.heightDots, inch.dpi ?: 0))
        assertNull(inch.printer)
    }

    @Test
    fun testTurnsATextBoxIntoATextFieldAtItsCornerSizeLinesAndSpacing() {
        assertEquals(
            LabelLayoutField(id = "lsc-1", type = LabelFieldType.text, x = 50, y = 40, data = "{SKU_1}\n{PRODUCT_NAME_1}", name = "Text", fontSize = 20, width = 100, lines = 2, lineSpacing = 3, align = "C"),
            field(1),
        )
    }

    @Test
    fun testPutsATurnedTextBoxAtTheCornerOfItsTurnedBox() {
        assertEquals(
            LabelLayoutField(id = "lsc-2", type = LabelFieldType.text, x = 320, y = 20, rotation = 90, data = "{SKU_2}", name = "Text", fontSize = 10, width = 60, lines = 1, lineSpacing = 4),
            field(2),
        )
    }

    @Test
    fun testTurnsAQRImageIntoAQRFieldAndGivesAStaleSampleTheNearestTagsSKU() {
        assertEquals(
            LabelLayoutField(id = "lsc-3", type = LabelFieldType.qr, x = 69, y = 119, rotation = 180, data = "{SKU_1}", name = "QR code", qrMagnification = 3, errorCorrection = "Q"),
            field(3),
        )
    }

    @Test
    fun testTurnsAnotherBarcodeIntoABarcodeFieldKeepingAVariableOfTheDesign() {
        assertEquals(
            LabelLayoutField(id = "lsc-4", type = LabelFieldType.barcode, x = 100, y = 130, data = "{SKU_2}", name = "Barcode", symbology = "code128", height = 80, moduleWidth = 2, showText = true),
            field(4),
        )
    }

    @Test
    fun testMakesAPictureABitmapAtTheSizeItIsDrawnKeepingItsSource() {
        val a = assertNotNull(field(5))
        assertEquals(LabelFieldType.image, a.type)
        assertEquals(listOf(284, 156, 32, 8, 0), listOf(a.x, a.y, a.width ?: 0, a.height ?: 0, a.rotation))
        assertEquals("threshold", a.dither)
        assertEquals(png, a.source)
        val z = Zpl.render(LabelLayout(id = "i", name = "i", widthDots = 400, heightDots = 200, fields = listOf(a)), listOf(emptyMap()))
        val line = z.split("\n")[1]
        assertEquals("^FO284,156^GFA,32,32,4," + "F00F0FF0".repeat(4) + "0FF00F0F".repeat(4) + "^FS", line)
    }

    @Test
    fun testTurnsAQuarterTurnedPicturesBitsAndSetsItUpright() {
        val b = assertNotNull(field(6))
        assertEquals(listOf(78, 152, 4, 16, 0), listOf(b.x, b.y, b.width ?: 0, b.height ?: 0, b.rotation))
        assertEquals("atkinson", b.dither)
        // 16 x 4 dithered (Atkinson), then a quarter turn clockwise.
        assertEquals("3030C0C0C0C010300000F0703030C0C0", LabelBitmap.hex(b.bitmap ?: "", 4, 16, false)?.hex)
    }

    @Test
    fun testTurnsBlackLinesIntoBarsLeavesOutALineInTheLabelsOwnColourAndASlantedOne() {
        assertEquals(LabelLayoutField(id = "lsc-7", type = LabelFieldType.line, x = 150, y = 9, name = "Line", width = 100, height = 3), field(7))
        assertNull(field(8))
        assertEquals(LabelLayoutField(id = "lsc-9", type = LabelFieldType.line, x = 379, y = 70, name = "Line", width = 2, height = 60), field(9))
        assertNull(field(10))
    }

    @Test
    fun testTurnsRectanglesAndEllipsesIntoBoxesAndEllipsesAHiddenOneStaysHidden() {
        assertEquals(LabelLayoutField(id = "lsc-11", type = LabelFieldType.box, x = 10, y = 5, name = "Box", width = 60, height = 30, thickness = 4, rounding = 8), field(11))
        assertEquals(LabelLayoutField(id = "lsc-12", type = LabelFieldType.box, x = 10, y = 160, hidden = true, name = "Box", width = 30, height = 30, fill = true), field(12))
        assertEquals(LabelLayoutField(id = "lsc-13", type = LabelFieldType.ellipse, x = 300, y = 170, name = "Ellipse", width = 40, height = 20, thickness = 2), field(13))
    }

    @Test
    fun testLeavesOutWhatItDoesNotKnowAndAPictureItCannotDecodeAndCanBeGivenADecoder() {
        assertEquals(listOf("lsc-1", "lsc-2", "lsc-3", "lsc-4", "lsc-5", "lsc-6", "lsc-7", "lsc-9", "lsc-11", "lsc-12", "lsc-13"), layout.fields.map { it.id })
        val withDecoder = LabelLSC.importDesign(design(), imageDecoder = { DecodedImage(1, 1, intArrayOf(0, 0, 0, 255)) })!!
        val last = withDecoder.fields.last()
        assertEquals(listOf(12, 10, 10), listOf(withDecoder.fields.size, last.width ?: 0, last.height ?: 0))
        assertEquals(LabelFieldType.image, last.type)
    }

    @Test
    fun testNeverCarriesAValueAPathOrTheWindow() {
        val json = layout.json.toString()
        for (secret in listOf("SECRET-SAMPLE", "SECRET-WINDOW", "PRIVATE-PRINTER-NAME", "/Users/someone", "private.lsc")) {
            assertFalse(json.contains(secret), secret)
        }
    }

    @Test
    fun testGivesALayoutThatPrints() {
        val z = Zpl.render(
            layout,
            listOf(mapOf("csv:sku" to "TST-000001", "csv:product_name" to "Test Ring"), mapOf("csv:sku" to "TST-000002")),
            now = Instant.ofEpochSecond(0),
        )
        assertTrue(z.startsWith("^XA^CI28^PW400^LL200^LS0^MTD^PR4~SD18\n"))
        assertTrue(z.contains("""^FO50,40^A0N,20,20^FB100,2,3,C^FH_^FDTST-000001\&Test Ring^FS""" + "\n"))
        assertTrue(z.contains("""^FO320,20^A0R,10,10^FB60,1,4,L^FH_^FDTST-000002^FS""" + "\n"))
        assertFalse(z.contains("{"))
    }

    @Test
    fun testGivesNilForWhatIsNotADesign() {
        assertNull(LabelLSC.importDesign("not json"))
        assertNull(LabelLSC.importDesign("[]"))
        assertNull(LabelLSC.importDesign("""{"labelConfig":{}}"""))
        assertNull(LabelLSC.importDesign("null"))
    }

    @Test
    fun testKeepsOneTagWhenTheVariablesAreNotNumbered() {
        val plain = LabelLSC.importDesign(design(variables = """[{"name":"SKU","value":""},{"name":"PRICE_2","value":""}]"""))!!
        assertNull(plain.tags)
        // ...and a stale QR sample then takes the plain {sku}.
        assertEquals("{sku}", plain.fields.firstOrNull { it.id == "lsc-3" }?.data)
    }
}
