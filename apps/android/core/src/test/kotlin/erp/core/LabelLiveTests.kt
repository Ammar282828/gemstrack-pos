package erp.core

import erp.core.logic.LabelField
import erp.core.logic.LabelLive
import erp.core.logic.LabelLiveConfig
import erp.core.logic.LabelLiveIntegrate
import erp.core.logic.LabelLiveMap
import erp.core.logic.LabelLiveVar
import erp.core.logic.LabelValues
import erp.core.logic.labelLiveConfig
import erp.core.models.Product
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/label-live.test.ts, case for case (same inputs, same expected outputs), then the cases the TypeScript does not test
 * but the link depends on: the exact link strings below were printed by the TypeScript (`printUrl`, `batchUrl`,
 * `parseIntegrateUrl`) for the same made-up config and pieces, so the percent-encoding and the JSON escaping are held to what
 * `encodeURIComponent` and `JSON.stringify` give. All names, SKUs and prices are invented. (LabelLiveTests.swift.)
 */
class LabelLiveTests {
    // The shape Label LIVE's guide shows for its Integrate link.
    private val sample = "labellive://print?design=sample-address-label&variables=NAME:'Jane Doe',ADDRESS:'1 Main St',CITY:Springfield&printer=Preview&window=show&copies=2"

    @Suppress("UNCHECKED_CAST")
    private fun obj(s: String): Map<String, String> = Json.parse(s) as Map<String, String>

    @Suppress("UNCHECKED_CAST")
    private fun objects(s: String): List<Map<String, String>> = Json.parse(s) as List<Map<String, String>>

    private fun payloadJobs(url: String): List<Map<String, String>> {
        val payload = LabelLive.decodeURIComponent(url.split("payload=")[1])!!
        return objects(String(java.util.Base64.getDecoder().decode(payload), Charsets.UTF_8))
    }

    private fun variablesParam(url: String): String {
        val after = url.split("variables=")[1]
        return LabelLive.decodeURIComponent(after.takeWhile { it != '&' })!!
    }

    // MARK: Reading the Integrate link

    @Test
    fun testTakesTheDesignPrinterCopiesAndEveryVariableName() {
        assertEquals(LabelLiveIntegrate("sample-address-label", "Preview", 2, listOf("NAME", "ADDRESS", "CITY")), LabelLive.parseIntegrateURL(sample))
    }

    @Test
    fun testReadsAPercentEncodedBrowserLinkAndQuotesWithCommasInThem() {
        val url = "labellive://print?design=minalabel&variables=" + LabelLive.encodeURIComponent("SKU:'A,1',Price:'Rs 1',{W}:x")
        assertEquals(listOf("SKU", "Price", "W"), LabelLive.parseIntegrateURL(url)?.variables)
        val pairs = LabelLive.rjsonPairs("""A:'it\'s',B:'x\&y'""")
        assertEquals(listOf("A", "B"), pairs.map { it.first })
        assertEquals(listOf("it's", "x&y"), pairs.map { it.second })
    }

    @Test
    fun testRefusesAnythingThatIsNotAPrintLink() {
        assertNull(LabelLive.parseIntegrateURL("https://label.live"))
        assertNull(LabelLive.parseIntegrateURL("labellive://print?copies=1"))
    }

    // Not in the TypeScript test; the TypeScript's answers for these links.
    @Test
    fun testReadsTheLinkAsTheTypeScriptDoes() {
        // Upper-case scheme, "+" as a space, an escaped "&", a {...} wrapper, copies 2.5 rounds up, "%2B" is a plus.
        assertEquals(
            LabelLiveIntegrate("my label x", "P+1", 3, listOf("A_1", "B")),
            LabelLive.parseIntegrateURL("""labellive://PRINT?design=my+label%20x&variables={A_1:'q\&r',B:"x,y"}&copies=2.5&printer=P%2B1"""),
        )
        // A broken escape leaves the value as written; copies that are not a number are 1.
        assertEquals(
            LabelLiveIntegrate("%E0%A4%A", "", 1, listOf("A")),
            LabelLive.parseIntegrateURL("labellive://print?design=%E0%A4%A&copies=abc&variables=A:1"),
        )
        assertEquals(
            LabelLiveIntegrate("d", "", 1, listOf("A", "B")),
            LabelLive.parseIntegrateURL("""labellive://print?design=d&variables=A:'x\&y=1',B:2&copies=0"""),
        )
        assertEquals(99, LabelLive.parseIntegrateURL("labellive://print?design=d&copies=500")?.copies)
        assertNull(LabelLive.parseIntegrateURL("labellive://print?design=a\nb"))
        assertNull(LabelLive.parseIntegrateURL(""))
    }

