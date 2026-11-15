package erp.core

import erp.core.logic.Collect
import erp.core.logic.CollectAge
import erp.core.logic.CollectFilters
import erp.core.logic.CollectGroup
import erp.core.logic.CollectKind
import erp.core.logic.CollectPaid
import erp.core.logic.CollectSort
import erp.core.logic.PersonTotal
import erp.core.models.Invoice
import erp.core.models.Order
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/collect.test.ts, case for case (names made up). */
class CollectTests {
    private fun inv(o: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(
        mapOf<String, Any?>("id" to "I", "customerName" to "A", "createdAt" to "2026-11-01", "balanceDue" to 0, "grandTotal" to 100, "subtotal" to 100, "items" to emptyList<Any?>(), "paymentHistory" to emptyList<Any?>()) + o,
    )!!

    private fun ord(o: Map<String, Any?>): Order = ERPDecode.model<Order>(
        mapOf<String, Any?>("id" to "O", "customerName" to "B", "createdAt" to "2026-10-01", "status" to "Completed", "grandTotal" to 0, "subtotal" to 500, "advancePayment" to 0, "items" to emptyList<Any?>()) + o,
    )!!

    // MARK: who still owes

    private val rows = Collect.rows(
        listOf(
            inv(mapOf("id" to "I1", "balanceDue" to 3000, "takenBy" to "Mansoor")),
            inv(mapOf("id" to "I2", "balanceDue" to 0)),
            inv(mapOf("id" to "I3", "balanceDue" to 900, "status" to "Refunded")),
            inv(mapOf("id" to "I4", "balanceDue" to 7000, "takenBy" to "Murtaza", "createdAt" to "2026-09-01")),
        ),
        listOf(
            ord(mapOf("id" to "O1", "grandTotal" to 2000, "takenBy" to "Mansoor")),
            ord(mapOf("id" to "O2", "grandTotal" to 2000, "invoiceId" to "I1")),
            ord(mapOf("id" to "O3", "grandTotal" to 2000, "status" to "In Progress")),
        ),
    )

    @Test
    fun testTakesOwingInvoicesAndCompletedUninvoicedOrdersWithABalanceNothingPaidRefundedInvoicedOrUnfinished() {
        assertEquals(listOf("I1", "I4", "O1"), rows.map { it.id }.sorted())
    }

    @Test
    fun testSortsByWhoTookThemOldestFirstWithinEach() {
        assertEquals(listOf("O1", "I1", "I4"), Collect.sort(rows, CollectSort.takenBy).map { it.id })
        assertEquals("I4", Collect.sort(rows, CollectSort.amount)[0].id)
    }

    @Test
    fun testTotalsEachPerson() {
        assertEquals(listOf(PersonTotal("Murtaza", 1, 7000.0), PersonTotal("Mansoor", 2, 5000.0)), Collect.byTakenBy(rows))
    }

    @Test
    fun testNobodyRecordedSortsLastAndIsListedLast() {
        val withNobody = Collect.rows(listOf(inv(mapOf("id" to "I5", "balanceDue" to 99000)), inv(mapOf("id" to "I6", "balanceDue" to 10, "takenBy" to "Zed"))), emptyList())
        assertEquals(listOf("I6", "I5"), Collect.sort(withNobody, CollectSort.takenBy).map { it.id })
        assertEquals(listOf("Zed", ""), Collect.byTakenBy(withNobody).map { it.takenBy })
    }

    @Test
    fun testARowOpensItsBillAndKeepsTheFullAmountOfAnOrderNotItsBalance() {
        val o = Collect.rows(emptyList(), listOf(ord(mapOf("id" to "O7", "grandTotal" to 2000, "subtotal" to 3000, "advancePayment" to 1000, "discountAmount" to 200))))[0]
        assertEquals("/orders/O7", o.href)
        assertEquals(2800.0, o.total)
        assertEquals(2000.0, o.due)
        assertEquals("/invoices/I1", rows.first { it.id == "I1" }.href)
        assertEquals("Not recorded", Collect.who(""))
    }

    // MARK: several filters at once

    private val now: Instant = Instant.parse("2026-11-14T00:00:00Z")
    private val fRows = Collect.rows(
        listOf(
            inv(mapOf("id" to "I1", "balanceDue" to 3000, "grandTotal" to 5000, "subtotal" to 5000, "takenBy" to "Mansoor", "createdAt" to "2026-11-10", "customerContact" to "0300 1234567")),
            inv(mapOf("id" to "I4", "balanceDue" to 100, "grandTotal" to 100, "subtotal" to 100, "takenBy" to "Murtaza", "createdAt" to "2026-07-01")),
        ),
        listOf(
            ord(mapOf("id" to "O1", "grandTotal" to 2000, "subtotal" to 3000, "advancePayment" to 1000, "takenBy" to "Mansoor", "createdAt" to "2026-09-01", "customerName" to "Sana")),
            ord(mapOf("id" to "O9", "grandTotal" to 400, "takenBy" to "Fatema", "createdAt" to "2026-11-01")),
        ),
    )

    private fun ids(f: CollectFilters) = Collect.filter(fRows, f, now).map { it.id }

    @Test
    fun testOrsWithinAGroupAndAndsAcrossThem() {
        assertEquals(listOf("I1", "I4", "O1"), ids(CollectFilters(people = setOf("Mansoor", "Murtaza"))).sorted())
        assertEquals(listOf("I1", "I4"), ids(CollectFilters(people = setOf("Mansoor", "Murtaza"), kinds = setOf(CollectKind.invoice))).sorted())
        assertEquals(listOf("O1"), ids(CollectFilters(people = setOf("Mansoor"), ages = setOf(CollectAge.from30to90, CollectAge.over90))))
    }

    @Test
    fun testKnowsAgeNothingPaidAndASearchByNameNumberOrBill() {
        assertEquals(listOf("I4"), ids(CollectFilters(ages = setOf(CollectAge.over90))))
        assertEquals(listOf("I4"), ids(CollectFilters(paid = setOf(CollectPaid.nothing))))
        assertEquals(listOf("O1"), ids(CollectFilters(query = "sana")))
        assertEquals(listOf("I1"), ids(CollectFilters(query = "1234567")))
        assertEquals(listOf("O9"), ids(CollectFilters(query = "o9")))
    }

    @Test
    fun testCountsEachChipWithTheOtherGroupsOn() {
        val c = Collect.countBy(fRows, CollectFilters(people = setOf("Fatema"), kinds = setOf(CollectKind.invoice)), CollectGroup.people, now) { it.takenBy }
        assertEquals(1, c["Mansoor"]?.count)
        assertFalse(c.containsKey("Fatema"))
    }

    @Test
    fun testAgeEdgesAndTheFilterCount() {
        // 30 days is the 30–90 group, 90 still is, 91 is over 90 (floor of whole days).
        val day = { d: String -> Collect.ageOf(fRows[0].copy(date = d), now) }
        assertEquals(CollectAge.under30, day("2026-10-16T00:00:01Z"))
        assertEquals(CollectAge.from30to90, day("2026-10-15T00:00:00Z"))
        assertEquals(CollectAge.from30to90, day("2026-08-16T00:00:00Z"))
        assertEquals(CollectAge.over90, day("2026-08-15T00:00:00Z"))
        assertEquals(0, CollectFilters.none.on)
        assertEquals(4, CollectFilters(people = setOf("A", "B"), kinds = setOf(CollectKind.order), query = " x ").on)
        assertTrue(Collect.passes(fRows[0], CollectFilters(query = "  "), null, now))
    }
}
