package erp.core

import erp.core.logic.OwedAmount
import erp.core.logic.isOwing
import erp.core.logic.ledgerBalances
import erp.core.logic.owedToYou
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** src/lib/owed.test.ts, case for case (names made up). */
class OwedTests {
    /** `inv(id, balanceDue, extra)` of the TS: the date is the id's last two digits. */
    private fun inv(id: String, balanceDue: Double, extra: Map<String, Any?> = emptyMap()): Invoice {
        val fields = mutableMapOf<String, Any?>("id" to id, "balanceDue" to balanceDue, "createdAt" to "2026-09-${id.takeLast(2)}")
        fields.putAll(extra)
        return ERPDecode.model<Invoice>(fields)!!
    }

    private fun entry(fields: Map<String, Any?>): HisaabEntry = ERPDecode.model<HisaabEntry>(fields)!!

    @Test
    fun testCountsEveryInvoiceStillOwedOnWalkInsAndTypedNamesIncludedNeverARefundOrACrumb() {
        val book = listOf(
            inv("INV-10", 50_000.0, mapOf("customerId" to "c1", "customerName" to "Sana Example")),
            inv("INV-11", 20_000.0, mapOf("customerId" to "c1", "customerName" to "Sana Example")),
            inv("INV-12", 9_000.0, mapOf("customerName" to "Walk-in Customer")),
            inv("INV-13", 4_000.0, mapOf("customerName" to "Fatima Sample (typed)")),
            inv("INV-14", 0.0, mapOf("customerId" to "c2")),
            inv("INV-15", 80_000.0, mapOf("customerId" to "c3", "status" to "Refunded")),
            inv("INV-16", 0.2, mapOf("customerId" to "c4")),
        )
        val o = owedToYou(book)
        assertEquals(83_000.0, o.total)
        assertEquals(listOf("INV-10", "INV-11", "INV-12", "INV-13"), o.invoices.map { it.id })
        assertFalse(isOwing(book[6]))
    }

    @Test
    fun testByCustomerWithWalkInsAsOneLineAndTypedNamesAsTheirOwn() {
        val book = listOf(
            inv("INV-10", 50_000.0, mapOf("customerId" to "c1", "customerName" to "Sana Example")),
            inv("INV-11", 20_000.0, mapOf("customerId" to "c1", "customerName" to "Sana Example")),
            inv("INV-12", 9_000.0, mapOf("customerName" to "Walk-in Customer")),
            inv("INV-13", 4_000.0, mapOf("customerName" to "Fatima Sample (typed)")),
        )
        val o = owedToYou(book)
        assertEquals(OwedAmount(amount = 70_000.0, count = 2), o.byKey["c1"])
        assertEquals(OwedAmount(amount = 9_000.0, count = 1), o.byKey["walk-in"])
        assertEquals(OwedAmount(amount = 4_000.0, count = 1), o.byKey["name:Fatima Sample (typed)"])
        assertEquals(9_000.0, o.walkIn)
        assertEquals(4_000.0, o.nameOnly)
    }

    // With the hisaab's hand-written balances.
    private val ledgerBook = listOf(Triple("INV-20", 30_000.0, mapOf<String, Any?>("customerId" to "c1", "customerName" to "Sana Example")))
    private val ledger: List<HisaabEntry>
        get() = listOf(
            // The old khata for Sana: 1,00,000 given, 40,000 paid.
            entry(mapOf("entityId" to "c1", "entityType" to "customer", "cashDebit" to 100_000, "cashCredit" to 0)),
            entry(mapOf("entityId" to "c1", "entityType" to "customer", "cashDebit" to 0, "cashCredit" to 40_000)),
            // INV-20's own row: the invoice already counts it.
            entry(mapOf("entityId" to "c1", "entityType" to "customer", "cashDebit" to 30_000, "cashCredit" to 0, "linkedInvoiceId" to "INV-20")),
            // A khata-only customer, and one the shop owes (an advance): that one lowers nobody's debt.
            entry(mapOf("entityId" to "c9", "entityType" to "customer", "cashDebit" to 5_000, "cashCredit" to 0)),
            entry(mapOf("entityId" to "c8", "entityType" to "customer", "cashDebit" to 0, "cashCredit" to 12_000)),
            // A settled account, and a karigar's gold: neither is owed.
            entry(mapOf("entityId" to "c7", "entityType" to "customer", "cashDebit" to 8_000, "cashCredit" to 8_000)),
            entry(mapOf("entityId" to "k1", "entityType" to "karigar", "cashDebit" to 50_000, "cashCredit" to 0)),
        )
    private val ledgerInvoices: List<Invoice>
        get() = ledgerBook.map { inv(it.first, it.second, it.third) }

    @Test
    fun testAddsEachCustomerTheLedgerSaysOwesOnceBesideTheInvoices() {
        val o = owedToYou(ledgerInvoices, currentName = null, ledgerRows = ledger)
        assertEquals(65_000.0, o.ledger)
        assertEquals(95_000.0, o.total)
        assertEquals(OwedAmount(amount = 90_000.0, count = 1), o.byKey["c1"])
        assertEquals(OwedAmount(amount = 5_000.0, count = 0), o.byKey["c9"])
        assertNull(o.byKey["c8"])
        assertNull(o.byKey["c7"])
        assertNull(o.byKey["k1"])
    }

    @Test
    fun testIsTheInvoicesAloneWhenNoLedgerIsGiven() {
        assertEquals(30_000.0, owedToYou(ledgerInvoices).total)
        assertEquals(0.0, owedToYou(ledgerInvoices).ledger)
    }

    // Not in the TS tests: the walk-in's hand-written balance joins the walk-in line, and the
    // sums are the same whatever order the ledger lists its people in.
    @Test
    fun testLedgerBalancesForTheWalkInEntityJoinTheWalkInLine() {
        val rows = listOf(entry(mapOf("entityId" to "walk-in", "entityType" to "customer", "cashDebit" to 7_000, "cashCredit" to 0)))
        val o = owedToYou(emptyList(), currentName = null, ledgerRows = rows)
        assertEquals(7_000.0, o.walkIn)
        assertEquals(7_000.0, o.total)
        assertEquals(mapOf("walk-in" to 7_000.0), ledgerBalances(rows))
    }
}
