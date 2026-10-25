package erp.core

import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.models.LabelPrinterSettings
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The tag model (src/lib/label-layout.ts): lenient to read, the web's JSON to write, and the fields `saveLabelLayout`
 * (src/lib/writes/label-layout.ts) takes. All values are made up. (LabelLayoutTests.swift, case for case.)
 */
class LabelLayoutTests {
    private fun decode(json: String): LabelLayout = LabelLayout.from(Json.parse(json))!!
    private fun obj(l: LabelLayout): Any? = canon(l.json)
    private fun parse(json: String): Any? = canon(Json.parse(json))

    @Test
    fun testAnOlderLayoutLoadsAndSavesAsTheWebStoredIt() {
        val json = """{"id":"o","name":"Old","widthDots":300,"heightDots":200,"fields":[{"id":"a","type":"text","x":1,"y":2,"data":"Hi {sku}","fontSize":20,"fontFamily":"0","rotation":90},{"id":"b","type":"qr","x":3,"y":4,"data":"{sku}","qrMagnification":3}]}"""
        val l = decode(json)
        assertEquals(2, l.fields.size)
        assertEquals(LabelLayoutField(id = "a", type = LabelFieldType.text, x = 1, y = 2, rotation = 90, data = "Hi {sku}", fontFamily = "0", fontSize = 20), l.fields[0])
        assertEquals(parse(json), obj(l))
    }

    @Test
    fun testTheStandardTagIsTheWebsStandardTag() {
        assertEquals(
            parse("""{"id":"zebra-2000t-jewellery","name":"Zebra 2000T Jewellery Tag (83x37mm)","widthDots":664,"heightDots":296,"fields":[{"id":"sku-left","type":"text","x":100,"y":150,"data":"SKU: {sku}","fontSize":20,"rotation":90},{"id":"qr-right","type":"qr","x":450,"y":80,"data":"{sku}","qrMagnification":4}]}"""),
            obj(LabelLayout.standard),
        )
    }

    @Test
    fun testReadsLeniently() {
        val l = decode(
            """
            {"id":7,"name":"Odd","widthDots":"400","heightDots":200.4,"dpi":"300","tags":"2","fields":{"1":{"id":"b","type":"qr","x":"5","y":6.5,"data":"{sku}","rotation":45},
             "0":{"id":"a","type":"text","x":-2.5,"y":"x","data":12,"hidden":"true","bold":1}},"printer":{"darkness":"12","mirror":"yes","thermal":5}}
            """,
        )
        assertEquals(listOf("7", "Odd"), listOf(l.id, l.name))
        assertEquals(listOf(400, 200, 300, 2), listOf(l.widthDots, l.heightDots, l.dpi ?: 0, l.tags ?: 0))
        // A list keyed by index reads in index order; a rotation that is not a quarter turn is 0; a half goes up.
        assertEquals(listOf("a", "b"), l.fields.map { it.id })
        assertEquals(listOf(-2, 0, 5, 7, 0), listOf(l.fields[0].x, l.fields[0].y, l.fields[1].x, l.fields[1].y, l.fields[1].rotation))
        assertEquals("12", l.fields[0].data)
        assertTrue(l.fields[0].hidden)
        assertEquals(true, l.fields[0].bold)
        assertEquals(LabelPrinterSettings(thermal = "5", darkness = 12, mirror = true), l.printer)
    }

    @Test
    fun testDropsAFieldWithoutAnIdOrOfATypeItDoesNotKnow() {
        val l = decode("""{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[{"id":"","type":"text"},{"id":"a","type":"hologram"},{"id":"b","type":"box","width":4,"height":5},{"type":"qr"},5,null]}""")
        assertEquals(listOf("b"), l.fields.map { it.id })
    }

    @Test
    fun testAMissingOrOddLayoutReadsAsEmptyNotAnError() {
        val l = decode("{}")
        assertEquals(listOf("", "", "0", "0"), listOf(l.id, l.name, "${l.widthDots}", "${l.heightDots}"))
        assertFalse(l.hasSize)
        assertTrue(l.fields.isEmpty())
        assertEquals(1, l.tagsPerLabel)
        assertTrue(LabelLayout.standard.hasSize)
    }

    @Test
    fun testFoldsTheOlderTopLevelDarknessAndSpeedIntoPrinterAndWritesThemThere() {
        val l = decode("""{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"darkness":10,"speed":5,"printer":{"darkness":20}}""")
        assertEquals(LabelPrinterSettings(darkness = 20, speed = 5), l.printer)
        assertEquals(parse("""{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"printer":{"darkness":20,"speed":5}}"""), obj(l))
        assertNull(decode("""{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"printer":{}}""").json["printer"])
    }

