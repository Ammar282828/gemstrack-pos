package erp.core

import erp.core.logic.Books
import erp.core.logic.BooksInput
import erp.core.logic.BooksOptions
import erp.core.logic.Bucket
import erp.core.logic.GoldApart
import erp.core.logic.JS
import erp.core.logic.Period
import erp.core.logic.SalesDay
import erp.core.logic.silverGoldRows
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

/** src/lib/analytics/gold-apart.test.ts, case for case, and the books with gold apart (House of Mina, 10%). */
class GoldApartTests {
    private fun at(s: String): Instant = JS.parseISO(s)!!
    private val now = at("2026-11-05T12:00:00")
    private val nov = Period(at("2026-11-01T00:00:00"), at("2026-11-05T00:00:00"))

    private fun item(metal: String, total: Double): Map<String, Any?> = mapOf(
        "sku" to "X", "name" to "Piece", "categoryId" to "cat001", "metalType" to metal, "karat" to "22k", "metalWeightG" to 0, "stoneWeightG" to 0,
        "quantity" to 1, "unitPrice" to 0, "itemTotal" to total, "metalCost" to 0, "wastageCost" to 0, "wastagePercentage" to 0,
        "makingCharges" to 0, "diamondChargesIfAny" to 0, "stoneChargesIfAny" to 0, "miscChargesIfAny" to 0,
    )

    private fun invoice(id: String, date: String, items: List<Map<String, Any?>>, total: Double): Invoice = ERPDecode.model<Invoice>(
        mapOf(
            "id" to id, "customerName" to "", "items" to items, "subtotal" to total, "discountAmount" to 0, "grandTotal" to total, "amountPaid" to total,
            "balanceDue" to 0, "createdAt" to date, "ratesApplied" to emptyMap<String, Any?>(), "paymentHistory" to emptyList<Any?>(), "status" to "Paid",
        ),
    )!!

    private fun order(items: List<Map<String, Any?>>): Order = ERPDecode.model<Order>(
        mapOf(
            "id" to "O", "createdAt" to "2026-11-04T09:00:00", "status" to "Pending", "items" to items, "subtotal" to 0, "grandTotal" to 0,
            "ratesApplied" to emptyMap<String, Any?>(),
        ),
    )!!

    @Test fun splitsASaleByItsLinesAndTheAdjustmentsFallInProportion() {
        assertEquals(0.75, GoldApart.goldShare(listOf("gold" to 30000.0, "silver" to 10000.0)), 0.0)
        // Lines 30,000 gold + 10,000 silver; the sale came to 38,000 after its discount.
        val mixed = invoice("A", "2026-11-02T10:00:00", listOf(item("gold", 30000.0), item("silver", 10000.0)), 38000.0)
        assertEquals(28500.0, GoldApart.invoiceGoldPart(mixed, 38000.0), 1e-9)
        assertEquals(0.0, GoldApart.invoiceGoldPart(invoice("B", "2026-11-02T10:00:00", listOf(item("silver", 8000.0)), 8350.0), 8350.0), 0.0)
        assertEquals(0.0, GoldApart.invoiceGoldPart(invoice("C", "2026-11-02T10:00:00", emptyList(), 5000.0), 5000.0), 0.0)
        val o = order(listOf(mapOf("metalType" to "gold", "isManualPrice" to true, "manualPrice" to 20000), mapOf("metalType" to "silver", "totalEstimate" to 0)))
        assertEquals(20000.0, GoldApart.orderGoldPart(o, 20000.0), 1e-9)
    }

    @Test fun labels() {
        assertEquals("Gold revenue (est. 10% margin)", GoldApart.goldRevenueLabel(10.0))
        assertEquals("Gold revenue (est. 7.5% margin)", GoldApart.goldRevenueLabel(7.5))
    }

    @Test fun booksSplitRevenueAndProfitWhereGoldIsApart() {
        val gold = invoice("G", "2026-11-02T10:00:00", listOf(item("gold", 40000.0)), 40000.0)
        val silver = invoice("S", "2026-11-03T10:00:00", listOf(item("silver", 60000.0)), 60000.0)
        val goods = ERPDecode.model<Expense>(mapOf("id" to "E", "date" to "2026-11-01T09:00:00", "category" to "Stock & Karigars", "description" to "Stock", "amount" to 35000))!!
        val rent = ERPDecode.model<Expense>(mapOf("id" to "R", "date" to "2026-11-01T09:00:00", "category" to "Rent", "description" to "Rent", "amount" to 5000))!!
        val input = BooksInput(invoices = listOf(gold, silver), orders = emptyList(), expenses = listOf(goods, rent))
        val on = Books.compute(input, nov, BooksOptions(now = now, goods = listOf("Stock & Karigars"), goldApartMargin = 10.0))
        assertEquals(100000.0, on.totalSales, 1e-9)
        assertEquals(40000.0, on.goldRevenue, 1e-9)
        assertEquals(60000.0, on.silverRevenue, 1e-9)
        assertEquals(4000.0, on.goldProfit, 1e-9)
        // Profit is the old rule: revenue less goods (65,000), less running costs (5,000), gold or not.
        assertEquals(65000.0, on.estProfitAdj, 1e-9)
        assertEquals(60000.0, on.netProfit, 1e-9)
        assertEquals(listOf(40000.0, 0.0), on.salesOverTime.map { it.gold })

        // Off (Taheri): one revenue, the old rule, nothing apart.
        val off = Books.compute(input, nov, BooksOptions(now = now, goods = listOf("Stock & Karigars")))
        assertEquals(65000.0, off.estProfitAdj, 1e-9)
        assertEquals(0.0, off.goldProfit, 0.0)
        assertEquals(60000.0, off.netProfit, 1e-9)
    }

    @Test fun silverGoldRowsSplitEachBucket() {
        val rows = silverGoldRows(listOf(SalesDay("2026-11-02", 100.0, 1, 1.0, 40.0)), Bucket.day, null, now)
        assertEquals(listOf(40.0), rows.map { it.gold })
        assertEquals(listOf(60.0), rows.map { it.silver })
    }
}
