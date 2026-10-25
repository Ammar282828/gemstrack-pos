package erp.core

import erp.core.logic.LabelValues
import erp.core.logic.Zpl
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.models.LabelPrinterSettings
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** src/lib/zebra-zpl.test.ts, case for case (ZplTests.swift): the expected strings are the same ones. All values are made up. */
class ZplTests {
    private val p1: LabelValues = mapOf(
        "sku" to "TST-000001", "name" to "Test Ring", "price" to "Rs 12500", "priceNumber" to "12500", "weight" to "4.250 g", "weightNumber" to "4.250",
        "csv:sku" to "TST-000001", "csv:product_name" to "Test Ring", "csv:metal_weight_g" to "4.250", "csv:total_price_pkr" to "12500",
    )
    private val p2: LabelValues = mapOf(
        "sku" to "TST-000002", "name" to "Test Band", "price" to "Rs 800", "priceNumber" to "800", "weight" to "1.5 g", "weightNumber" to "1.500",
        "csv:sku" to "TST-000002", "csv:product_name" to "Test Band", "csv:metal_weight_g" to "1.500", "csv:total_price_pkr" to "800",
    )

    /** 25 Oct 2026, 00:05:09 in Karachi (UTC+5), a Sunday. */
    private val now = Instant.ofEpochSecond(1_792_868_709)
    private val head = "^XA^CI28^PW400^LL200^LS0\n"
    private val foot = "^PQ1,0,1,Y^XZ\n"

    private fun layout(fields: List<LabelLayoutField>, tags: Int? = null, printer: LabelPrinterSettings? = null) =
        LabelLayout(id = "t", name = "T", widthDots = 400, heightDots = 200, tags = tags, printer = printer, fields = fields)

    private fun text(
        data: String, x: Int = 10, y: Int = 20, rotation: Int = 0, fontFamily: String? = null, fontSize: Int? = null, width: Int? = null,
        lines: Int? = null, lineSpacing: Int? = null, align: String? = null, bold: Boolean? = null,
    ) = LabelLayoutField(
        id = "a", type = LabelFieldType.text, x = x, y = y, rotation = rotation, data = data, fontFamily = fontFamily, fontSize = fontSize,
        width = width, lines = lines, lineSpacing = lineSpacing, align = align, bold = bold,
    )

    private fun one(f: LabelLayoutField, l: LabelLayout? = null, pieces: List<LabelValues>? = null): String {
        val lay = (l ?: layout(emptyList())).copy(fields = listOf(f))
        return Zpl.render(lay, pieces ?: listOf(p1), now = now)
    }

    /** The whole label: the head, these lines, the foot. */
    private fun label(vararg lines: String): String = head + lines.joinToString("") { it + "\n" } + foot

    private fun field(json: String): LabelLayoutField = LabelLayoutField.decode(Json.parse(json))!!

    // MARK: Placeholders

    @Test
    fun testFillsPieceFieldsAndCsvColumnsWithNForTheNthPieceOfTheLabel() {
        assertEquals("TST-000001 Test Ring", Zpl.resolveText("{sku} {name}", listOf(p1)))
        assertEquals(
            "TST-000001|TST-000002|Test Band|4.250|12500",
            Zpl.resolveText("{SKU_1}|{SKU_2}|{PRODUCT_NAME_2}|{METAL_WEIGHT_G_1}|{TOTAL_PRICE_PKR}", listOf(p1, p2)),
        )
        assertEquals("TST-000002 {csv_sku}", Zpl.resolveText("{sku_2} {csv_sku}", listOf(p1, p2)))
    }

    @Test
    fun testPrintsATagWithNoPieceBlankAndLeavesAKeyThatMeansNothingAsTyped() {
        assertEquals("[][][]", Zpl.resolveText("[{SKU_2}][{name_2}][{TOTAL_PRICE_PKR_2}]", listOf(p1)))
        assertEquals("[]", Zpl.resolveText("[{sku}]", emptyList()))
        assertEquals("{skux} {SKU_0} {} {a b} {sku", Zpl.resolveText("{skux} {SKU_0} {} {a b} {sku", listOf(p1)))
        assertEquals("{TST-000001} }Test Ring", Zpl.resolveText("{{sku}} }{name}", listOf(p1)))
    }