    @Test
    fun testWritesEveryFieldTheDesignerAddsAndOnlyThose() {
        val l = LabelLayout(
            id = "n", name = "New", widthDots = 664, heightDots = 296, dpi = 300, tags = 2,
            printer = LabelPrinterSettings(thermal = "transfer", mode = "tear", media = "gap", darkness = 15, speed = 6, labelTop = -3, labelShift = 4, tearOff = 7, orientation = "normal", mirror = false, homeX = 1, homeY = 2),
            fields = listOf(
                LabelLayoutField(id = "t", type = LabelFieldType.text, x = 1, y = 2, rotation = 270, data = "A\nB", hidden = true, locked = true, name = "Title", fontFamily = "D", fontSize = 30, width = 200, lines = 2, lineSpacing = -2, align = "C", bold = true),
                LabelLayoutField(id = "q", type = LabelFieldType.qr, x = 3, y = 4, data = "{sku}", qrMagnification = 5, errorCorrection = "H"),
                LabelLayoutField(id = "b", type = LabelFieldType.barcode, x = 5, y = 6, data = "{sku}", symbology = "ean13", height = 50, moduleWidth = 3, showText = true),
                LabelLayoutField(id = "x", type = LabelFieldType.box, x = 7, y = 8, width = 20, height = 10, thickness = 3, rounding = 4, fill = false),
                LabelLayoutField(id = "i", type = LabelFieldType.image, x = 9, y = 9, rotation = 180, width = 10, height = 2, bitmap = "qoDAwA==", dither = "atkinson", threshold = 0.4, source = "data:image/png;base64,AAAA"),
            ),
        )
        val expected = parse(
            """
            {"id":"n","name":"New","widthDots":664,"heightDots":296,"dpi":300,"tags":2,
             "printer":{"thermal":"transfer","mode":"tear","media":"gap","darkness":15,"speed":6,"labelTop":-3,"labelShift":4,"tearOff":7,"orientation":"normal","mirror":false,"homeX":1,"homeY":2},
             "fields":[
              {"id":"t","type":"text","x":1,"y":2,"rotation":270,"data":"A\nB","hidden":true,"locked":true,"name":"Title","fontFamily":"D","fontSize":30,"width":200,"lines":2,"lineSpacing":-2,"align":"C","bold":true},
              {"id":"q","type":"qr","x":3,"y":4,"data":"{sku}","qrMagnification":5,"errorCorrection":"H"},
              {"id":"b","type":"barcode","x":5,"y":6,"data":"{sku}","symbology":"ean13","height":50,"moduleWidth":3,"showText":true},
              {"id":"x","type":"box","x":7,"y":8,"width":20,"height":10,"thickness":3,"rounding":4,"fill":false},
              {"id":"i","type":"image","x":9,"y":9,"rotation":180,"width":10,"height":2,"bitmap":"qoDAwA==","dither":"atkinson","threshold":0.4,"source":"data:image/png;base64,AAAA"}]}
            """,
        )
        assertEquals(expected, obj(l))
        // ...and reads back as the same layout.
        assertEquals(l, LabelLayout.from(l.json))
    }

    @Test
    fun testTheSaveTakesTheLayoutAndASequenceNumber() {
        val fields = LabelLayout.standard.saveFields("abc")
        assertEquals("saveLabelLayout", LabelLayout.saveOp)
        assertEquals(setOf("layout", "seq"), fields.keys)
        assertEquals("abc", fields["seq"])
        assertEquals(obj(LabelLayout.standard), canon(fields["layout"]))
        assertNotEquals(LabelLayout.standard.saveFields()["seq"], LabelLayout.standard.saveFields()["seq"])
        assertTrue(ERPDecode.isValidJsonObject(fields))
    }

    @Test
    fun testTheSettingsDocumentCarriesTheLayout() {
        val withLayout = ERPDecode.model<Settings>(mapOf("shopName" to "Demo", "labelLayout" to LabelLayout.standard.json))!!
        assertEquals(LabelLayout.standard, withLayout.labelLayout)
        assertNull(ERPDecode.model<Settings>(mapOf("shopName" to "Demo"))!!.labelLayout)
        assertNull(ERPDecode.model<Settings>(mapOf("labelLayout" to "junk"))!!.labelLayout)
        assertNotNull(withLayout.labelLayout)
    }

    @Test
    fun testTagsPerLabelIsHeldBetweenOneAndTwelve() {
        fun n(tags: Int?) = LabelLayout(id = "t", name = "T", widthDots = 1, heightDots = 1, tags = tags).tagsPerLabel
        assertEquals(listOf(1, 1, 1, 1, 2, 12, 12), listOf(n(null), n(0), n(-3), n(1), n(2), n(12), n(40)))
    }
}
