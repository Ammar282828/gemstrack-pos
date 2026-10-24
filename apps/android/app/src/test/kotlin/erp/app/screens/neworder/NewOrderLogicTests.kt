package erp.app.screens.neworder

import erp.app.config.Prefs
import erp.app.ui.EntryStep
import erp.app.ui.EntryStepState
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDay
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.logic.MarginSettings
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Settings
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NewOrderLogicTests {
    private fun piece(description: String = "Ruby ring", weight: String = "5", metal: String = "gold", karat: String = "21k", size: String = "", manual: Boolean = false, price: String = ""): NewOrderPieceDraft {
        EntryHouse.id = "taheri"
        val p = NewOrderPieceDraft()
        p.description = description
        p.weight = weight
        p.metal = metal
        p.karat = karat
        p.size = size
        p.manual = manual
        p.manualPrice = price
        return p
    }

    private fun settings(extra: Map<String, Any?> = emptyMap()): Settings =
        Settings.fromMap(mapOf("goldRatePerGram24k" to 30000.0, "goldRatePerGram22k" to 27500.0, "goldRatePerGram21k" to 26000.0, "goldRatePerGram18k" to 22500.0, "silverRatePerGram" to 450.0) + extra)

    // MARK: Steps

    @Test fun anEmptyOrderMarksNoStepAndAFilledOneTicksThem() {
        val d = NewOrderDraft.fresh()
        assertTrue(NewOrderLogic.stepStates(d).isEmpty())
        d.customerName = "  Sana Demo "
        d.pieces.add(piece())
        d.advance = "5,000"
        val s = NewOrderLogic.stepStates(d)
        assertEquals(EntryStepState.done, s[EntryStep.customer])
        assertEquals(EntryStepState.done, s[EntryStep.pieces])
        assertEquals(EntryStepState.done, s[EntryStep.payment])
        assertNull(s[EntryStep.review])
    }

    @Test fun aPieceThatWouldStopTheSaveNeedsALook() {
        val d = NewOrderDraft.fresh()
        d.pieces.add(piece(description = "Ri"))
        assertEquals(EntryStepState.attention, NewOrderLogic.stepStates(d)[EntryStep.pieces])
        d.pieces[0].description = "Ring"
        d.pieces[0].weight = ""
        assertEquals(EntryStepState.attention, NewOrderLogic.stepStates(d)[EntryStep.pieces])
        // a fixed price needs a price, not a weight
        d.pieces[0].manual = true
        assertEquals(EntryStepState.attention, NewOrderLogic.stepStates(d)[EntryStep.pieces])
        d.pieces[0].manualPrice = "120000"
        assertEquals(EntryStepState.done, NewOrderLogic.stepStates(d)[EntryStep.pieces])
    }

    @Test fun aNegativeDiscountOrAdvanceNeedsALookOnPayment() {
        val d = NewOrderDraft.fresh()
        d.discount = "-5"
        assertEquals(EntryStepState.attention, NewOrderLogic.stepStates(d)[EntryStep.payment])
        d.discount = ""
        d.advance = "-1"
        assertEquals(EntryStepState.attention, NewOrderLogic.stepStates(d)[EntryStep.payment])
    }

    // MARK: The list of pieces

    @Test fun aPieceReadsAsMetalWeightAndSize() {
        assertEquals("Gold (21K) · 5 g · 10", NewOrderLogic.pieceSpec(piece(size = "10")))
        // a fixed price shows no weight
        assertEquals("Gold (21K)", NewOrderLogic.pieceSpec(piece(manual = true, price = "1000")))
    }

    @Test fun theBalanceIsCreditOnceMoreHasBeenTaken() {
        assertEquals(NewOrderLogic.DueTone.credit, NewOrderLogic.dueTone(-1000.0))
        assertEquals(NewOrderLogic.DueTone.owed, NewOrderLogic.dueTone(1000.0))
        assertEquals(NewOrderLogic.DueTone.settled, NewOrderLogic.dueTone(0.2))
        assertEquals("Credit to customer", NewOrderLogic.dueLabel(-1.0))
        assertEquals("Due", NewOrderLogic.dueLabel(0.0))
    }

    @Test fun theReviewPaneSaysCreditOrBalance() {
        val t = NewOrderMath.Totals().apply { subtotal = 100000.0; discount = 5000.0; advance = 20000.0; exchange = 0.0; balance = 75000.0 }
        val rows = NewOrderLogic.reviewFigures(t).toMap()
        assertEquals("PKR 100,000", rows["Estimate"])
        assertEquals("PKR 75,000", rows["Balance due"])
        t.balance = -3000.0
        assertEquals("PKR 3,000", NewOrderLogic.reviewFigures(t).toMap()["Credit to customer"])
        assertEquals("1. Untitled piece", NewOrderLogic.pieceLabel(0, ""))
    }

    // MARK: Promised

    @Test fun urgentWordsSayHowSoon() {
        assertEquals("Urgent · past", NewOrderLogic.urgentWords(-3))
        assertEquals("Urgent · today", NewOrderLogic.urgentWords(0))
        assertEquals("Urgent · 4d", NewOrderLogic.urgentWords(4))
    }

    @Test fun theCalendarWorksInUtcMidnightsAndGivesTheSameDayBack() {
        for (day in listOf("2026-10-12", "2027-01-01", "2028-02-29")) {
            val ms = assertNotNull(NewOrderLogic.dayToPickerMillis(day))
            assertEquals(day, NewOrderLogic.pickerMillisToDay(ms))
        }
        assertNull(NewOrderLogic.dayToPickerMillis(""))
        assertNull(NewOrderLogic.dayToPickerMillis("12/10/2026"))
        assertEquals(NewOrderDay.after(14), NewOrderDay.after(14))
    }

    // MARK: Rates

    @Test fun onlyTheRatesTheOrderUsesAreOnScreen() {
        val d = NewOrderDraft.fresh()
        assertTrue(NewOrderLogic.rateBoxes(d).isEmpty())
        d.pieces.add(piece(karat = "21k"))
        d.pieces.add(piece(karat = "18k"))
        assertEquals(listOf("Gold 21k", "Gold 18k"), NewOrderLogic.rateBoxes(d).map { it.label })
        d.pieces.add(piece(metal = "palladium", karat = "12k"))
        assertEquals(listOf("Gold 21k", "Gold 18k", "Palladium 12k"), NewOrderLogic.rateBoxes(d).map { it.label })
        assertTrue(NewOrderLogic.hasPalladium(d))
        assertFalse(NewOrderLogic.hasSilver(d))
        d.pieces.add(piece(metal = "silver", karat = ""))
        assertTrue(NewOrderLogic.hasSilver(d))
        // Silver's one all-in rate is a box of its own, last.
        assertEquals("Silver (all-in)", NewOrderLogic.rateBoxes(d).last().label)
    }

    @Test fun silverTakesTheOrdersOwnRateElseTheShops() {
        val s = settings()
        val d = NewOrderDraft.fresh()
        d.pieces.add(piece(metal = "silver", karat = ""))
        d.seedRates(s)
        // Blank or untouched: the shop's.
        assertEquals(s.silverRatePerGram, NewOrderMath.formRates(d, s).silverRatePerGram)
        d.rates["silverRatePerGram"] = "500"
        assertEquals(500.0, NewOrderMath.formRates(d, s).silverRatePerGram)
        assertTrue(NewOrderLogic.ratesDiffer(d, s))
        // Stamped on the order, so it prices the same for ever.
        assertEquals(500.0, NewOrderMath.ratesApplied(NewOrderMath.formRates(d, s))["silverRatePerGram"])
        d.rates["silverRatePerGram"] = ""
        assertEquals(s.silverRatePerGram, NewOrderMath.formRates(d, s).silverRatePerGram)
    }

    @Test fun aTypedRateThatIsNotTodaysOffersTodays() {
        val s = settings()
        val d = NewOrderDraft.fresh()
        d.pieces.add(piece(karat = "21k"))
        d.seedRates(s)
        assertFalse(NewOrderLogic.ratesDiffer(d, s))
        d.rates["goldRatePerGram21k"] = "25000"
        assertTrue(NewOrderLogic.ratesDiffer(d, s))
        assertFalse(NewOrderLogic.ratesDiffer(d, null))
        assertTrue(NewOrderLogic.ratesFooter(true, true).contains("flat palladium rate"))
        assertTrue(NewOrderLogic.ratesFooter(false, true).contains("Silver's rate already holds"))
        assertFalse(NewOrderLogic.ratesFooter(false, false).contains("Silver"))
    }

    // MARK: Delivery

    private fun customer(id: String = "c1", address: String? = "House 4, Block B") =
        Customer.fromMap(mapOf("id" to id, "name" to "Sana Demo", "address" to address))

    private fun order(id: String, customerId: String, address: String?): Order =
        Order.fromMap(mapOf("id" to id, "customerId" to customerId, "delivery" to mapOf("required" to true, "address" to (address ?: ""))))

    private fun invoice(id: String, customerId: String, address: String): Invoice =
        Invoice.fromMap(mapOf("id" to id, "customerId" to customerId, "delivery" to mapOf("required" to true, "address" to address)))

    @Test fun theAddressesOnFileComeOnceEachWithTheCustomersOwnFirst() {
        val out = NewOrderLogic.knownAddresses(
            "c1",
            listOf(customer()),
            listOf(order("o1", "c1", "Flat 9, Seaview"), order("o2", "c2", "Elsewhere"), order("o3", "c1", "house 4, block b")),
            listOf(invoice("i1", "c1", "Flat 9, Seaview"), invoice("i2", "c1", "Shop 3, Main Road")),
        )
        assertEquals(listOf("House 4, Block B", "Flat 9, Seaview", "Shop 3, Main Road"), out)
        assertTrue(NewOrderLogic.knownAddresses("", listOf(customer()), emptyList(), emptyList()).isEmpty())
    }

    // MARK: The shop's margin

    @Test fun theMarginWordsFollowTheHouse() {
        val taheri = MarginSettings.taheri
        assertEquals("Without it the margin is taken as 10%.", NewOrderLogic.rateWords(0.0, taheri))
        assertEquals("Without it the margin is taken as 40%.", NewOrderLogic.rateWords(0.0, MarginSettings.mina))
        assertTrue(NewOrderLogic.rateWords(3000.0, taheri).contains("(24k less 6 ratti)"))
        assertEquals("—", NewOrderLogic.marginWords(null, taheri))
        assertEquals(10, NewOrderLogic.assumedPercent(taheri))
    }

    @Test fun theRateSheetsToolaIsWholeRupees() {
        // 30,000 a gram × 11.664 g
        assertEquals(349920, NewOrderLogic.sheetTola(settings()))
        assertEquals(0, NewOrderLogic.sheetTola(null))
    }

    // MARK: Routes

    @Test fun theEditAndSlipPathsAreTheOrdersOwn() {
        assertEquals("ORD-000123", NewOrderLogic.editId("/orders/ORD-000123/edit"))
        assertEquals("ORD-000123", NewOrderLogic.editId("/orders/ORD-000123/edit?x=1"))
        assertEquals("ORD/1", NewOrderLogic.editId("/orders/ORD%2F1/edit"))
        assertNull(NewOrderLogic.editId("/orders/ORD-000123"))
        assertNull(NewOrderLogic.editId("/orders//edit"))
        assertNull(NewOrderLogic.editId("/orders/a/b/edit"))
        assertEquals("ORD-000123", NewOrderLogic.slipId("/orders/ORD-000123/slip"))
        assertNull(NewOrderLogic.slipId("/orders/ORD-000123/finalize"))
    }

    @Test fun scanParchiOpensTheSlipReader() {
        assertTrue(NewOrderLogic.asks("/orders/add?scan=parchi", "parchi"))
        assertTrue(NewOrderLogic.asks("/orders/add?a=1&scan=parchi", "parchi"))
        assertFalse(NewOrderLogic.asks("/orders/add", "parchi"))
        assertFalse(NewOrderLogic.asks("/orders/add?scan=bill", "parchi"))
    }

    @Test fun theGroupAnswersAddEditAndSlipAndLeavesTheOrderItselfToOrders() {
        fun hit(p: String) = NewOrderRoutes.any { it.matches(p) }
        assertTrue(hit("/orders/add"))
        assertTrue(hit("/orders/add?scan=parchi"))
        assertTrue(hit("/orders/ORD-000123/edit"))
        assertTrue(hit("/orders/ORD-000123/slip"))
        assertFalse(hit("/orders"))
        assertFalse(hit("/orders/ORD-000123"))
        assertFalse(hit("/orders/ORD-000123/finalize"))
        assertEquals("/api/app/pdf/order-slip/ORD-000123", slipTarget("ORD-000123").path)
        assertEquals("OrderSlip-ORD-000123.pdf", slipTarget("ORD-000123").fileName)
    }

    // MARK: Words

    @Test fun aRepeatedOrderIsAlreadySentNotLost() {
        assertTrue(NewOrderLogic.alreadySent(409, "This was already sent a moment ago."))
        assertFalse(NewOrderLogic.alreadySent(409, "No longer in stock"))
        assertFalse(NewOrderLogic.alreadySent(500, "This was already sent"))
        assertTrue(NewOrderLogic.noAnswer("Timed out", true).endsWith("Check Orders before saving it again."))
        assertTrue(NewOrderLogic.noAnswer("Timed out", false).endsWith("Check the order before saving again."))
    }

    @Test fun stockIsFoundAsTheSaleFindsIt() {
        assertTrue(stockFound("  ", emptyList()).isEmpty())
    }

    // MARK: The order on this phone

    @Test fun theDraftHolderTellsReadersWhenItMoves() {
        val h = DraftHolder(NewOrderDraft.fresh())
        val before = h.stamp
        h.edit { customerName = "Sana Demo" }
        assertEquals(before + 1, h.stamp)
        assertEquals("Sana Demo", h.read().customerName)
        val p = piece()
        h.edit { pieces.add(p) }
        h.editPiece(p.id) { description = "Pearl set" }
        assertEquals("Pearl set", h.now.pieces[0].description)
        h.replace(NewOrderDraft.fresh())
        assertTrue(h.now.pieces.isEmpty())
    }

    @Test fun theOrderKeptOnThePhoneComesBackAndABlankOneIsNotKept() {
        NewOrderPhoneStore.clear()
        assertNull(NewOrderPhoneStore.load())
        val d = NewOrderDraft.fresh()
        NewOrderPhoneStore.save(d)
        assertNull(Prefs.string("erp.orderDraft"), "a blank order is not kept")
        d.customerName = "Sana Demo"
        d.pieces.add(piece(weight = "4.5"))
        d.pieces[0].photo = byteArrayOf(1, 2, 3)
        NewOrderPhoneStore.save(d)
        val back = assertNotNull(NewOrderPhoneStore.load())
        assertEquals("Sana Demo", back.customerName)
        assertEquals("4.5", back.pieces[0].weight)
        assertTrue(back.pieces[0].photo!!.contentEquals(byteArrayOf(1, 2, 3)))
        NewOrderPhoneStore.clear()
        assertNull(NewOrderPhoneStore.load())
    }
}
