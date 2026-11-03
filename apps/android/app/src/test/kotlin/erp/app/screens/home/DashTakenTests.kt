package erp.app.screens.home

import erp.core.ERPDecode
import erp.core.models.AdditionalRevenue
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Mirrors src/lib/taken-by-day.test.ts over the same made-up books (names, phones and amounts are invented). Days are Karachi's,
// as Home's are; "now" is Tuesday 3 Nov 2026, noon there.
class DashTakenTests {
    private val now = Instant.parse("2026-11-03T07:00:00Z")

    private fun invoice(m: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(m)!!
    private fun order(m: Map<String, Any?>): Order = ERPDecode.model<Order>(m)!!
    private fun revenue(m: Map<String, Any?>): AdditionalRevenue = ERPDecode.model<AdditionalRevenue>(m)!!
    private fun repair(m: Map<String, Any?>): Repair = ERPDecode.model<Repair>(m)!!

    private val invoices = listOf(
        // Cash 60k + bank 40k of a 150k sale: 50k not paid yet.
        invoice(mapOf("id" to "INV-1", "customerName" to "Sara", "createdAt" to "2026-11-01T10:00:00", "status" to "Paid", "takenBy" to "Ammar",
            "items" to listOf(mapOf("name" to "Ring", "itemTotal" to 150000, "categoryId" to "cat001")), "subtotal" to 150000, "grandTotal" to 150000, "amountPaid" to 100000, "balanceDue" to 50000,
            "paymentHistory" to listOf(mapOf("amount" to 60000, "date" to "2026-11-01T10:00:00", "method" to "Cash"), mapOf("amount" to 40000, "date" to "2026-11-01T10:05:00", "method" to "Bank Transfer")))),
        // Old gold off the total: sale 200k = 150k card + 50k exchange.
        invoice(mapOf("id" to "INV-2", "customerName" to "Hina", "createdAt" to "2026-11-02T12:00:00", "status" to "Paid",
            "items" to listOf(mapOf("name" to "Set", "itemTotal" to 200000, "categoryId" to "cat013")), "subtotal" to 200000, "grandTotal" to 150000, "amountPaid" to 150000, "balanceDue" to 0,
            "exchanges" to listOf(mapOf("description" to "old chain", "value" to 50000)),
            "paymentHistory" to listOf(mapOf("amount" to 150000, "date" to "2026-11-02T12:00:00", "method" to "Card")))),
        // A gold coin: not in Home's figure.
        invoice(mapOf("id" to "INV-3", "customerName" to "Ali", "createdAt" to "2026-11-02T13:00:00", "status" to "Paid",
            "items" to listOf(mapOf("name" to "Coin", "itemTotal" to 90000, "categoryId" to "cat017")), "subtotal" to 90000, "grandTotal" to 90000, "amountPaid" to 90000, "balanceDue" to 0,
            "paymentHistory" to listOf(mapOf("amount" to 90000, "date" to "2026-11-02T13:00:00", "method" to "Cash")))),
        invoice(mapOf("id" to "INV-4", "customerName" to "Gone", "createdAt" to "2026-11-02T14:00:00", "status" to "Refunded", "items" to emptyList<Any>(), "subtotal" to 5, "grandTotal" to 5, "amountPaid" to 5, "balanceDue" to 0, "paymentHistory" to emptyList<Any>())),
    )
    private val orders = listOf(
        order(mapOf("id" to "ORD-1", "customerName" to "Noor", "createdAt" to "2026-11-03T09:00:00", "status" to "Pending", "subtotal" to 80000, "discountAmount" to 0, "advancePayment" to 30000, "advanceMethod" to "Cash", "grandTotal" to 50000, "summary" to "Kada pair", "takenBy" to "Ammar", "items" to emptyList<Any>())),
        order(mapOf("id" to "ORD-2", "customerName" to "Done", "createdAt" to "2026-11-03T09:00:00", "status" to "Completed", "invoiceId" to "INV-1", "subtotal" to 999, "grandTotal" to 0, "advancePayment" to 0, "items" to emptyList<Any>())),
    )
    private val revenues = listOf(
        revenue(mapOf("id" to "X1", "date" to "2026-11-03T15:00:00", "description" to "Polish", "amount" to 1500)),
        revenue(mapOf("id" to "X2", "date" to "2026-11-03T16:00:00", "description" to "Repair REP-1", "amount" to 4000, "repairId" to "REP-1")),
        revenue(mapOf("id" to "X3", "date" to "2026-10-31T16:00:00", "description" to "Last month", "amount" to 700)),
    )
    private val repairs = listOf(
        repair(mapOf("id" to "REP-1", "customerName" to "Zoya", "payments" to listOf(mapOf("amount" to 4000, "date" to "2026-11-03T16:00:00", "method" to "Bank Transfer", "revenueId" to "X2")))),
    )

    private val entries = DashTaken.entries(invoices, orders, revenues, repairs)
    private val days = DashTaken.days(entries, now, 3)

    private fun sum(m: Map<DashTakenMethod, Double>) = m.values.sum()

    @Test fun theDaysAddUpToWhatHomeCountsForTheRange() {
        // 150k + 200k + 80k + 1.5k + 4k: coins, the refund, the invoiced order and last month stay out.
        assertEquals(150000.0 + 200000 + 80000 + 1500 + 4000, days.sumOf { it.total }, 1e-6)
        assertEquals(listOf(150000.0, 200000.0, 85500.0), days.map { it.total })
    }

    @Test fun everyDayOfTheRangeIsThereQuietOnesToo() {
        assertEquals(3, days.size)
        assertEquals(listOf(1, 1, 3), days.map { it.entries.size })
        assertEquals(mapOf(DashTakenKind.sale to 1), days[1].kindCounts)
        // Five days back from the 3rd: the 30th is quiet; the 31st has last month's 700 of Extra revenue.
        val five = DashTaken.days(entries, now, 5)
        assertTrue(five[0].entries.isEmpty() && five[0].total == 0.0)
        assertEquals(700.0, five[1].total)
        assertEquals("1 sale", days[1].countsLine)
        assertEquals("1 order · 1 repair payment · 1 extra revenue", days[2].countsLine)
    }

    @Test fun anEntryIsSplitByWhatWasRecordedAndThePartsSumToIt() {
        val inv1 = days[0].entries.single()
        assertEquals("INV-1", inv1.ref)
        assertEquals("Ammar", inv1.who)
        assertEquals("Sara", inv1.customer)
        assertEquals("Cash + Bank + Not paid yet", inv1.methodText)
        assertEquals("/invoices/INV-1", inv1.path)
        assertEquals(mapOf(DashTakenMethod.cash to 60000.0, DashTakenMethod.bank to 40000.0, DashTakenMethod.unpaid to 50000.0), inv1.split)
        val inv2 = days[1].entries.single()
        assertEquals(150000.0, inv2.split[DashTakenMethod.card])
        assertEquals(50000.0, inv2.split[DashTakenMethod.other], "gold taken in exchange is Other")
        for (d in days) {
            for (e in d.entries) assertEquals(e.amount, sum(e.split), 1e-6)
            assertEquals(d.total, sum(d.bySplit), 1e-6)
        }
    }

    @Test fun aCounterOrderCountsAtItsSubtotalWithItsAdvanceRepairsByTheirMethodExtraRevenueAsOther() {
        val d = days[2]
        val ord = d.entries.first { it.kind == DashTakenKind.order }
        assertEquals(80000.0, ord.amount)
        assertEquals(mapOf(DashTakenMethod.cash to 30000.0, DashTakenMethod.unpaid to 50000.0), ord.split)
        assertEquals("Kada pair", ord.what)
        val rep = d.entries.first { it.kind == DashTakenKind.repair }
        assertEquals("Zoya", rep.customer)
        assertEquals(mapOf(DashTakenMethod.bank to 4000.0), rep.split)
        assertEquals("/repairs?id=REP-1", rep.path)
        val extra = d.entries.first { it.kind == DashTakenKind.extra }
        assertEquals(1500.0, extra.split[DashTakenMethod.other])
        assertEquals(null, extra.path)
        // Newest first.
        assertEquals(listOf("REP-1", "X1", "ORD-1"), d.entries.map { it.ref.ifEmpty { it.id.drop(1) } })
    }

    @Test fun anOverpaymentIsScaledBackSoThePartsStillSumToTheAmount() {
        val pay = { amount: Double, method: String -> erp.core.models.Payment(amount, "2026-11-03T10:00:00", method = erp.core.models.PaymentType.of(method)) }
        val over = DashTaken.split(100.0, listOf(pay(150.0, "Cash"), pay(50.0, "Bank Transfer")), 0.0)
        assertEquals(100.0, sum(over), 1e-9)
        assertEquals(75.0, over[DashTakenMethod.cash]!!, 1e-9)
        assertTrue(DashTakenMethod.unpaid !in over)
        // A handed-back credit lowers its method; nothing paid is all unpaid.
        assertEquals(20.0, DashTaken.split(100.0, listOf(pay(100.0, "Cash"), pay(-20.0, "Bank Transfer")), 0.0)[DashTakenMethod.unpaid]!!, 1e-9)
        assertEquals(mapOf(DashTakenMethod.unpaid to 100.0), DashTaken.split(100.0, emptyList(), 0.0))
        assertEquals(emptyMap(), DashTaken.split(0.0, emptyList(), 0.0))
    }

    @Test fun theRangesShowTheirTailOfTheNinetyDays() {
        val ninety = DashTaken.days(entries, now, 90)
        assertEquals(90, ninety.size)
        assertEquals(7, DashTakenRange.week.shown(ninety, 3).size)
        assertEquals(3, DashTakenRange.month.shown(ninety, DashTaken.monthLength(now)).size)
        assertEquals(30, DashTakenRange.thirty.shown(ninety, 3).size)
        assertEquals(90, DashTakenRange.ninety.shown(ninety, 3).size)
        assertEquals(3, DashTaken.monthLength(now))
        assertEquals("Taken, last 7 days", DashTakenRange.week.heading)
        assertEquals("Taken this month", DashTakenRange.month.heading)
    }
}