    @Test
    fun testFormatsDateAndTimeInKarachiTime() {
        assertEquals("25 Oct 2026", Zpl.resolveText("{date}", emptyList(), now = now))
        assertEquals("25/10/26 Sunday 25 October 2026", Zpl.resolveText("{date:dd/MM/yy} {date:EEEE d MMMM yyyy}", emptyList(), now = now))
        assertEquals("00:05 12:05 AM 00:05:09", Zpl.resolveText("{time} {time:h:mm a} {time:HH:mm:ss}", emptyList(), now = now))
        assertEquals("2026-10-25 at 0 o'clock Sun", Zpl.formatDate("yyyy-MM-dd 'at' H 'o''clock' EEE", now))
        assertEquals("02 2 4 3 PM", Zpl.formatDate("hh h m s a", Instant.ofEpochSecond(1_767_603_843)))
    }

    @Test
    fun testNumbersLabelsWithCounter() {
        assertEquals("1", Zpl.resolveText("{counter}", emptyList(), labelIndex = 0))
        assertEquals("5", Zpl.resolveText("{counter}", emptyList(), labelIndex = 4))
        assertEquals("000115", Zpl.resolveText("{counter:100:5:6}", emptyList(), labelIndex = 3))
        assertEquals("005", Zpl.resolveText("{counter::2:3}", emptyList(), labelIndex = 2))
        assertEquals("-5", Zpl.resolveText("{counter:10:-3}", emptyList(), labelIndex = 5))
        assertEquals("0052", Zpl.resolveText("{counter:1:1:4}", emptyList(), labelIndex = 2, now = now, counterStart = 50))
    }

    @Test
    fun testTransformsWithAPipe() {
        assertEquals("Rs Rs 12500/-", Zpl.resolveText("{price|prefix:Rs |suffix:/-}", listOf(p1)))
        assertEquals("Rs 12500/-", Zpl.resolveText("{priceNumber|prefix:Rs |suffix:/-}", listOf(p1)))
        assertEquals("TEST RING test ring", Zpl.resolveText("{name|upper} {name|lower}", listOf(p1)))
        assertEquals("4.25 4.3 4", Zpl.resolveText("{weight|fixed:2} {weightNumber|fixed:1} {weightNumber|fixed:0}", listOf(p1)))
        assertEquals("12,500 Rs 12,500 {csv_x|group}", Zpl.resolveText("{priceNumber|group} {price|group} {csv_x|group}", listOf(p1)))
        assertEquals("Test||Test Ring", Zpl.resolveText("{name|max:4}|{name|max:0}|{name|max:99}", listOf(p1)))
        assertEquals("TES.", Zpl.resolveText("{name|upper|max:3|suffix:.}", listOf(p1)))
        assertEquals("[]", Zpl.resolveText("[{SKU_2|prefix:#}]", listOf(p1)))
        assertEquals("Test Ring", Zpl.resolveText("{name|nothing}", listOf(p1)))
    }

    @Test
    fun testLeavesOtherTextAccentsAndBracesAlone() {
        assertEquals("Ring — 22k TST-000001", Zpl.resolveText("Ring — 22k {sku}", listOf(p1)))
        assertEquals("1,234,567.50", Zpl.resolveText("{price|group}", listOf(mapOf("price" to "1234567.50"))))
    }

    // MARK: Escaping

    @Test
    fun testSendsCaretTildeAndBackslashAsHexUnderFH() {
        assertEquals("a_5Eb_7Ec_5Cd", Zpl.escape("a^b~c\\d", "\\&"))
        assertEquals("a\\&b", Zpl.escape("a\nb", "\\&"))
        assertEquals("a_0Ab", Zpl.escape("a\nb", "_0A"))
        assertEquals(label("""^FO10,20^A0N,20,20^FH_^FD50% _5Eoff_7E _5C^FS"""), one(text("50% ^off~ \\")))
    }

