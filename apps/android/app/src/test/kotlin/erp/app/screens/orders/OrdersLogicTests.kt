package erp.app.screens.orders

import erp.app.screens.orders.OrdersLogic.dueGroups
import erp.core.ERPDecode
import erp.core.logic.OrderStage
import erp.core.models.Invoice
import erp.core.models.Order
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// OrdersLogic.swift has no tests on the iPhone; these pin its readings of the ERP's rules (made-up names, phones
// and amounts only). "Now" is Monday 12 Oct 2026, noon in Karachi.
class OrdersLogicTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun item(description: String = "Ring", total: Double? = 20_000.0, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("description" to description, "totalEstimate" to total, "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5.0) + extra

    private fun order(vararg changes: Pair<String, Any?>): Order = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-1", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to "Pending", "grandTotal" to 40_000.0,
            "customerName" to "Sana Demo", "items" to listOf(item()),
        ) + changes,
    )!!

    private fun invoice(id: String, balance: Double, status: String = "Paid"): Invoice =
        ERPDecode.model<Invoice>(mapOf("id" to id, "balanceDue" to balance, "status" to status, "createdAt" to "2026-10-08T05:00:00.000Z"))!!

    // MARK: Next step

    @Test fun anOrderNotStartedIsGivenOut() {
        val o = order()
        assertEquals(OrderNextStep.GiveOut, OrdersLogic.nextStep(o, erp.core.logic.stageOf(o), 0.0))
    }

    @Test fun anOnlineOrderWithASlipInSaysSo() {
        val o = order("website" to mapOf("paymentStatus" to "slip_sent", "token" to "t"))
        val step = OrdersLogic.nextStep(o, erp.core.logic.stageOf(o), 0.0)
        assertEquals(OrderNextStep.CheckTransfer(slipIn = true), step)
        assertEquals("Slip in: check", step?.title)
        assertEquals("Check transfer", OrderNextStep.CheckTransfer(false).title)
    }

    @Test fun inProgressIsMarkedReadyAndCompletedIsInvoiced() {
        val making = order("status" to "In Progress")
        assertEquals(OrderNextStep.MarkReady, OrdersLogic.nextStep(making, OrderStage.karigar, 0.0))
        val done = order("status" to "Completed")
        assertEquals(OrderNextStep.Finalize, OrdersLogic.nextStep(done, OrderStage.ready, 0.0))
        assertEquals("Make invoice", OrderNextStep.Finalize.title)
    }

    @Test fun anInvoicedOrderPointsAtItsInvoice() {
        val o = order("status" to "Completed", "invoiceId" to "INV-9")
        assertEquals(OrderNextStep.Invoice("INV-9", 12_500.0), OrdersLogic.nextStep(o, OrderStage.payment, 12_500.0))
        assertEquals("Take PKR 12,500", OrderNextStep.Invoice("INV-9", 12_500.0).title)
        assertEquals("Open INV-9", OrderNextStep.Invoice("INV-9", 0.0).title)
        assertNull(OrdersLogic.nextStep(order("status" to "Cancelled"), OrderStage.closed, 0.0))
    }

    @Test fun anAdvanceIsAnOwnersOnAnOrderBeingMade() {
        val o = order()
        assertTrue(OrdersLogic.offersAdvance(o, OrderStage.new, isOwner = true))
        assertFalse(OrdersLogic.offersAdvance(o, OrderStage.new, isOwner = false))
        assertFalse(OrdersLogic.offersAdvance(order("invoiceId" to "INV-1"), OrderStage.payment, isOwner = true))
        assertFalse(OrdersLogic.canAdvance(order("status" to "Refunded")))
    }

    // MARK: Owing and the Due view

    @Test fun owedOnInvoicesIsTheErpsOwingRule() {
        val owed = OrdersLogic.owedOnInvoices(listOf(invoice("INV-1", 5_000.0), invoice("INV-2", 0.3), invoice("INV-3", 9_000.0, "Refunded")))
        assertEquals(mapOf("INV-1" to 5_000.0), owed)
        assertEquals(5_000.0, OrdersLogic.owed(order("invoiceId" to "INV-1"), owed))
        assertEquals(0.0, OrdersLogic.owed(order(), owed))
        // Not invoiced: the order's own balance; invoiced: what the invoice has owing.
        assertEquals(40_000.0, OrdersLogic.stillOwed(order(), 0.0))
        assertEquals(5_000.0, OrdersLogic.stillOwed(order("invoiceId" to "INV-1"), 5_000.0))
    }

    @Test fun theDueViewKeepsOpenOrdersInTheOrderTheyAreChased() {
        val orders = listOf(
            order("id" to "L2", "promisedDate" to "2026-10-10"),
            order("id" to "L1", "promisedDate" to "2026-10-08"),
            order("id" to "T", "promisedDate" to "2026-10-12"),
            order("id" to "W", "promisedDate" to "2026-10-15"),
            order("id" to "Z", "promisedDate" to "2026-10-30"),
            // No day promised and not old: undated. An invoiced or cancelled order has no promise to keep.
            order("id" to "U", "createdAt" to "2026-10-11T05:00:00.000Z"),
            order("id" to "I", "promisedDate" to "2026-10-09", "invoiceId" to "INV-1"),
            order("id" to "C", "promisedDate" to "2026-10-09", "status" to "Cancelled"),
        )
        val groups = dueGroups(orders, now)
        assertEquals(listOf("Late", "Today", "This week", "Later", "No date"), groups.map { it.first.title })
        // The soonest promise first, so the latest of the late.
        assertEquals(listOf("L1", "L2"), groups[0].second.map { it.id })
        assertEquals(listOf("T"), groups[1].second.map { it.id })
        assertEquals(listOf("W"), groups[2].second.map { it.id })
        assertEquals(listOf("Z"), groups[3].second.map { it.id })
        assertEquals(listOf("U"), groups[4].second.map { it.id })
    }

    @Test fun anOldOrderWithNoPromiseIsUndatedHoweverTheAgeRuleCallsIt() {
        val old = order("createdAt" to "2026-09-01T05:00:00.000Z")
        assertEquals(OrdersDueBucket.undated, OrdersLogic.dueBucket(erp.core.logic.orderTiming(old, now)))
    }

    // MARK: Sections

    @Test fun theDayViewNamesTodayAndHidesThisYear() {
        val a = order("id" to "A", "createdAt" to "2026-10-12T03:00:00.000Z")
        val b = order("id" to "B", "createdAt" to "2026-10-07T05:00:00.000Z")
        val s = OrdersLogic.sections(listOf(b, a), OrdersGrouping.day, emptyMap(), now)
        assertEquals(listOf("Today", "Wednesday 7 Oct"), s.map { it.title })
        assertEquals("12 Oct 2026", s[0].hint)
        // A bare year says something only when it is not this one.
        assertEquals("", s[1].hint)
        assertTrue(s.none { it.folds })
    }

    @Test fun theWeekAndMonthViewsAreMondayWeeksAndMonths() {
        val a = order("id" to "A", "createdAt" to "2026-10-12T03:00:00.000Z")
        val b = order("id" to "B", "createdAt" to "2026-10-07T05:00:00.000Z")
        val w = OrdersLogic.sections(listOf(a, b), OrdersGrouping.week, emptyMap(), now)
        assertEquals(listOf("Week of 12 Oct", "Week of 5 Oct"), w.map { it.title })
        assertEquals(listOf("This week", ""), w.map { it.hint })
        val m = OrdersLogic.sections(listOf(a, b, order("id" to "C", "createdAt" to "2026-09-30T05:00:00.000Z")), OrdersGrouping.month, emptyMap(), now)
        assertEquals(listOf("October 2026", "September 2026"), m.map { it.title })
        assertEquals(listOf("This month", ""), m.map { it.hint })
        assertEquals(listOf(listOf("A", "B"), listOf("C")), m.map { s -> s.orders.map { it.id } })
    }

    @Test fun anOrderWithNoReadableDateIsGroupedAsNoDate() {
        val s = OrdersLogic.sections(listOf(order("createdAt" to "")), OrdersGrouping.day, emptyMap(), now)
        assertEquals(listOf("No date"), s.map { it.title })
    }

    @Test fun theStageViewFoldsDoneAndClosedAndLeavesOutEmptyStages() {
        val orders = listOf(
            order("id" to "N"),
            order("id" to "K", "status" to "In Progress"),
            order("id" to "D", "status" to "Completed", "invoiceId" to "INV-1"),
            order("id" to "X", "status" to "Cancelled"),
        )
        val s = OrdersLogic.sections(orders, OrdersGrouping.stage, emptyMap(), now)
        assertEquals(listOf("With karigars", "Not started", "Done", "Cancelled or refunded"), s.map { it.title })
        assertEquals(listOf(false, false, true, true), s.map { it.folds })
        // Owing on the invoice moves it to Awaiting payment, which does not fold.
        val owing = OrdersLogic.sections(orders, OrdersGrouping.stage, mapOf("INV-1" to 900.0), now)
        assertEquals("Awaiting payment", owing[2].title)
        assertFalse(owing[2].folds)
    }

    @Test fun theFiltersNarrowByPaymentMonthAndWhoTookIt() {
        val paid = order("id" to "P", "grandTotal" to 0.0, "takenBy" to "Sana", "createdAt" to "2026-09-30T05:00:00.000Z")
        val partial = order("id" to "H", "grandTotal" to 100.0, "advancePayment" to 50.0, "takenBy" to "Omar")
        val unpaid = order("id" to "U", "grandTotal" to 100.0, "takenBy" to "Sana")
        val all = listOf(paid, partial, unpaid)
        assertEquals(listOf("P"), OrdersLogic.scope(all, "", "", "", "Paid").map { it.id })
        assertEquals(listOf("H"), OrdersLogic.scope(all, "", "", "", "Partial").map { it.id })
        assertEquals(listOf("P"), OrdersLogic.scope(all, "", "2026-09", "", "All").map { it.id })
        assertEquals(listOf("H"), OrdersLogic.scope(all, "", "", "Omar", "All").map { it.id })
        assertEquals(listOf("P", "H", "U"), OrdersLogic.scope(all, "", "", "", "All").map { it.id })
    }

    // MARK: Whose, search, names

    @Test fun anOrderIsMineOnlyWhenTheNamesMatch() {
        val o = order("takenBy" to "Sana")
        assertTrue(OrdersLogic.isMine(o, "Sana"))
        assertFalse(OrdersLogic.isMine(o, "Omar"))
        assertFalse(OrdersLogic.isMine(o, null))
        assertFalse(OrdersLogic.isMine(o, ""))
    }

    @Test fun searchReadsIdCustomerPhoneOnlineNumberAndPieces() {
        val o = order(
            "customerContact" to "0300-1234567", "summary" to "Bridal set",
            "website" to mapOf("onlineId" to "ONL-77", "token" to "t"),
            "items" to listOf(item("Pearl pendant")),
        )
        for (q in listOf("ord-1", "sana", "1234567", "0300 1234", "bridal", "onl-77", "pearl", "  SANA ", "")) assertTrue(OrdersLogic.matches(o, q), q)
        for (q in listOf("nobody", "999", "09")) assertFalse(OrdersLogic.matches(o, q), q)
    }

    @Test fun aWalkInIsNotACustomerName() {
        assertEquals("Walk-in", OrdersLogic.customerName(order("customerName" to "")))
        assertEquals("Walk-in", OrdersLogic.customerName(order("customerName" to " walk in ")))
        assertEquals("Sana Demo", OrdersLogic.customerName(order()))
    }

    @Test fun phonesAreWrittenTheShopsWay() {
        assertEquals("0300 1234567", OrdersLogic.phoneWords("03001234567"))
        assertEquals("+92 300 1234567", OrdersLogic.phoneWords("+923001234567"))
        assertEquals("+92 300 1234567", OrdersLogic.phoneWords("923001234567"))
        assertEquals("ask for Sana", OrdersLogic.phoneWords("ask for Sana"))
        assertEquals("", OrdersLogic.phoneWords(null))
        assertEquals("+923001234567", OrdersLogic.dialable("+92 300-1234567"))
    }

    // MARK: Words

    @Test fun theCardSaysWhatTheOrderIs() {
        assertEquals("Bridal set" to "2 pieces", OrdersLogic.cardWhat(order("summary" to " Bridal set ", "items" to listOf(item("A"), item("B")))))
        assertEquals("A" to "+1 more", OrdersLogic.cardWhat(order("items" to listOf(item("A"), item("B")))))
        assertEquals("No pieces" to null, OrdersLogic.cardWhat(order("items" to emptyList<Any>())))
        assertEquals("1 piece" to null, OrdersLogic.cardWhat(order("items" to listOf(item("   ")))))
        assertEquals("A, B, C and 2 more", OrdersLogic.whatIsIt(order("items" to listOf("A", "B", "C", "D", "E").map { item(it) })))
    }

    @Test fun figuresLoseTheirTrailingZeros() {
        assertEquals("4.2", OrdersLogic.number(4.2))
        assertEquals("8", OrdersLogic.number(8.0))
        assertEquals("1,234.568", OrdersLogic.number(1234.5678))
        assertEquals("12.5", OrdersLogic.number(12.5, 2))
        assertEquals("8.25", OrdersLogic.number(8.254, 2))
        assertEquals("12.5 g", OrdersLogic.grams(12.5))
    }

    @Test fun theRatesTheOrderWasBookedAtAreNamedOncePerKarat() {
        val o = order(
            "ratesApplied" to mapOf("goldRatePerGram21k" to 33_700.0, "goldRatePerGram22k" to 35_000.0),
            "items" to listOf(item("A"), item("B"), item("C", extra = mapOf("karat" to "22k")), item("S", extra = mapOf("metalType" to "silver"))),
        )
        assertEquals("Gold (21K): PKR 33,700/g | Gold (22K): PKR 35,000/g", OrdersLogic.rateLine(o))
        // Staff's orders carry no rates: an empty line.
        assertEquals("", OrdersLogic.rateLine(order()))
    }

    @Test fun thePromiseSaysHowFarOffItIsOnlyWhileChased() {
        assertEquals("Due today", OrdersLogic.promiseLine(order("promisedDate" to "2026-10-12"), now))
        assertEquals("Due Sat 10 Oct · 2 days late", OrdersLogic.promiseLine(order("promisedDate" to "2026-10-10"), now))
        assertEquals("Due Thu 15 Oct · in 3 days", OrdersLogic.promiseLine(order("promisedDate" to "2026-10-15"), now))
        // A finished order's promise is history.
        assertEquals("Due Sat 10 Oct", OrdersLogic.promiseLine(order("promisedDate" to "2026-10-10", "status" to "Completed"), now))
        assertEquals("No day promised", OrdersLogic.promiseLine(order("createdAt" to "2026-10-11T05:00:00.000Z"), now))
        assertEquals("No day promised · 12 days old", OrdersLogic.promiseLine(order("createdAt" to "2026-09-30T05:00:00.000Z"), now))
        val p = OrdersLogic.promise(order("promisedDate" to "2026-10-10"), now)
        assertTrue(p.chase && p.urgent && p.showsLabel)
        assertEquals(erp.core.logic.PromiseState.late, p.state)
        assertEquals("2 days late", p.label)
        assertTrue(OrdersLogic.promise(order(), now).undated)
    }

    // MARK: Money

    @Test fun theBalanceIsAlwaysWorkedFromThePieces() {
        val o = order(
            "items" to listOf(item("A", 30_000.0), item("B", 20_000.0), item("C", null)),
            "subtotal" to 99_999.0, "discountAmount" to 1_000.0, "advancePayment" to 5_000.0, "advanceInExchangeValue" to 2_000.0,
        )
        assertEquals(50_000.0, OrdersLogic.subtotal(o))
        assertEquals(42_000.0, OrdersLogic.balance(o))
    }

    @Test fun advancesAreListedWithTheirDayMethodAndNote() {
        val o = order(
            "advancePayment" to 5_000.0, "advanceMethod" to "Bank Transfer",
            "advances" to listOf(mapOf("amount" to 2_000.0, "date" to "2026-10-09T05:00:00.000Z", "method" to "Cash", "notes" to "Second")),
        )
        val lines = OrdersLogic.advanceLines(o)
        assertEquals(2, lines.size)
        assertEquals(3_000.0, lines[0].amount)
        assertEquals("With the order", lines[0].note)
        assertEquals("Bank Transfer", lines[0].method)
        assertEquals("Second", lines[1].note)
        assertEquals("Cash", lines[1].method)
    }

    @Test fun anOnlineOrderCustomerPaysItsTotalOrThePiecesAndDelivery() {
        val withTotal = order("website" to mapOf("total" to 210_000.0, "deliveryCharge" to 500.0, "token" to "t"), "subtotal" to 200_000.0)
        assertEquals(210_000.0, OrdersLogic.onlineTotal(withTotal))
        val without = order("website" to mapOf("deliveryCharge" to 500.0, "token" to "t"), "subtotal" to 200_000.0)
        assertEquals(200_500.0, OrdersLogic.onlineTotal(without))
        assertEquals("Slip sent: check the bank", OrdersLogic.paymentWords(erp.core.models.WebsitePaymentStatus.slipSent))
        assertEquals("Lapsed", OrdersLogic.paymentWords(erp.core.models.WebsitePaymentStatus.expired))
        assertEquals("odd", OrdersLogic.paymentWords(erp.core.models.WebsitePaymentStatus.unknown("odd")))
    }

    @Test fun marginWordsFollowTheShopMargin() {
        val taheri = erp.core.logic.MarginSettings.taheri
        assertTrue(OrdersLogic.marginIsOn(taheri))
        assertFalse(OrdersLogic.marginIsOn(erp.core.logic.MarginSettings.mina))
        val assumed = erp.core.logic.Margin(percent = 10.0, revenue = 1.0, cost = 1.0, profit = 1.0, assumed = true, costedShare = 0.0)
        assertEquals("≈ 10% (no 24k rate given: assumed)", OrdersLogic.marginWords(assumed, taheri))
        val part = erp.core.logic.Margin(percent = 18.5, revenue = 100_000.0, cost = 80_000.0, profit = 20_000.0, assumed = false, costedShare = 0.8)
        assertEquals("19% · PKR 20,000 · 20% of it at 10% (no weight)", OrdersLogic.marginWords(part, taheri))
    }

    @Test fun theGroupingKeptOnThePhoneComesBackAndDefaultsToDay() {
        assertEquals(OrdersGrouping.week, OrdersGrouping.of("week"))
        assertEquals(OrdersGrouping.day, OrdersGrouping.of("nonsense"))
        assertEquals(OrdersGrouping.day, OrdersGrouping.of(null))
        // The switcher's first segment is the calendar cut in use.
        assertEquals(OrdersGrouping.week, OrdersGrouping.week.calendarCut)
        assertEquals(OrdersGrouping.day, OrdersGrouping.due.calendarCut)
        assertEquals(OrdersGrouping.day, OrdersGrouping.stage.calendarCut)
    }

    @Test fun monthsAreKeptAndNamedLikeTheInvoicesList() {
        assertEquals("2026-10", OrdersCalendar.monthKey("2026-10-12T03:00:00.000Z"))
        // 20:00 UTC on the 30th is already the 1st in Karachi.
        assertEquals("2026-10", OrdersCalendar.monthKey("2026-09-30T20:00:00.000Z"))
        assertNull(OrdersCalendar.monthKey("nope"))
        assertEquals("October 2026", OrdersCalendar.monthLabel("2026-10"))
        assertEquals("bad", OrdersCalendar.monthLabel("bad"))
    }

    @Test fun pathsEncodeAnIdAsOnePiece() {
        assertEquals("ORD-000123", OrderPaths.piece("ORD-000123"))
        assertEquals("A%20B%23C", OrderPaths.piece("A B#C"))
        assertEquals("/workshop?order=ORD-1", OrderPaths.giveOut("ORD-1"))
        assertEquals("/orders/ORD-1?web=1", OrderPaths.orderPage("ORD-1"))
        assertEquals("ORD-1", OrderPaths.finalizeId("/orders/ORD-1/finalize"))
        assertEquals("ORD-1", OrderPaths.finalizeId("/orders/ORD-1/finalize?x=1"))
        assertNull(OrderPaths.finalizeId("/orders/ORD-1/slip"))
        assertNull(OrderPaths.finalizeId("/orders//finalize"))
        assertNull(OrderPaths.finalizeId("/orders/a/b/finalize"))
    }
}
