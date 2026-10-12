package erp.core.entry

import erp.core.logic.ExchangeRowPatch
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The iPhone has no tests of these files of its own: the contract cases (ContractTests) are their check. These hold the
 * corners the cases do not reach (the scanners, the drafts as kept on the phone, the small formatters), with made-up
 * data and figures worked out by hand.
 */
class EntryTests {
    @Test
    fun typedTextBecomesANumberTheWayTheFormReadsIt() {
        assertEquals(1234.5, NewOrderFormat.num("1,234.5"))
        assertEquals(0.0, NewOrderFormat.num("abc"))
        assertEquals(0.0, NewOrderFormat.num("inf"))
        assertEquals(5.0, NewOrderFormat.num(" 5. "))
        assertEquals("4.2", NewOrderFormat.trimmed(4.2, 3))
        assertEquals("8", NewOrderFormat.trimmed(8.0, 3))
        assertEquals("0", NewOrderFormat.trimmed(-0.0001, 3))
        assertEquals("", NewOrderFormat.boxText(0.0))
        assertEquals("1 piece", NewOrderFormat.pieces(1))
        assertEquals("3 pieces", NewOrderFormat.pieces(3))
    }

    @Test
    fun saleFieldsKeepEveryDigitAFigureHas() {
        assertEquals("3.45678", SaleNumber.text(3.45678))
        assertEquals("1234.56789", SaleNumber.text(1234.56789))
        assertEquals("12", SaleNumber.text(12.0))
        assertEquals("", SaleNumber.text(0.0))
        assertEquals("", SaleNumber.text(null))
        assertEquals("5.2", SaleNumber.grams(5.2))
        assertEquals(1500.0, SaleNumber.value("1,500"))
        assertNull(SaleNumber.parse("  "))
    }

    @Test
    fun aNameOnPaperIsRankedByHowItSounds() {
        assertEquals("kan", PaperNames.tokenKey("khan"))
        assertEquals(listOf("fatema", "bakir"), PaperNames.phoneticKey("Fatemah Bakir"))
        assertEquals(listOf("fatima"), PaperNames.phoneticKey("Fatima"))

        val pool = listOf(PaperPerson("a", "Fatema Bakir"), PaperPerson("b", "Omar Samplani"))
        // One word of two: 0.875, a candidate and not yet a certainty.
        val partial = PaperNames.guess("Fatema", pool)!!
        assertNull(partial.pinned)
        assertEquals(listOf("a"), partial.candidates.map { it.id })
        // The whole name is a clear winner.
        val whole = PaperNames.guess("Fatema Bakir", pool)!!
        assertEquals("a", whole.pinned?.id)
        assertNull(PaperNames.guess("  ", pool))
    }

    @Test
    fun theSlipsOwnArithmeticIsChecked() {
        val s = NewOrderSlip
        assertEquals(10.0, s.wastagePercentOf(6.5, null, 0.65, null))
        assertEquals("5.2", s.jsNumber(5.2))
        assertEquals("12", s.jsNumber(12.0))
        assertEquals("245,000", s.pkNumber(245000.0))
        assertEquals("2,958.333", s.pkNumber(2958.3333))
        assertEquals("1,235", s.money(1234.5))

        val item = NewOrderScanItem(description = "Test ring", weightG = 10.0, ratePerGram = 1000.0, wastagePercent = 10.0, makingCharges = 500.0, lineTotal = 11500.0)
        assertEquals(11500.0, s.linePrice(item))
        assertTrue(s.check(NewOrderScanAnswer(items = listOf(item))).warnings.isEmpty())

        val off = NewOrderScanAnswer(items = listOf(item.copy(lineTotal = 12000.0)), advancePayment = 2000.0)
        val check = s.check(off)
        assertEquals(listOf(0), check.itemsOff)
        assertEquals(12000.0, check.subtotal)
        assertEquals(10000.0, check.balance)
        assertEquals(1, check.warnings.size)
    }