    // MARK: Text

    @Test
    fun testDrawsTheStandardTag() {
        assertEquals(
            "^XA^CI28^PW664^LL296^LS0\n" + """^FO100,150^A0R,20,20^FH_^FDSKU: TST-000001^FS""" + "\n" + """^FO450,80^BQN,2,4,M^FH_^FDMA,TST-000001^FS""" + "\n^PQ1,0,1,Y^XZ\n",
            Zpl.render(LabelLayout.standard, listOf(p1), now = now),
        )
    }

    @Test
    fun testPicksTheFontSizeOrientation() {
        assertEquals(label("""^FO10,20^ADI,30,30^FH_^FDHi^FS"""), one(text("Hi", rotation = 180, fontFamily = "D", fontSize = 30)))
        assertEquals(label("""^FO10,20^A0B,20,20^FH_^FDHi^FS"""), one(text("Hi", rotation = 270)))
    }

    @Test
    fun testWrapsInABlockWithAWidth() {
        assertEquals(label("""^FO10,20^A0N,20,20^FB120,2,0,C^FH_^FDa\&b^FS"""), one(text("a\nb", width = 120, align = "C")))
        assertEquals(label("""^FO10,20^A0N,20,20^FB120,3,-4,R^FH_^FDa^FS"""), one(text("a", width = 120, lines = 3, lineSpacing = -4, align = "R")))
    }

    @Test
    fun testGivesEachLineItsOwnFieldWithoutAWidthAndTurnsTheStackWithTheText() {
        fun f(rotation: Int) = one(text("a\nb\nc", x = 100, y = 100, rotation = rotation, fontSize = 20, lineSpacing = 2))
        assertEquals(label("""^FO100,100^A0N,20,20^FH_^FDa^FS""", """^FO100,122^A0N,20,20^FH_^FDb^FS""", """^FO100,144^A0N,20,20^FH_^FDc^FS"""), f(0))
        assertEquals(label("""^FO144,100^A0R,20,20^FH_^FDa^FS""", """^FO122,100^A0R,20,20^FH_^FDb^FS""", """^FO100,100^A0R,20,20^FH_^FDc^FS"""), f(90))
        assertEquals(label("""^FO100,144^A0I,20,20^FH_^FDa^FS""", """^FO100,122^A0I,20,20^FH_^FDb^FS""", """^FO100,100^A0I,20,20^FH_^FDc^FS"""), f(180))
        assertEquals(label("""^FO100,100^A0B,20,20^FH_^FDa^FS""", """^FO122,100^A0B,20,20^FH_^FDb^FS""", """^FO144,100^A0B,20,20^FH_^FDc^FS"""), f(270))
    }

    @Test
    fun testDrawsBoldTextTwiceADotApart() {
        assertEquals(label("""^FO10,20^A0N,20,20^FH_^FDB^FS""", """^FO11,20^A0N,20,20^FH_^FDB^FS"""), one(text("B", bold = true)))
    }

    @Test
    fun testRoundsAndBoundsPositionsAndDefaultsTheSize() {
        // 10.5 reads as 11 (a half goes up), -3 as 0.
        val a = field("""{"id":"a","type":"text","x":10.5,"y":-3,"fontSize":0,"data":"x"}""")
        assertEquals(label("""^FO11,0^A0N,20,20^FH_^FDx^FS"""), one(a))
        val b = field("""{"id":"a","type":"text","x":99999,"y":0.4,"fontSize":12.6,"data":"x"}""")
        assertEquals(label("""^FO32000,0^A0N,13,13^FH_^FDx^FS"""), one(b))
    }