    // MARK: Pairing variables with fields

    @Test
    fun testGuessesByName() {
        val names = listOf("SKU", "Item Code", "QR", "Price", "PRICE_NUM", "Weight", "WT", "Karat", "Metal", "Name", "Shop", "StoneWt", "Diamonds", "Date", "xyz")
        assertEquals(
            listOf("sku", "sku", "qr", "price", "priceNumber", "weight", "weight", "karat", "metal", "name", "shop", "stoneWeight", "diamonds", "date", ""),
            names.map { LabelLive.guessField(it) },
        )
    }

    @Test
    fun testKeepsTheOwnersEarlierChoicesWhenTheLinkIsPastedAgain() {
        val prev = LabelLiveConfig("old", "", 1, LabelLiveMap.of("NAME" to "sku"), hideWindow = false)
        val c = LabelLive.configFromIntegrate(LabelLive.parseIntegrateURL(sample)!!, prev)
        assertEquals(LabelLiveMap.of("NAME" to "sku", "ADDRESS" to "", "CITY" to ""), c.map)
        assertFalse(c.hideWindow)
    }

    // MARK: The print link

    private val config = LabelLiveConfig("minalabel", "zebra_1", 1, LabelLiveMap.of("SKU" to "sku", "NAME" to "name", "PRICE" to "price", "NOTE" to ""), hideWindow = true)
    private val piece: LabelValues = mapOf("sku" to "HM-102", "name" to "Ayla's Ring & Band", "price" to "Rs 12,500")