    @Test
    fun aSlipLandsInTheFormAsOrdinaryFields() {
        val answer = NewOrderScanAnswer.read(
            """{"items":[{"description":"Test ring","itemCategory":"Ring","metalType":"gold","karat":22,"weightG":"6.5",
               "wastageG":0.65,"ratePerGram":35000,"lineTotal":null},{"description":"Agreed set","lineTotal":90000}],
               "advancePayment":20000,"expectedDate":"2026-10-30"}""",
        )!!
        val d = NewOrderDraft.fresh()
        d.fillFromSlip(answer, customer = null, heardCustomer = "Test Buyer", karigarId = "k1", photos = emptyList(), fallbackMetal = "gold", settings = null)
        assertEquals(2, d.pieces.size)
        assertEquals("cat001", d.pieces[0].category)
        assertEquals("22k", d.pieces[0].karat)
        assertEquals("6.5", d.pieces[0].weight)
        assertEquals("10", d.pieces[0].wastage)
        assertEquals("35000", d.rates["goldRatePerGram22k"])
        // No weight, a figure: a fixed price at exactly that figure.
        assertTrue(d.pieces[1].manual)
        assertEquals("90000", d.pieces[1].manualPrice)
        assertEquals("20000", d.advance)
        assertEquals("2026-10-30", d.promised)
        assertEquals("Test Buyer", d.customerName)
        assertEquals("k1", d.pieces[0].karigarId)
    }

    @Test
    fun aWrittenBillIsPricedFromItsWorkingOrKeptAtItsFigure() {
        val weighed = SaleBillLine(description = "Test chain", metalType = "gold", karat = 22.0, weightG = 8.0, ratePerGram = 34000.0, wastagePercent = 5.0)
        val bare = SaleBillLine(description = "", lineTotal = 5000.0)
        val made = SaleBill.line(weighed, SaleLine.blankFor("gold", "BILL-X-1"), "gold")
        assertEquals("22k", made.karat)
        assertEquals(8.0, made.metalWeightG)
        assertEquals(5.0, made.wastagePercentage)
        assertFalse(made.isCustomPrice)
        val fixed = SaleBill.line(bare, SaleLine.blankFor("gold", "BILL-X-2"), "gold")
        assertEquals("Item", fixed.name)
        assertTrue(fixed.isCustomPrice)
        assertEquals(5000.0, fixed.customPrice)
        assertEquals(0.0, fixed.metalWeightG)

        // One rate for a karat sets its box; two rates for it set nothing.
        assertEquals(mapOf("gold22k" to 34000.0), SaleBill.rates(listOf(weighed, weighed.copy()), null, "gold"))
        assertEquals(emptyMap(), SaleBill.rates(listOf(weighed, weighed.copy(ratePerGram = 34500.0)), null, "gold"))

        val skus = SaleBill.skus(2, Instant.ofEpochMilli(36L), emptySet())
        assertEquals(listOf("BILL-10-1", "BILL-10-2"), skus)
        assertEquals(listOf("BILL-11-1", "BILL-11-2"), SaleBill.skus(2, Instant.ofEpochMilli(36L), setOf("BILL-10-2")))
    }

    @Test
    fun tagsAndRefusalsAreRead() {
        assertEquals("RNG-1001", TagCode.sku("https://example.shop/p/RNG%2D1001?x=1"))
        assertEquals("RNG-1001", TagCode.sku(" RNG-1001 "))
        val lines = listOf(SaleLine.blankFor("gold", "RNG-1001"), SaleLine.blankFor("gold", "NEW-1"))
        val refusal = SaleLookup.refusal("No longer in stock: RNG-1001, Gold ring (already sold).", lines)
        assertEquals(listOf("RNG-1001"), refusal.gone)
        assertTrue(refusal.alreadySold)
        assertEquals(SaleLookup.Refusal(emptyList(), false), SaleLookup.refusal("Something else", lines))
    }