    @Test
    fun testFillsThePlaceholdersOfEachPieceIntoOneLabel() {
        assertEquals(
            label("""^FO10,20^A0N,20,20^FB50,1,0,L^FH_^FDTST-000001/TST-000002^FS"""),
            Zpl.render(layout(listOf(text("{SKU_1}/{SKU_2}", width = 50)), tags = 2), listOf(p1, p2), now = now),
        )
    }

    // MARK: Codes

    private fun qr(data: String = "{sku}", rotation: Int = 0, mag: Int? = null, ec: String? = null) =
        LabelLayoutField(id = "q", type = LabelFieldType.qr, x = 5, y = 6, rotation = rotation, data = data, qrMagnification = mag, errorCorrection = ec)

    @Test
    fun testDrawsAQRCode() {
        assertEquals(label("""^FO5,6^BQN,2,2,M^FH_^FDMA,TST-000001^FS"""), one(qr()))
        assertEquals(label("""^FO5,6^BQR,2,7,H^FH_^FDHA,TST-000001^FS"""), one(qr(rotation = 90, mag = 7, ec = "H")))
        assertEquals(label("""^FO5,6^BQN,2,10,M^FH_^FDMA,TST-000001^FS"""), one(qr(mag = 40)))
        assertEquals(label("""^FO5,6^BQN,2,2,M^FH_^FDMA,a_5Eb^FS"""), one(qr(data = "a^b")))
    }

    @Test
    fun testDrawsNothingForACodeWithNoData() {
        assertEquals(head + foot, one(qr(data = "{SKU_2}")))
        assertEquals(head + foot, one(LabelLayoutField(id = "b", type = LabelFieldType.barcode, x = 1, y = 1, data = "")))
    }

    @Test
    fun testDrawsEachBarcodeKind() {
        fun bc(data: String = "{sku}", rotation: Int = 0, symbology: String? = null, height: Int? = null, moduleWidth: Int? = null, showText: Boolean? = null) =
            one(LabelLayoutField(id = "b", type = LabelFieldType.barcode, x = 8, y = 9, rotation = rotation, data = data, symbology = symbology, height = height, moduleWidth = moduleWidth, showText = showText))
        assertEquals(label("""^FO8,9^BY2^BCN,40,N,N,N^FH_^FDTST-000001^FS"""), bc())
        assertEquals(label("""^FO8,9^BY3^BCR,60,Y,N,N^FH_^FDTST-000001^FS"""), bc(rotation = 90, height = 60, moduleWidth = 3, showText = true))
        assertEquals(label("""^FO8,9^BY2^B3N,N,40,N,N^FH_^FDTST-000001^FS"""), bc(symbology = "code39"))
        assertEquals(label("""^FO8,9^BY2^BEN,40,Y,N^FH_^FD5901234123457^FS"""), bc(data = "5901234123457", symbology = "ean13", showText = true))
        assertEquals(label("""^FO8,9^BY2^BUN,40,N,N,Y^FH_^FD036000291452^FS"""), bc(data = "036000291452", symbology = "upca"))
        assertEquals(label("""^FO8,9^BXN,4,200^FH_^FDTST-000001^FS"""), bc(symbology = "datamatrix", moduleWidth = 4))
        assertEquals(label("""^FO8,9^BY10^B7N,80^FH_^FDTST-000001^FS"""), bc(symbology = "pdf417", height = 80, moduleWidth = 12))
    }

    // MARK: Shapes and pictures