    @Test
    fun testFillsEachPairedVariableAsTheJSONLabelLIVECarriesWithNoAmpersandToBreakTheLink() {
        assertEquals("""{"SKU":"HM-102","NAME":"Ayla's Ring and Band","PRICE":"Rs 12,500"}""", LabelLive.variablesFor(config, piece))
        val multiline = piece + ("name" to "a\nb")
        assertTrue(LabelLive.variablesFor(config, multiline).contains(""""NAME":"a b""""))
        val url = LabelLive.printURL(config, piece)
        assertTrue(url.startsWith("labellive://print?design=minalabel&variables="))
        assertTrue(url.contains("&printer=zebra_1&copies=1&window=hide&ignoreWarnings=true"))
        // Read back the way Label LIVE does: the variables survive the round trip.
        assertEquals(listOf("SKU", "NAME", "PRICE"), LabelLive.parseIntegrateURL(url)?.variables)
    }

    @Test
    fun testPutsSeveralPiecesInOneBatch() {
        val url = LabelLive.batchURL(config, listOf(piece, mapOf("sku" to "HM-103", "name" to "Bangle", "price" to "Rs 9,000")), copies = 2)
        val jobs = payloadJobs(url)
        assertEquals(2, jobs.size)
        assertEquals("minalabel", jobs[1]["design"])
        assertEquals("zebra_1", jobs[1]["printer"])
        assertEquals("2", jobs[1]["copies"])
        assertEquals(mapOf("SKU" to "HM-103", "NAME" to "Bangle", "PRICE" to "Rs 9,000"), obj(jobs[1]["variables"]!!))
    }

    @Test
    fun testChecksASavedConfig() {
        assertEquals(
            LabelLiveConfig("minalabel", "", 99, LabelLiveMap.of("SKU" to "sku", "X" to ""), hideWindow = true),
            LabelLive.clean(mapOf("design" to " minalabel ", "copies" to 500, "map" to mapOf("SKU" to "sku", "X" to "nonsense"))),
        )
        assertNull(LabelLive.clean(mapOf("design" to "")))
        assertNull(LabelLive.clean(null as Any?))
        assertNull(LabelLive.clean("minalabel"))
    }

    @Test
    fun testCheckingKeepsWhatIsRightAndDropsWhatIsOdd() {
        val long = "n".repeat(61)
        val c = LabelLive.clean(
            mapOf(
                "design" to "d", "printer" to " P ", "copies" to "3", "hideWindow" to false,
                "vars" to listOf(mapOf("name" to "A", "field" to "csv:sku"), mapOf("name" to "", "field" to "sku"), mapOf("name" to long, "field" to "sku"), mapOf("name" to "B", "field" to 7), "junk"),
            ),
        )
        assertEquals(LabelLiveConfig("d", "P", 3, LabelLiveMap.of("A" to "csv:sku", "B" to ""), hideWindow = false), c)
        // Only a real false shows the window.
        assertEquals(true, LabelLive.clean(mapOf("design" to "d", "hideWindow" to "false"))?.hideWindow)
    }

    // MARK: As the settings keep it

    @Test
    fun testStoresThePairingsAsAListAndReadsThemBack() {
        val c = LabelLiveConfig("minalabel", "", 1, LabelLiveMap.of("SKU" to "sku", "NOTE" to ""), hideWindow = true)
        val stored = LabelLive.toStored(c)
        assertEquals(listOf(LabelLiveVar("SKU", "sku"), LabelLiveVar("NOTE", "")), stored.vars)
        assertEquals(c, LabelLive.clean(stored))
    }

    @Test
    fun testSettingsDecodeLabelLiveLeniently() {
        val doc = mapOf(
            "shopName" to "Demo",
            "labelLive" to mapOf(
                "design" to " minalabel ", "printer" to "zebra_1", "copies" to "2",
                "vars" to mapOf("0" to mapOf("name" to "SKU_1", "field" to "sku"), "1" to mapOf("name" to "SKU_2", "field" to "sku")),
            ),
        )
        val settings = assertNotNull(ERPDecode.model<Settings>(doc))
        assertEquals(LabelLiveConfig("minalabel", "zebra_1", 2, LabelLiveMap.of("SKU_1" to "sku", "SKU_2" to "sku"), hideWindow = true), settings.labelLiveConfig)
        // None saved, or an odd value: no config, never an error.
        assertNull(ERPDecode.model<Settings>(mapOf("shopName" to "Demo"))?.labelLiveConfig)
        assertNull(ERPDecode.model<Settings>(mapOf("labelLive" to "oops"))?.labelLiveConfig)
        assertEquals(false, ERPDecode.model<Settings>(mapOf("labelLive" to mapOf("design" to "d", "hideWindow" to false)))?.labelLiveConfig?.hideWindow)
    }

    // MARK: A design with two tags to a label (minalabel)

    // The shape of the owner's Integrate link, 2026-10-23: the double-tag CSV's columns, each _1 and _2, as JSON.
    private val twoTagLink = "labellive://print?design=minalabel&variables=" + LabelLive.encodeURIComponent(
        LabelLive.jsonObject(
            listOf(
                "SKU_1" to "TOP-000001", "SKU_2" to "TOP-000002", "TOTAL_PRICE_PKR_1" to "20650.00", "TOTAL_PRICE_PKR_2" to "32900.00",
                "METAL_WEIGHT_G_1" to "5.900", "METAL_WEIGHT_G_2" to "9.400", "QR_CONTENT_1" to "TOP-000001", "QR_CONTENT_2" to "TOP-000002",
            ),
        ),
    ) + "&printer=System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL&window=show&copies=1"
    private val twoTag: LabelLiveConfig get() = LabelLive.configFromIntegrate(LabelLive.parseIntegrateURL(twoTagLink)!!)
    private val a: LabelValues = mapOf("csv:sku" to "RIN-000069", "csv:total_price_pkr" to "4628", "csv:metal_weight_g" to "1.780", "csv:qr_content" to "RIN-000069")
    private val b: LabelValues = mapOf("csv:sku" to "RIN-000070", "csv:total_price_pkr" to "8398", "csv:metal_weight_g" to "3.230", "csv:qr_content" to "RIN-000070")

    @Test
    fun testReadsTheJSONLinkAndPairsEachVariableWithItsCSVColumn() {
        val c = twoTag
        assertEquals("System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL", c.printer)
        assertEquals("csv:sku", c.map["SKU_1"])
        assertEquals("csv:sku", c.map["SKU_2"])
        assertEquals("csv:total_price_pkr", c.map["TOTAL_PRICE_PKR_2"])
        assertEquals("csv:qr_content", c.map["QR_CONTENT_1"])
        assertEquals(2, LabelLive.tagsOf(c).count)
    }

    @Test
    fun testFillsTheLeftTagFromOnePieceAndTheRightFromTheNext() {
        val v = obj(LabelLive.variablesFor(twoTag, listOf(a, b)))
        assertEquals("RIN-000069", v["SKU_1"])
        assertEquals("RIN-000070", v["SKU_2"])
        assertEquals("8398", v["TOTAL_PRICE_PKR_2"])
        assertEquals("1.780", v["METAL_WEIGHT_G_1"])
    }

    @Test
    fun testPrintsALonePieceWithTheRightTagBlankNeverTheSample() {
        val v = obj(LabelLive.variablesFor(twoTag, listOf(a)))
        assertEquals("RIN-000069", v["SKU_1"])
        assertEquals(listOf("", "", ""), listOf(v["SKU_2"], v["TOTAL_PRICE_PKR_2"], v["QR_CONTENT_2"]))
    }

    @Test
    fun testMakesOneLabelOfTwoPiecesAndABatchOfTwoLabelsOfThree() {
        assertEquals(listOf(2, 1), LabelLive.labelsOf(twoTag, listOf(a, b, a)).map { it.size })
        val jobs = payloadJobs(LabelLive.batchURL(twoTag, listOf(a, b, a)))
        assertEquals(2, jobs.size)
        assertEquals("", obj(jobs[1]["variables"]!!)["SKU_2"])
    }

    @Test
    fun testKeepsOneTagDesignsAsTheyWere() {
        assertEquals(1, LabelLive.tagsOf(LabelLiveConfig("x", "", 1, LabelLiveMap.of("SKU" to "sku", "SIZE_2" to "size"), true)).count)
        // Three tags, and no more than twelve.
        assertEquals(3, LabelLive.tagsOf(LabelLiveConfig("x", map = LabelLiveMap.of("A_1" to "", "A_3" to ""))).count)
        assertEquals(5, LabelLive.tagsOf(LabelLiveConfig("x", map = LabelLiveMap.of("A_1" to "", "A_5" to ""))).count)
        assertEquals(12, LabelLive.tagsOf(LabelLiveConfig("x", map = LabelLiveMap.of("A_1" to "", "A_99" to ""))).count)
        assertEquals(0, LabelLive.tagsOf(LabelLiveConfig("x", map = LabelLiveMap.of("A_1" to "", "A_2" to ""))).tagOf("PLAIN"))
    }

    // MARK: Many labels in one print link

    private val manyConfig = LabelLiveConfig("minalabel", "", 1, LabelLiveMap.of("SKU_1" to "sku", "SKU_2" to "sku"), true)

    @Test
    fun testSendsAListOfLabelsAsTheVariablesNeverTheBatchLinkLabelLIVEMisreads() {
        val url = LabelLive.labelLiveURL(manyConfig, listOf(mapOf("sku" to "A"), mapOf("sku" to "B"), mapOf("sku" to "C")))
        assertTrue(url.startsWith("labellive://print?design=minalabel&variables="))
        assertEquals(listOf(mapOf("SKU_1" to "A", "SKU_2" to "B"), mapOf("SKU_1" to "C", "SKU_2" to "")), objects(variablesParam(url)))
    }

    @Test
    fun testKeepsOneLabelAsASingleObject() {
        assertEquals(mapOf("SKU_1" to "A", "SKU_2" to ""), obj(variablesParam(LabelLive.labelLiveURL(manyConfig, listOf(mapOf("sku" to "A"))))))
    }

    // MARK: The links, character for character (printed by the TypeScript)

    private val exactConfig = LabelLiveConfig(
        "mina label é", "Zebra ZD220 (USB)", 3,
        LabelLiveMap.of("SKU_1" to "sku", "NAME_1" to "name", "SKU_2" to "sku", "NAME_2" to "name", "NOTE" to ""), false,
    )
    private val exactA: LabelValues = mapOf("sku" to "A-1", "name" to "Rose \"Ring\" & Co\\x\u0001 é ₨ 💎 /\r\nz")
    private val exactB: LabelValues = mapOf("sku" to "B/2", "name" to "It's ~ fine! *(ok)*")

    @Test
    fun testOnePieceIsTheTypeScriptsLink() {
        assertEquals(
            """labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true""",
            LabelLive.printURL(exactConfig, listOf(exactA)),
        )
    }

    @Test
    fun testTwoPiecesFillBothTags() {
        assertEquals(
            """labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22B%2F2%22%2C%22NAME_2%22%3A%22It's%20~%20fine!%20*(ok)*%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true""",
            LabelLive.printURL(exactConfig, listOf(exactA, exactB)),
        )
    }

    @Test
    fun testThreePiecesAreAListAndCopiesAreCappedAt99() {
        assertEquals(
            """labellive://print?design=mina%20label%20%C3%A9&variables=%5B%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22B%2F2%22%2C%22NAME_2%22%3A%22It's%20~%20fine!%20*(ok)*%22%7D%2C%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%7D%5D&printer=Zebra%20ZD220%20(USB)&copies=99&window=show&ignoreWarnings=true""",
            LabelLive.printURL(exactConfig, listOf(exactA, exactB, exactA), copies = 120),
        )
    }

    @Test
    fun testNoPiecesSendsEveryTagBlank() {
        assertEquals(
            """labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22%22%2C%22NAME_1%22%3A%22%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%2C%22NOTE%22%3A%22%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true""",
            LabelLive.printURL(exactConfig, emptyList<LabelValues>()),
        )
    }

    @Test
    fun testTheBatchLinkIsTheTypeScriptsToTheLastCharacter() {
        // copies 0 is 1.
        assertEquals(
            """labellive://batch?payload=W3siZGVzaWduIjoibWluYSBsYWJlbCDDqSIsInZhcmlhYmxlcyI6IntcIlNLVV8xXCI6XCJBLTFcIixcIk5BTUVfMVwiOlwiUm9zZSBcXFwiUmluZ1xcXCIgYW5kIENvXFxcXHhcXHUwMDAxIMOpIOKCqCDwn5KO4oCoLyB6XCIsXCJTS1VfMlwiOlwiQi8yXCIsXCJOQU1FXzJcIjpcIkl0J3MgfiBmaW5lISAqKG9rKSpcIn0iLCJwcmludGVyIjoiWmVicmEgWkQyMjAgKFVTQikiLCJjb3BpZXMiOiIxIiwid2luZG93Ijoic2hvdyIsImlnbm9yZVdhcm5pbmdzIjoidHJ1ZSJ9LHsiZGVzaWduIjoibWluYSBsYWJlbCDDqSIsInZhcmlhYmxlcyI6IntcIlNLVV8xXCI6XCJBLTFcIixcIk5BTUVfMVwiOlwiUm9zZSBcXFwiUmluZ1xcXCIgYW5kIENvXFxcXHhcXHUwMDAxIMOpIOKCqCDwn5KO4oCoLyB6XCIsXCJTS1VfMlwiOlwiXCIsXCJOQU1FXzJcIjpcIlwifSIsInByaW50ZXIiOiJaZWJyYSBaRDIyMCAoVVNCKSIsImNvcGllcyI6IjEiLCJ3aW5kb3ciOiJzaG93IiwiaWdub3JlV2FybmluZ3MiOiJ0cnVlIn1d""",
            LabelLive.batchURL(exactConfig, listOf(exactA, exactB, exactA), copies = 0),
        )
    }

    @Test
    fun testEncodeAndDecodeURIComponentAsJavaScriptDoes() {
        assertEquals("a%20b%26c%3Dd%2Fe%3Ff%23g%2Bh%20%C3%A9%F0%9F%92%8E'()*!~-_.", LabelLive.encodeURIComponent("a b&c=d/e?f#g+h é💎'()*!~-_."))
        assertEquals("a b&c+dé+", LabelLive.decodeURIComponent("a%20b%26c%2Bd%C3%A9+"))
        assertNull(LabelLive.decodeURIComponent("%E0%A4%A"))
        assertNull(LabelLive.decodeURIComponent("100%"))
        assertNull(LabelLive.decodeURIComponent("%FF"))
    }

    @Test
    fun testTheJSONEscapesAreJSONStringifys() {
        assertEquals("\"a\\\"b\\\\c\\n\\r\\t\\b\\f\\u0001\\u001f/é \"", LabelLive.jsonString("a\"b\\c\n\r\t\u0008\u000C\u0001\u001F/é "))
    }

    @Test
    fun testTheFieldListHasTheLabelsAndEveryCSVColumn() {
        assertEquals(17, LabelLive.labelFields.size)
        assertEquals(LabelField("price", "Price (Rs 12,500)"), LabelLive.labelFields[2])
        assertEquals(25, LabelLive.csvFields.size)
        assertEquals(LabelField("csv:total_price_pkr", "Tag CSV: total_price_pkr"), LabelLive.csvFields[5])
        assertEquals(42, LabelLive.fieldKeys.size)
        assertEquals("csv:total_price_pkr", LabelLive.guessField("TOTAL_PRICE_PKR_1"))
        assertEquals("csv:stone_weight_g", LabelLive.guessField("STONE_WEIGHT_G_2"))
        assertEquals("price", LabelLive.guessField("Price_1"))
    }

    // MARK: A piece's values (label-live-values.ts)

    private val settings: Settings = ERPDecode.model<Settings>(
        mapOf(
            "shopName" to "Demo, Jewellers", "goldRatePerGram24k" to 30000, "goldRatePerGram22k" to 27500, "goldRatePerGram21k" to 26250,
            "goldRatePerGram18k" to 22500, "palladiumRatePerGram" to 12000, "platinumRatePerGram" to 15000, "silverRatePerGram" to 300,
        ),
    )!!

    @Test
    fun testAPiecesValuesAreWhatTheTypeScriptWorksOut() {
        // 2026-09-09 20:30 UTC is the 10th in Karachi, and en-GB writes September as "Sept".
        val day = ERPDate.parse("2026-09-09T20:30:00Z")!!
        val ring = ERPDecode.model<Product>(
            mapOf(
                "sku" to "RIN-000101", "name" to "Demo \"Rose\" ring", "categoryId" to "cat001", "imageUrl" to "https://example.com/r.jpg", "metalType" to "gold", "karat" to "21k",
                "metalWeightG" to 4.25, "hasStones" to true, "stoneWeightG" to 0.4, "stoneDetails" to "Two small, pink", "hasDiamonds" to false, "diamondCharges" to 0,
                "makingCharges" to 6000, "stoneCharges" to 1500, "miscCharges" to 0, "wastagePercentage" to 10, "isCustomPrice" to false,
            ),
        )!!
        val v = LabelLive.valuesFor(ring, settings, day)
        assertEquals("Rs 118,669", v["price"])
        assertEquals("118669", v["priceNumber"])
        assertEquals("4.250 g", v["weight"])
        assertEquals("4.250", v["weightNumber"])
        assertEquals("Gold 21k", v["metal"])
        assertEquals("21k", v["karat"])
        assertEquals("Rings", v["category"])
        assertEquals("Two small, pink", v["stones"])
        assertEquals("0.400", v["stoneWeight"])
        assertEquals("", v["diamonds"])
        assertEquals("Demo, Jewellers", v["shop"])
        assertEquals("RIN-000101", v["qr"])
        assertEquals("10 Sept 2026", v["date"])
        assertEquals("118669", v["csv:total_price_pkr"])
        assertEquals("10.00", v["csv:wastage_percentage"])
        assertEquals(17 + 25, v.size)

        val silver = ERPDecode.model<Product>(
            mapOf(
                "sku" to "SLV-000003", "name" to "Silver band", "categoryId" to "cat009", "metalType" to "silver", "metalWeightG" to 6.125, "hasStones" to false, "stoneWeightG" to 0,
                "isCustomPrice" to false, "platingType" to "Rhodium", "size" to "7",
            ),
        )!!
        val s = LabelLive.valuesFor(silver, settings, day)
        assertEquals("Rs 1,838", s["price"])
        assertEquals("Silver", s["metal"])
        assertEquals("", s["karat"])
        assertEquals("Bands", s["category"])
        assertEquals("", s["stoneWeight"])
        assertEquals("Rhodium", s["plating"])
        assertEquals("7", s["size"])

        val pendant = ERPDecode.model<Product>(
            mapOf(
                "sku" to "LCK-000007", "name" to "Demo pendant", "categoryId" to "cat004", "metalType" to "gold", "karat" to "22k", "metalWeightG" to 2, "hasDiamonds" to true,
                "diamondDetails" to "VS", "diamondCharges" to 20000, "makingCharges" to 3000, "isCustomPrice" to true, "customPrice" to 99000,
            ),
        )!!
        val p = LabelLive.valuesFor(pendant, settings, day)
        assertEquals("Rs 99,000", p["price"])
        assertEquals("Lockets", p["category"])
        assertEquals("VS", p["diamonds"])
    }
}
