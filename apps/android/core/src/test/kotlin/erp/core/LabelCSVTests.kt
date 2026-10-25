package erp.core

import erp.core.logic.LabelCSV
import erp.core.models.Product
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/label-csv.test.ts. The TypeScript test holds `productCsv` to the browser's download (csv.ts) byte for byte; csv.ts
 * is a browser download with no Kotlin twin, so the files below were printed by the TypeScript `productCsv` (vitest) for the
 * same made-up pieces and rates, and are compared exactly. All names, rates and amounts are invented. (LabelCSVTests.swift.)
 */
class LabelCSVTests {
    private val settings: Settings = ERPDecode.model<Settings>(
        mapOf(
            "shopName" to "Demo, Jewellers", "goldRatePerGram24k" to 30000, "goldRatePerGram22k" to 27500, "goldRatePerGram21k" to 26250,
            "goldRatePerGram18k" to 22500, "palladiumRatePerGram" to 12000, "platinumRatePerGram" to 15000, "silverRatePerGram" to 300,
        ),
    )!!

    private fun piece(fields: Map<String, Any?>): Product = ERPDecode.model<Product>(fields)!!

    private val ring by lazy {
        piece(
            mapOf(
                "sku" to "RIN-000101", "name" to "Demo \"Rose\" ring", "categoryId" to "cat001", "imageUrl" to "https://example.com/r.jpg", "metalType" to "gold", "karat" to "21k",
                "metalWeightG" to 4.25, "hasStones" to true, "stoneWeightG" to 0.4, "stoneDetails" to "Two small, pink", "hasDiamonds" to false, "diamondCharges" to 0,
                "makingCharges" to 6000, "stoneCharges" to 1500, "miscCharges" to 0, "wastagePercentage" to 10, "isCustomPrice" to false,
            ),
        )
    }
    private val pendant by lazy {
        piece(
            mapOf(
                "sku" to "LCK-000007", "name" to "Demo pendant", "categoryId" to "cat004", "metalType" to "gold", "karat" to "22k", "metalWeightG" to 2,
                "secondaryMetalType" to "platinum", "secondaryMetalWeightG" to 0.5, "hasStones" to false, "stoneWeightG" to 0, "hasDiamonds" to true, "diamondDetails" to "VS",
                "diamondCharges" to 20000, "makingCharges" to 3000, "stoneCharges" to 0, "miscCharges" to 250, "wastagePercentage" to 8, "isCustomPrice" to true, "customPrice" to 99000,
            ),
        )
    }
    private val silver by lazy {
        piece(
            mapOf(
                "sku" to "SLV-000003", "name" to "Silver band", "categoryId" to "cat009", "metalType" to "silver", "metalWeightG" to 6.125, "hasStones" to false, "stoneWeightG" to 0,
                "makingCharges" to 0, "diamondCharges" to 0, "stoneCharges" to 0, "miscCharges" to 0, "wastagePercentage" to 0, "isCustomPrice" to false, "platingType" to "Rhodium", "size" to "7",
            ),
        )
    }

    // One tag's cells as the TypeScript wrote them (the 25 columns), and a right tag with no piece.
    private val header = """sku_1,product_name_1,category_id_1,shop_name_1,image_url_1,total_price_pkr_1,is_custom_price_1,custom_price_1,metal_type_1,metal_weight_g_1,karat_1,secondary_metal_type_1,secondary_metal_weight_g_1,secondary_karat_1,has_stones_1,stone_weight_g_1,has_diamonds_1,stone_details_1,diamond_details_1,making_charges_1,diamond_charges_1,stone_charges_1,misc_charges_1,wastage_percentage_1,qr_content_1,sku_2,product_name_2,category_id_2,shop_name_2,image_url_2,total_price_pkr_2,is_custom_price_2,custom_price_2,metal_type_2,metal_weight_g_2,karat_2,secondary_metal_type_2,secondary_metal_weight_g_2,secondary_karat_2,has_stones_2,stone_weight_g_2,has_diamonds_2,stone_details_2,diamond_details_2,making_charges_2,diamond_charges_2,stone_charges_2,misc_charges_2,wastage_percentage_2,qr_content_2"""
    private val ringTag = """RIN-000101,"Demo ""Rose"" ring",cat001,"Demo, Jewellers",https://example.com/r.jpg,118669,FALSE,0,gold,4.250,21k,,0,,TRUE,0.400,FALSE,"Two small, pink",,6000,0,1500,0,10.00,RIN-000101"""
    private val pendantTag = """LCK-000007,Demo pendant,cat004,"Demo, Jewellers",,99000,TRUE,99000,gold,2.000,22k,platinum,0.500,,FALSE,0.000,TRUE,,VS,3000,20000,0,250,8.00,LCK-000007"""
    private val silverTag = """SLV-000003,Silver band,cat009,"Demo, Jewellers",,1838,FALSE,0,silver,6.125,,,0,,FALSE,0.000,FALSE,,,0,0,0,0,0.00,SLV-000003"""
    private val emptyTag = ",".repeat(24)