    @Test
    fun testDrawsLinesBoxesAndEllipses() {
        fun s(type: LabelFieldType = LabelFieldType.box, width: Int = 100, height: Int = 30, thickness: Int? = null, rounding: Int? = null, fill: Boolean? = null) =
            one(LabelLayoutField(id = "s", type = type, x = 4, y = 5, width = width, height = height, thickness = thickness, rounding = rounding, fill = fill))
        assertEquals(label("^FO4,5^GB100,3,3,B,0^FS"), s(LabelFieldType.line, height = 3))
        assertEquals(label("^FO4,5^GB2,80,2,B,0^FS"), s(LabelFieldType.line, width = 2, height = 80, rounding = 5))
        assertEquals(label("^FO4,5^GB100,30,2,B,0^FS"), s())
        assertEquals(label("^FO4,5^GB100,30,6,B,4^FS"), s(thickness = 6, rounding = 4))
        assertEquals(label("^FO4,5^GB100,30,30,B,8^FS"), s(rounding = 99, fill = true))
        assertEquals(label("^FO4,5^GE100,30,2,B^FS"), s(LabelFieldType.ellipse))
        assertEquals(label("^FO4,5^GE100,30,30,B^FS"), s(LabelFieldType.ellipse, fill = true))
    }

    @Test
    fun testPrintsAPictureAsGFAHexTurnedFor180AndStillFor90() {
        // 10 x 2 dots: 2 bytes a row. Row 1: 1010101010, row 2: 1100000011.
        fun img(rotation: Int = 0, bitmap: String? = "qoDAwA==") =
            one(LabelLayoutField(id = "i", type = LabelFieldType.image, x = 3, y = 4, rotation = rotation, width = 10, height = 2, bitmap = bitmap))
        assertEquals(label("^FO3,4^GFA,4,4,2,AA80C0C0^FS"), img())
        // Half a turn: row 2 first, each row reversed over its 10 dots.
        assertEquals(label("^FO3,4^GFA,4,4,2,C0C05540^FS"), img(rotation = 180))
        assertEquals(label("^FO3,4^GFA,4,4,2,AA80C0C0^FS"), img(rotation = 90))
        assertEquals(head + foot, img(bitmap = "!!"))
        assertEquals(head + foot, img(bitmap = null))
        // Too short a bitmap is padded with white.
        assertEquals(label("^FO3,4^GFA,4,4,2,AA000000^FS"), img(bitmap = "qg=="))
    }

    // MARK: The printer and the job

    @Test
    fun testSendsThePrinterOptionsOnceALabelInAFixedOrder() {
        val all = LabelPrinterSettings(
            thermal = "direct", mode = "peel", media = "mark", darkness = 7, speed = 4, labelTop = 30, labelShift = -12, tearOff = -5,
            orientation = "inverted", mirror = true, homeX = 8, homeY = 16,
        )
        assertEquals(
            "^XA^CI28^PW400^LL200^LH8,16^LT30^LS-12^MTD^MMP^MNM^PR4~SD07~TA-005^POI^PMY\n^PQ1,0,1,Y^XZ\n",
            Zpl.render(layout(emptyList(), printer = all), listOf(p1), now = now),
        )
        val second = LabelPrinterSettings(thermal = "transfer", mode = "delayed-cut", media = "gap", tearOff = 12, orientation = "normal", mirror = false)
        assertEquals("^XA^CI28^PW400^LL200^LS0^MTT^MMD^MNY~TA+012^PON^PMN\n^PQ1,0,1,Y^XZ\n", Zpl.render(layout(emptyList(), printer = second), listOf(p1)))
        val third = LabelPrinterSettings(mode = "cutter", media = "continuous", darkness = 99, speed = 99, labelTop = -500, tearOff = 0)
        assertEquals("^XA^CI28^PW400^LL200^LT-120^LS0^MMC^MNN^PR14~SD30~TA+000\n^PQ1,0,1,Y^XZ\n", Zpl.render(layout(emptyList(), printer = third), listOf(p1)))
    }

    @Test
    fun testStillReadsTheDarknessAndSpeedOlderLayoutsKeptAtTheTop() {
        val a = LabelLayout.from(Json.parse("""{"id":"t","name":"T","widthDots":400,"heightDots":200,"fields":[],"darkness":12,"speed":3}"""))!!
        assertEquals("^XA^CI28^PW400^LL200^LS0^PR3~SD12\n^PQ1,0,1,Y^XZ\n", Zpl.render(a, listOf(p1)))
        val b = LabelLayout.from(Json.parse("""{"id":"t","name":"T","widthDots":400,"heightDots":200,"fields":[],"darkness":12,"speed":3,"printer":{"darkness":20}}"""))!!
        assertEquals("^XA^CI28^PW400^LL200^LS0^PR3~SD20\n^PQ1,0,1,Y^XZ\n", Zpl.render(b, listOf(p1)))
    }