    @Test
    fun ringSizesAreOfferedToTheProfileOnlyWhenTheyDiffer() {
        assertEquals(51, NewOrderSizes.scale("cat001")!!.parts[0].options.size)
        assertEquals("1.1", NewOrderSizes.scale("cat007")!!.parts[0].options.first())
        assertNull(NewOrderSizes.scale("cat008"))
        assertEquals(mapOf("Ring" to "10", "Bangle" to "2.4"), NewOrderSizes.parse("Ring: 10 · Bangle: 2.4", null))
        assertEquals(mapOf("Bracelet" to "2.2"), NewOrderSizes.parse("2.2", "Bracelet"))
        assertEquals("Ring: 10 · Bangle: 2.4", NewOrderSizes.compose(mapOf("Bangle" to "2.4", "Ring" to "10"), listOf("Ring", "Bangle")))
        assertTrue(NewOrderSizes.same("12", " 12.0 "))
        assertTrue(NewOrderSizes.same("7\"", "7 inches"))
        assertFalse(NewOrderSizes.same("US 6", "6"))
        assertEquals(
            listOf("ringSize=10", "bangleSize=2.4"),
            NewOrderSizes.profileSizes("cat011", "Ring: 10 · Bangle: 2.4").map { "${it.field.rawValue}=${it.value}" },
        )
        assertEquals<Map<String, Any?>>(mapOf("customerId" to "c1", "sizes" to mapOf("ringSize" to "10")), NewOrderSizes.request("c1", listOf(NewOrderSizeSuggestion(NewOrderProfileField.ringSize, "10", null, "k"))))
    }

    @Test
    fun draftsAreKeptAsTextAndComeBackTheSame() {
        EntryHouse.id = "taheri"
        val order = NewOrderDraft.fresh()
        order.customerName = "Test Buyer"
        val p = NewOrderPieceDraft()
        p.description = "Test ring"
        p.weight = "5."
        p.photo = byteArrayOf(1, 2, 3)
        order.pieces.add(p)
        order.patchExchange(order.exchanges[0].id, ExchangeRowPatch(weightG = "2"))
        val text = NewOrderDraftStore.encode(order)!!
        val back = NewOrderDraftStore.decode(text)!!
        assertEquals(order.toMap().toString().replace(Regex("\\[B@[0-9a-f]+"), ""), back.toMap().toString().replace(Regex("\\[B@[0-9a-f]+"), ""))
        assertEquals("5.", back.pieces[0].weight)
        assertEquals(listOf<Byte>(1, 2, 3), back.pieces[0].photo!!.toList())
        // Nothing typed is not kept.
        assertNull(NewOrderDraftStore.encode(NewOrderDraft.fresh()))
        // A field that is odd takes its default; the draft still opens.
        val odd = NewOrderDraft.fromMap(mapOf("customerName" to 5, "pieces" to listOf(mapOf("weight" to 3, "hasStones" to "yes")), "rates" to "x"))
        assertEquals("", odd.customerName)
        assertEquals("", odd.pieces[0].weight)
        assertTrue(odd.pieces[0].hasStones)
        assertEquals(1, odd.exchanges.size)

        val sale = SaleDraft()
        sale.customerName = "Test Buyer"
        sale.lines.add(SaleLine.blankFor("gold", "NEW-1").also { it.name = "Test"; it.metalWeightG = 3.5 })
        sale.rates["gold21k"] = "34000"
        sale.payments[0].amount = "100"
        val saleText = SaleDraftStore.encode(sale)!!
        assertEquals(sale.toMap(), SaleDraftStore.decode(saleText)!!.toMap())
        assertNull(SaleDraftStore.encode(SaleDraft()))
    }

    @Test
    fun theHouseDecidesTheNewPiecesMetal() {
        EntryHouse.id = "mina"
        try {
            assertEquals("silver", NewOrderPieceDraft().metal)
            assertNotNull(EntryHouse.margin)
            assertNull(EntryHouse.margin.rattiLess)
        } finally {
            EntryHouse.id = "taheri"
        }
        assertEquals("gold", NewOrderPieceDraft().metal)
    }
}