    // MARK: productCsv

    @Test
    fun testProductCsvIsTheTypeScriptFileForThesePieces() {
        assertEquals(listOf(header, "$ringTag,$emptyTag").joinToString("\n"), LabelCSV.productCsv(listOf(ring), settings))
        assertEquals(listOf(header, "$ringTag,$pendantTag").joinToString("\n"), LabelCSV.productCsv(listOf(ring, pendant), settings))
        assertEquals(
            listOf(header, "$pendantTag,$ringTag", "$silverTag,$emptyTag").joinToString("\n"),
            LabelCSV.productCsv(listOf(pendant, ring, silver), settings),
        )
    }

    @Test
    fun testPutsTwoTagsToARowTheRightOneEmptyForAnOddLastPiece() {
        val lines = LabelCSV.productCsv(listOf(ring), settings).split("\n")
        assertEquals(2, lines.size)
        assertEquals(50, lines[0].split(",").filter { it.isNotEmpty() }.size)
        assertTrue(lines[0].startsWith("sku_1,product_name_1,"))
        assertTrue(lines[1].contains("\"Demo \"\"Rose\"\" ring\""))
        assertTrue(lines[1].contains("\"Demo, Jewellers\""))
        assertTrue(lines[1].endsWith(",RIN-000101" + ",".repeat(25)))
    }

    @Test
    fun testNoPiecesIsTheHeaderAlone() {
        assertEquals(header, LabelCSV.productCsv(emptyList(), settings))
    }

    @Test
    fun testNamesTheFileAsTheBrowserDoes() {
        assertEquals("gemstrack_double_tag_export_2026-10-09-08-30-05.csv", LabelCSV.fileName(ERPDate.parse("2026-10-09T08:30:05.000Z")!!))
        val now = LabelCSV.fileName()
        assertTrue(Regex("""^gemstrack_double_tag_export_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$""").matches(now))
    }

    // MARK: labelCsvValues

    @Test
    fun testOneTagsValuesAreWhatTheCsvWrites() {
        val v = LabelCSV.values(ring, settings)
        assertEquals(LabelCSV.baseHeaders.size, v.size)
        assertEquals("118669", v["total_price_pkr"])
        assertEquals("FALSE", v["is_custom_price"])
        assertEquals("0", v["custom_price"])
        assertEquals("TRUE", v["has_stones"])
        assertEquals("4.250", v["metal_weight_g"])
        assertEquals("0.400", v["stone_weight_g"])
        assertEquals("0", v["secondary_metal_weight_g"])
        assertEquals("10.00", v["wastage_percentage"])
        assertEquals("Demo \"Rose\" ring", v["product_name"])
        val p = LabelCSV.values(pendant, settings)
        assertEquals("99000", p["total_price_pkr"])
        assertEquals("TRUE", p["is_custom_price"])
        assertEquals("99000", p["custom_price"])
        assertEquals("platinum", p["secondary_metal_type"])
        assertEquals("0.500", p["secondary_metal_weight_g"])
        assertEquals("TRUE", p["has_diamonds"])
        assertEquals("250", p["misc_charges"])
        val s = LabelCSV.values(silver, settings)
        assertEquals("1838", s["total_price_pkr"])
        assertEquals("", s["karat"])
        assertEquals("0.000", s["stone_weight_g"])
    }

    @Test
    fun testNoPieceIsEveryColumnEmpty() {
        val v = LabelCSV.values(null, settings)
        assertEquals(LabelCSV.baseHeaders.toSet(), v.keys)
        assertTrue(v.values.all { it.isEmpty() })
    }

    // MARK: pieceForCsv

    @Test
    fun testTakesTheSKUFromTheDocumentIdAndReadsFiguresKeptAsText() {
        val p = LabelCSV.pieceForCsv("RIN-000102", mapOf("name" to "Old import", "categoryId" to "cat001", "metalType" to "gold", "metalWeightG" to "3.5", "makingCharges" to "1,000"))
        assertEquals("RIN-000102", p.sku)
        assertEquals(3.5, p.metalWeightG)
        // Not a number at all: 0, so the file is still made.
        assertEquals(0.0, p.makingCharges)
        assertNull(p.customPrice)
        assertEquals(2, LabelCSV.productCsv(listOf(p), settings).split("\n").size)
    }

    @Test
    fun testKeepsTheDocumentsOwnSKUAndOptionalFigures() {
        val p = LabelCSV.pieceForCsv("ID-1", mapOf("sku" to "RIN-7", "metalWeightG" to 2, "customPrice" to "", "secondaryMetalWeightG" to "0.5"))
        assertEquals("RIN-7", p.sku)
        assertNull(p.customPrice)
        assertEquals(0.5, p.secondaryMetalWeightG)
        assertEquals(5000.4, LabelCSV.pieceForCsv("ID-2", mapOf("customPrice" to 5000.4)).customPrice)
    }
}