    @Test
    fun testMakesOneLabelToTheTagsALayoutHoldsWithCopiesSkipAndACounter() {
        val l = layout(listOf(text("{SKU_1} {SKU_2} #{counter:7:1:3}", x = 1, y = 2)), tags = 2)
        val z = Zpl.render(l, listOf(p1, p2, p1), copies = 3, skip = 1, now = now)
        assertEquals(
            "$head^PQ1,0,1,Y^XZ\n" +
                head + """^FO1,2^A0N,20,20^FH_^FDTST-000001 TST-000002 #007^FS""" + "\n^PQ3,0,1,Y^XZ\n" +
                head + """^FO1,2^A0N,20,20^FH_^FDTST-000001  #008^FS""" + "\n^PQ3,0,1,Y^XZ\n",
            z,
        )
        assertTrue(Zpl.render(l, listOf(p1, p2, p1), counterStart = 90, now = now).contains("#090^FS"))
        assertEquals("", Zpl.render(l, emptyList(), skip = 0))
        assertTrue(Zpl.render(l, listOf(p1), copies = 0).contains("^PQ1,0,1,Y"))
    }

    @Test
    fun testCountsLabels() {
        assertEquals(3, Zpl.labelCount(listOf(p1, p2, p1), layout(emptyList())))
        assertEquals(2, Zpl.labelCount(listOf(p1, p2, p1), layout(emptyList(), tags = 2)))
        assertEquals(2, Zpl.labelCount(4, layout(emptyList(), tags = 2)))
        assertEquals(0, Zpl.labelCount(emptyList(), layout(emptyList(), tags = 2)))
    }

    @Test
    fun testSkipsHiddenFieldsOnPrintButKeepsThemForTheDesigner() {
        val hidden = text("B").copy(id = "b", hidden = true, locked = true, name = "Hidden")
        val l = layout(listOf(text("A"), hidden))
        assertEquals(label("""^FO10,20^A0N,20,20^FH_^FDA^FS"""), Zpl.render(l, listOf(p1)))
        assertEquals(listOf("a false", "b true"), Zpl.resolveFields(l, listOf(p1)).map { "${it.id} ${it.hidden}" })
    }

    // MARK: resolveFields

    @Test
    fun testResolveFieldsWorksTheDataOutForOneLabelOfAJob() {
        val l = layout(
            listOf(
                text("{SKU_2} {counter::10:2}"), LabelLayoutField(id = "q", type = LabelFieldType.qr, x = 0, y = 0, data = "{SKU_1}"),
                LabelLayoutField(id = "b", type = LabelFieldType.barcode, x = 0, y = 0, data = "{date}"),
                LabelLayoutField(id = "x", type = LabelFieldType.box, x = 0, y = 0, width = 5, height = 5),
            ),
            tags = 2,
        )
        val r = Zpl.resolveFields(l, listOf(p1, p2), labelIndex = 3, now = now)
        assertEquals(listOf("TST-000002 31", "TST-000001", "25 Oct 2026", null), r.map { it.data })
        assertEquals("{SKU_2} {counter::10:2}", l.fields[0].data)
    }

    /** zebra-zpl.test.ts "escapeZpl (^FH_)". */
    @Test
    fun testEscapesUnderscoreCaretTildeBackslashAndKeepsTheBlockNewLine() {
        assertEquals("a_5Fb_5Ec_5Cd_7Ee\\&f", Zpl.escape("a_b^c\\d~e\nf", "\\&"))
        assertEquals("x_0Ay", Zpl.escape("x\ny", "_0A"))
    }
}
