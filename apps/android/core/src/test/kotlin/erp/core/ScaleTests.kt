package erp.core

import erp.core.logic.invoiceSaleValue
import erp.core.logic.owedToYou
import erp.core.logic.todaysCash
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Order
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The books at ten times their size on 8 Oct 2026 (Taheri: 4,237 hisaab rows, 1,032 customers;
 * Mina: 424 invoices, 384 expenses): decoding every document and working out what the dashboard
 * shows must stay well under a second on a phone, so a screen never waits on the rules.
 * All made up; the limits are generous (a CI box is slower than a phone).
 */
class ScaleTests {
    companion object {
        private fun docs(n: Int, make: (Int) -> Map<String, Any?>): List<Map<String, Any?>> = (0 until n).map(make)

        private val day = ERPDate.iso(Instant.now())

        private val invoiceDocs = docs(5_000) { i ->
            mapOf(
                "id" to "INV-$i", "customerId" to "c${i % 10_000}", "customerName" to "Demo ${i % 10_000}",
                "grandTotal" to 100_000 + i.toDouble(), "amountPaid" to (i % 3).toDouble() * 30_000,
                "balanceDue" to 100_000 + i.toDouble() - (i % 3).toDouble() * 30_000,
                "subtotal" to 100_000 + i.toDouble(), "discountAmount" to 0, "createdAt" to day,
                "items" to listOf(mapOf("sku" to "S$i", "name" to "Piece", "metalType" to "gold", "karat" to "21k", "metalWeightG" to 4, "unitPrice" to 100_000, "itemTotal" to 100_000)),
                "paymentHistory" to listOf(mapOf("amount" to (i % 3).toDouble() * 30_000, "date" to day, "method" to "Cash")),
                "ratesApplied" to mapOf("goldRatePerGram21k" to 30_000),
            )
        }
        private val hisaabDocs = docs(42_000) { i ->
            mapOf(
                "id" to "h$i", "entityId" to "c${i % 10_000}", "entityType" to "customer", "entityName" to "Demo",
                "date" to day, "description" to "Row", "cashDebit" to (i % 2).toDouble() * 1_000, "cashCredit" to ((i + 1) % 2).toDouble() * 400,
                "goldDebitGrams" to 0, "goldCreditGrams" to 0,
            )
        }
        private val orderDocs = docs(1_600) { i ->
            mapOf(
                "id" to "ORD-$i", "status" to listOf("Pending", "In Progress", "Completed")[i % 3], "createdAt" to day, "subtotal" to 50_000,
                "advancePayment" to 5_000, "grandTotal" to 45_000, "customerName" to "Demo",
                "items" to listOf(mapOf("description" to "Ring", "estimatedWeightG" to 4, "karat" to "21k", "metalType" to "gold", "isCompleted" to (i % 2 == 0))),
                "ratesApplied" to mapOf("goldRatePerGram21k" to 30_000),
            )
        }

        private inline fun <reified T : Any> decode(docs: List<Map<String, Any?>>): List<T> =
            docs.map { DocJSON.decode<T>(it["id"] as? String ?: "", it) }
    }

    @Test
    fun testTenTimesTheBooksDecodeAndAddUpInTime() {
        val start = System.nanoTime()
        val invoices = decode<Invoice>(invoiceDocs)
        val hisaab = decode<HisaabEntry>(hisaabDocs)
        val orders = decode<Order>(orderDocs)
        val decoded = (System.nanoTime() - start) / 1e9
        assertEquals(5_000, invoices.size)
        assertEquals(42_000, hisaab.size)
        assertEquals(1_600, orders.size)

        val rulesStart = System.nanoTime()
        val owed = owedToYou(invoices, ledgerRows = hisaab)
        val cash = todaysCash(invoices = invoices, orders = orders, repairs = emptyList(), extraRevenues = emptyList(), expenses = emptyList())
        val taken = invoices.fold(0.0) { acc, inv -> acc + invoiceSaleValue(inv) }
        val rules = (System.nanoTime() - rulesStart) / 1e9

        assertTrue(owed.total > 0)
        assertTrue(taken > 0)
        @Suppress("UNUSED_VARIABLE")
        val unused = cash
        println("[scale] decoded 48,600 documents in ${(decoded * 1000).toInt()} ms; owed, today's cash and sale value in ${(rules * 1000).toInt()} ms")
        // Generous ceilings: they catch a rule gone quadratic, not a slow machine.
        assertTrue(decoded < 20, "decoding 48,600 documents")
        assertTrue(rules < 5, "the dashboard's rules over ten times the books")
    }
}
