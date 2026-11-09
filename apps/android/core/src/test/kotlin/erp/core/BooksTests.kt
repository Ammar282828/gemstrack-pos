package erp.core

import erp.core.logic.BooksInput
import erp.core.logic.BooksOptions
import erp.core.logic.Books
import erp.core.logic.Bucket
import erp.core.logic.ExpenseByCategory
import erp.core.logic.ExpenseKind
import erp.core.logic.JS
import erp.core.logic.MetalKaratRow
import erp.core.logic.Period
import erp.core.logic.SalesDay
import erp.core.logic.autoBucket
import erp.core.logic.bucketCustomerFlow
import erp.core.logic.bucketSeries
import erp.core.logic.compareSeries
import erp.core.logic.karatsOf
import erp.core.logic.monthlyRevenue
import erp.core.logic.monthlySeries
import erp.core.logic.previousPeriod
import erp.core.logic.previousRange
import erp.core.logic.yearlySummary
import erp.core.models.AdditionalRevenue
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.MetalType
import erp.core.models.Order
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/analytics/books.test.ts, case for case and value for value. Taheri's settings (the code's defaults): no goods
 * recorded, gold is the metal, 10% assumed margin. Days are Karachi's; the web test's zoneless times are read as such
 * (JS.parseISO), exactly as the app reads the books.
 */
class BooksTests {
    private fun at(s: String): Instant = JS.parseISO(s)!!
    private fun d(s: String): Instant = at("${s}T00:00:00")

    private val now = at("2026-11-05T12:00:00")
    private val nov = Period(d("2026-11-01"), d("2026-11-05"))
    private val opts = BooksOptions(now = now)

    private fun item(sku: String = "X", name: String = "Piece", categoryId: String = "cat001", karat: String? = "22k", metalType: String = "gold", weight: Double = 0.0, total: Double = 0.0): Map<String, Any?> {
        val m = mutableMapOf<String, Any?>(
            "sku" to sku, "name" to name, "categoryId" to categoryId, "metalType" to metalType, "metalWeightG" to weight, "stoneWeightG" to 0,
            "quantity" to 1, "unitPrice" to 0, "itemTotal" to total, "metalCost" to 0, "wastageCost" to 0, "wastagePercentage" to 0,
            "makingCharges" to 0, "diamondChargesIfAny" to 0, "stoneChargesIfAny" to 0, "miscChargesIfAny" to 0,
        )
        if (karat != null) m["karat"] = karat
        return m
    }

    private fun payment(id: String, date: String, amount: Double): Map<String, Any?> = mapOf("id" to id, "date" to date, "amount" to amount, "method" to "Cash")

    private fun invoice(
        id: String, createdAt: String = "2026-11-01T10:00:00", customerId: String? = null, customerName: String = "",
        items: List<Map<String, Any?>> = emptyList(), subtotal: Double = 0.0, grandTotal: Double = 0.0, amountPaid: Double = 0.0,
        balanceDue: Double = 0.0, payments: List<Map<String, Any?>> = emptyList(),
    ): Invoice {
        val m = mutableMapOf<String, Any?>(
            "id" to id, "customerName" to customerName, "items" to items, "subtotal" to subtotal, "discountAmount" to 0, "grandTotal" to grandTotal,
            "amountPaid" to amountPaid, "balanceDue" to balanceDue, "createdAt" to createdAt, "ratesApplied" to emptyMap<String, Any?>(),
            "paymentHistory" to payments, "status" to "Paid",
        )
        if (customerId != null) m["customerId"] = customerId
        return ERPDecode.model<Invoice>(m)!!
    }

    // Last month: one ring, Ayesha's first purchase, paid in full on the day.
    private val invOct = invoice(
        "INV-0", createdAt = "2026-10-03T10:00:00", customerId = "c1", customerName = "Ayesha",
        items = listOf(item("R0", "Old ring", weight = 5.0, total = 40000.0)), subtotal = 40000.0, grandTotal = 40000.0, amountPaid = 40000.0,
        payments = listOf(payment("p0", "2026-10-03T10:00:00", 40000.0)),
    )

    // A 22k ring of 10 g for 100,000, 60,000 paid, 40,000 owed.
    private val inv1 = invoice(
        "INV-1", createdAt = "2026-11-02T10:00:00", customerId = "c1", customerName = "Ayesha",
        items = listOf(item("R1", "Ring A", weight = 10.0, total = 100000.0)), subtotal = 100000.0, grandTotal = 100000.0,
        amountPaid = 60000.0, balanceDue = 40000.0, payments = listOf(payment("p1", "2026-11-02T10:00:00", 60000.0)),
    )

    // One bill for a 21k ring of 5 g (50,000) and a gold coin of 8 g (200,000): 20% jewellery, 80% coin, paid in full.
    private val inv2 = invoice(
        "INV-2", createdAt = "2026-11-03T11:00:00", customerId = "c2", customerName = "Bilal",
        items = listOf(
            item("R2", "Ring B", karat = "21k", weight = 5.0, total = 50000.0),
            item("C1", "Coin", categoryId = "cat017", karat = "24k", weight = 8.0, total = 200000.0),
        ),
        subtotal = 250000.0, grandTotal = 250000.0, amountPaid = 250000.0, payments = listOf(payment("p2", "2026-11-03T11:00:00", 250000.0)),
    )

    // An order taken on the 4th, not invoiced: 80,000 with 20,000 down.
    private val ord1: Order = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-1", "createdAt" to "2026-11-04T09:00:00", "status" to "Pending", "items" to emptyList<Any?>(), "subtotal" to 80000,
            "grandTotal" to 60000, "advancePayment" to 20000, "advanceMethod" to "Cash", "customerId" to "c1", "customerName" to "Ayesha",
            "ratesApplied" to emptyMap<String, Any?>(),
        ),
    )!!
    private val extra: AdditionalRevenue = ERPDecode.model<AdditionalRevenue>(mapOf("id" to "X1", "date" to "2026-11-04T15:00:00", "description" to "Repair", "amount" to 10000))!!
    private fun expense(id: String, date: String, category: String, description: String, amount: Double): Expense =
        ERPDecode.model<Expense>(mapOf("id" to id, "date" to date, "category" to category, "description" to description, "amount" to amount))!!
    private val rent = expense("E1", "2026-11-01T09:00:00", "Rent", "Shop rent", 30000.0)
    private val drawings = expense("E2", "2026-11-02T09:00:00", "Partner Drawings", "Draw", 15000.0)

    private val input = BooksInput(
        invoices = listOf(invOct, inv1, inv2), orders = listOf(ord1), expenses = listOf(rent, drawings), additionalRevenues = listOf(extra),
    )

    // computeBooks: the old component's figures on the fixture, worked by hand

    private val b by lazy { Books.compute(input, nov, opts) }

    @Test fun revenueTheCoinIsApartTheOrderCountsAtItsSubtotalExtraRevenueIsAdded() {
        // INV-1 100,000 + INV-2's jewellery 20% of 250,000 = 50,000; order 80,000; extra 10,000.
        assertEquals(150000.0, b.invoiceSales, 0.0)
        assertEquals(80000.0, b.orderSales, 0.0)
        assertEquals(10000.0, b.extraRevenue, 0.0)
        assertEquals(240000.0, b.totalSales, 0.0)
        val c = b.coinSummary
        assertEquals(1, c.invoices)
        assertEquals(1.0, c.coins, 0.0)
        assertEquals(8.0, c.grams, 0.0)
        assertEquals(200000.0, c.revenue, 0.0)
        assertEquals(0.0, c.outstanding, 0.0)
        assertTrue(b.hasCoins)
        // Two invoices and one order; the average is over those, not over extra revenue.
        assertEquals(3, b.totalOrders)
        assertEquals(230000.0 / 3, b.averageOrderValue, 1e-6)
        assertEquals(2.0, b.totalItemsSold, 0.0)
        assertEquals(40000.0, b.totalUnpaid, 0.0)
    }

    @Test fun profitTenPercentOnEverythingNetIsThatLessTheRunningCostsOnly() {
        assertEquals(24000.0, b.estProfit, 1e-6)
        assertEquals(3, b.salesCount)
        assertEquals(0, b.salesCosted)
        assertEquals(24000.0, b.estProfitAdj, 1e-6)
        assertEquals(216000.0, b.costOfPieces, 1e-6)
        assertEquals(30000.0, b.runningExpenses, 0.0)
        assertEquals(15000.0, b.drawingsExpenses, 0.0)
        assertEquals(0.0, b.goodsExpenses, 0.0)
        assertEquals(45000.0, b.totalExpenses, 0.0)
        assertEquals(-6000.0, b.netProfit, 1e-6)
        assertEquals(-2.5, b.netMargin, 1e-6)
        assertEquals(mapOf(ExpenseKind.running to 30000.0, ExpenseKind.goods to 0.0, ExpenseKind.drawings to 15000.0), b.expenseKinds)
        assertEquals(
            listOf(ExpenseByCategory("Rent", 30000.0, ExpenseKind.running), ExpenseByCategory("Partner Drawings", 15000.0, ExpenseKind.drawings)),
            b.expensesByCategory,
        )
    }

    @Test fun cashPaymentsOnTheDayTheOrderAdvanceExtraRevenueExpensesOut() {
        // 60,000 + the jewellery 20% of 250,000 = 110,000 on invoices; 20,000 advance; 10,000 extra.
        assertEquals(110000.0, b.cashInFromInvoicePayments, 0.0)
        assertEquals(20000.0, b.cashInFromOrderAdvances, 0.0)
        assertEquals(10000.0, b.cashInFromExtraRevenue, 0.0)
        assertEquals(140000.0, b.cashIn, 0.0)
        assertEquals(45000.0, b.cashOut, 0.0)
        assertEquals(30000.0, b.cashOutRunning, 0.0)
        assertEquals(15000.0, b.cashOutDrawings, 0.0)
        assertEquals(95000.0, b.netCashFlow, 0.0)
        // Earned 240,000, collected 140,000: 40,000 on the bill and 60,000 on the order.
        assertEquals(100000.0, b.accrualVsCashGap, 0.0)
    }

    @Test fun metalTheHousesMetalByKaratCoinsLeftOut() {
        assertEquals(15.0, b.metalGrams, 0.0)
        assertEquals(2.0, b.metalPieces, 0.0)
        assertEquals(listOf(MetalKaratRow("22k", 10.0, 1.0), MetalKaratRow("21k", 5.0, 1.0)), b.metalByKarat)
        assertEquals(0.0, Books.compute(input, nov, opts.copy(metal = MetalType.silver)).metalGrams, 0.0)
    }

    @Test fun seriesAndRankings() {
        assertEquals(
            listOf(
                SalesDay("2026-11-02", 100000.0, 1, 1.0),
                SalesDay("2026-11-03", 50000.0, 1, 1.0),
                SalesDay("2026-11-04", 90000.0, 1, 0.0),
            ),
            // `gold` (GoldApart) is the series' own; the web's test leaves it out the same way.
            b.salesOverTime.map { it.copy(gold = 0.0) },
        )
        assertEquals(listOf("R1", "R2"), b.topProductsByRevenue.map { it.sku })
        assertEquals(1, b.receivables.size)
        assertEquals("INV-1", b.receivables[0].id)
        assertEquals(40000.0, b.receivables[0].balanceDue, 0.0)
        assertEquals(0.0, b.receivables[0].coinDue, 0.0)
        assertEquals(40000.0, b.receivablesTotal, 0.0)
        assertEquals(listOf(150000.0, 80000.0, 10000.0), b.revenueMix.map { it.value })
        assertEquals(listOf("E1", "E2"), b.largestExpenses.map { it.id })
        assertFalse(b.rangeEmpty)
    }

    @Test fun byWeekdayTheAverageOverTheWeekdaysTheRangeHolds() {
        // 1-5 Nov 2026 is Sunday to Thursday, each once; the 2nd is a Monday.
        val w = b.byWeekday.associateBy { it.label }
        w.getValue("Mon").let { assertEquals(100000.0, it.revenue, 0.0); assertEquals(1, it.days); assertEquals(100000.0, it.avg, 0.0); assertEquals(1, it.count) }
        assertEquals(50000.0, w.getValue("Tue").avg, 0.0)
        assertEquals(90000.0, w.getValue("Wed").avg, 0.0)
        w.getValue("Fri").let { assertEquals(0, it.days); assertEquals(0.0, it.avg, 0.0) }
    }

    @Test fun newVsReturningFirstEverSaleInTheRangeWalkInsLeftOut() {
        // Bilal's first sale is the 3rd (new); Ayesha bought in October (returning), twice this month.
        assertEquals(1, b.newCustomers)
        assertEquals(1, b.returningCustomers)
        assertEquals(50000.0, b.revenueFromNew, 0.0)
        assertEquals(180000.0, b.revenueFromReturning, 0.0)
        val flow = bucketCustomerFlow(b.customerDays, Bucket.day, nov, now)
        flow.first { it.key == "2026-11-03" }.let { assertEquals(1, it.newCustomers); assertEquals(0, it.returningCustomers) }
        flow.first { it.key == "2026-11-02" }.let { assertEquals(0, it.newCustomers); assertEquals(1, it.returningCustomers) }
    }

    @Test fun allTimeEveryoneIsNewNothingIsDroppedAndNoRangeAtAllBehavesTheSame() {
        val all = Books.compute(input, null, opts)
        assertEquals(280000.0, all.totalSales, 0.0)
        assertEquals(0, all.returningCustomers)
        assertEquals(280000.0, Books.compute(input, Period(null, null), opts).totalSales, 0.0)
    }

    @Test fun anEmptyRangeIsFlagged() {
        val none = Books.compute(input, Period(d("2025-01-01"), d("2025-01-31")), opts)
        assertTrue(none.rangeEmpty)
        assertEquals(0.0, none.totalSales, 0.0)
    }

    @Test fun cashStillShowsMoneyCollectedOnOlderBillsInAMonthWithNoNewSale() {
        val oct = Period(d("2026-10-01"), d("2026-10-02"))
        val quiet = Books.compute(input.copy(expenses = emptyList(), additionalRevenues = emptyList()), oct, opts)
        assertEquals(0.0, quiet.totalSales, 0.0)
        val later = invoice(
            "INV-L", createdAt = "2026-11-02T10:00:00", customerId = "c1", customerName = "Ayesha",
            items = listOf(item("R1", "Ring A", weight = 10.0, total = 100000.0)), subtotal = 100000.0, grandTotal = 100000.0,
            amountPaid = 60000.0, balanceDue = 40000.0, payments = listOf(payment("pl", "2026-10-02T10:00:00", 5000.0)),
        )
        val collected = Books.compute(input.copy(invoices = listOf(later), orders = emptyList(), expenses = emptyList(), additionalRevenues = emptyList()), oct, opts)
        assertEquals(5000.0, collected.cashIn, 0.0)
    }

    // previous period

    @Test fun previousIsTheSameLengthImmediatelyBefore() {
        val p = previousRange(Period(d("2026-11-08"), d("2026-11-14")), now)!!
        assertEquals(d("2026-11-01"), p.from)
        assertEquals(at("2026-11-07T23:59:59.999"), p.to)
        assertEquals("previous 7 days", previousPeriod(Period(d("2026-11-08"), d("2026-11-14")), now)!!.label)
    }

    @Test fun previousComparesAMonthWithTheSameDaysOfTheMonthBefore() {
        val mtd = previousPeriod(Period(d("2026-11-01"), d("2026-11-05")), now)!!
        assertEquals("last month", mtd.label)
        assertEquals(d("2026-10-01"), mtd.range.from)
        assertEquals(at("2026-10-05T23:59:59.999"), mtd.range.to)
        // March has 31 days, February 28: the whole of it.
        val march = previousPeriod(Period(d("2026-03-01"), d("2026-03-31")), now)!!
        assertEquals(d("2026-02-01"), march.range.from)
        assertEquals(at("2026-02-28T23:59:59.999"), march.range.to)
    }

    @Test fun previousComparesAYearWithTheYearBefore() {
        val y = previousPeriod(Period(d("2026-01-01"), d("2026-11-05")), now)!!
        assertEquals("last year", y.label)
        assertEquals(d("2025-01-01"), y.range.from)
        assertEquals(at("2025-11-05T23:59:59.999"), y.range.to)
    }

    @Test fun previousIsNullForAllTime() {
        assertNull(previousRange(null, now))
        assertNull(previousRange(Period(null, null), now))
    }

    @Test fun lastMonthsBooksAreWhatTheOverviewComparesWith() {
        val prev = Books.compute(input, previousRange(nov, now), opts)
        assertEquals(40000.0, prev.totalSales, 0.0)
    }

    // bucketSeries

    private fun row(date: String, sales: Double) = SalesDay(date, sales, 1, 1.0)

    @Test fun weeksStartOnMonday() {
        // 2026-10-31 is a Saturday, 11-01 a Sunday, 11-02 a Monday, 11-08 a Sunday, 11-09 a Monday.
        val rows = bucketSeries(listOf(row("2026-10-31", 1.0), row("2026-11-01", 2.0), row("2026-11-02", 4.0), row("2026-11-08", 8.0), row("2026-11-09", 16.0)), Bucket.week)
        assertEquals(listOf("2026-10-26" to 3.0, "2026-11-02" to 12.0, "2026-11-09" to 16.0), rows.map { it.key to it.sales })
        assertEquals("Week of Nov 2", rows[1].tip)
    }

    @Test fun keepsQuietBucketsAsZerosAndWidensToTheRange() {
        val days = bucketSeries(listOf(row("2026-11-02", 5.0), row("2026-11-05", 7.0)), Bucket.day)
        assertEquals(listOf(5.0, 0.0, 0.0, 7.0), days.map { it.sales })
        val ranged = bucketSeries(listOf(row("2026-11-03", 5.0)), Bucket.day, nov)
        assertEquals(listOf("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"), ranged.map { it.key })
        assertEquals("Nov 1", ranged[0].label)
        assertEquals("Tue, Nov 3", ranged[2].tip)
    }

    @Test fun months() {
        val rows = bucketSeries(listOf(row("2026-09-30", 1.0), row("2026-11-01", 2.0), row("2026-11-20", 3.0)), Bucket.month)
        assertEquals(listOf("2026-09-01" to 1.0, "2026-10-01" to 0.0, "2026-11-01" to 5.0), rows.map { it.key to it.sales })
        assertEquals("Nov 26", rows[2].label)
        assertEquals("November 2026", rows[2].tip)
    }

    @Test fun thePreviousPeriodLinesUpBucketForBucket() {
        val cur = bucketSeries(listOf(row("2026-11-02", 5.0)), Bucket.day, nov)
        val prev = bucketSeries(listOf(row("2026-10-03", 3.0)), Bucket.day, previousRange(nov, now), now)
        val both = compareSeries(cur, prev)
        assertEquals(5, both.size)
        assertEquals(0.0, both[0].prev!!, 0.0)
        assertEquals(3.0, both[2].prev!!, 0.0)
        assertEquals(0.0, both[2].value, 0.0)
    }

    @Test fun autoBucketDaysUpTo45WeeksUpTo200ElseMonths() {
        fun r(days: Long) = Period(d("2026-01-01"), java.time.LocalDate.of(2026, 1, 1).plusDays(days - 1).atStartOfDay(ERPDate.karachi).toInstant())
        assertEquals(Bucket.day, autoBucket(r(45), now))
        assertEquals(Bucket.week, autoBucket(r(46), now))
        assertEquals(Bucket.week, autoBucket(Period(d("2026-01-01"), d("2026-07-19")), now))
        assertEquals(Bucket.month, autoBucket(Period(d("2026-01-01"), d("2026-07-20")), now))
        assertEquals(Bucket.month, autoBucket(null, now))
    }

    // month by month

    @Test fun eachMonthIsTheBooksOfThatMonth() {
        val rows = monthlySeries(input, 2, opts)
        assertEquals(listOf("2026-10", "2026-11"), rows.map { it.key })
        val (oct, novRow) = rows
        assertEquals(40000.0, oct.revenue, 0.0)
        assertEquals(4000.0, oct.estProfit, 1e-6)
        assertEquals(0.0, oct.running, 0.0)
        assertEquals(4000.0, oct.net, 1e-6)
        assertEquals(40000.0, oct.cashIn, 0.0)
        assertEquals(0.0, oct.cashOut, 0.0)
        assertEquals(5.0, oct.metalGrams, 0.0)
        assertEquals(240000.0, novRow.revenue, 0.0)
        assertEquals(30000.0, novRow.running, 0.0)
        assertEquals(15000.0, novRow.drawings, 0.0)
        assertEquals(140000.0, novRow.cashIn, 0.0)
        assertEquals(45000.0, novRow.cashOut, 0.0)
        assertEquals(15.0, novRow.metalGrams, 0.0)
        assertEquals(200000.0, novRow.coinRevenue, 0.0)
        assertEquals(1.0, novRow.coinCount, 0.0)
        assertEquals(-6000.0, novRow.net, 1e-6)
        assertEquals(mapOf("22k" to 10.0, "21k" to 5.0), novRow.metalByKarat)
        assertEquals(listOf("22k", "21k"), karatsOf(rows))
    }

    @Test fun allStartsAtTheFirstRecordAndKeepsQuietMonths() {
        assertEquals(listOf("2026-10", "2026-11"), monthlySeries(input, null, opts).map { it.key })
        assertEquals(emptyList(), monthlySeries(BooksInput(emptyList(), emptyList()), null, opts))
        assertEquals(listOf("2026-09", "2026-10", "2026-11"), monthlySeries(input, 3, opts).map { it.key })
    }

    @Test fun monthlyRevenueAndYearlySummaryKeepTheOldArithmetic() {
        val m = monthlyRevenue(input, opts)
        assertEquals(listOf("2026-10", "2026-11"), m.data.map { it.key })
        assertEquals(listOf("Oct 26", "Nov 26"), m.data.map { it.month })
        assertEquals(listOf(40000.0, 240000.0), m.data.map { it.revenue })
        assertEquals(listOf(1, 4), m.data.map { it.sales })
        assertEquals(140000.0, m.average, 0.0)
        assertEquals("2026-11", m.best)
        // Drawings are not a cost of earning the profit: only the 30,000 of rent comes off.
        val y = yearlySummary(input, opts).first()
        assertEquals(2026, y.year)
        assertEquals(280000.0, y.revenue, 0.0)
        assertEquals(30000.0, y.expenses, 0.0)
        assertEquals(40000.0, y.unpaid, 0.0)
        assertEquals(28000.0, y.profit, 1e-6)
        assertEquals(-2000.0, y.netProfit, 1e-6)
    }

    // a house that records its goods (Mina) and sells silver

    @Test fun minaTakesProfitAsRevenueLessGoodsCountsSilverWeight() {
        val mina = opts.copy(metal = MetalType.silver, goods = listOf("Stock & Karigars", "Custom Orders"))
        val silverRing = invoice(
            "INV-1", createdAt = "2026-11-02T10:00:00", customerId = "c1", customerName = "Ayesha",
            items = listOf(item("S1", metalType = "silver", karat = null, weight = 12.0, total = 100000.0)), subtotal = 100000.0, grandTotal = 100000.0,
            amountPaid = 60000.0, balanceDue = 40000.0, payments = listOf(payment("p1", "2026-11-02T10:00:00", 60000.0)),
        )
        val goods = expense("E3", "2026-11-02T09:00:00", "Stock & Karigars", "Stock", 60000.0)
        val r = Books.compute(input.copy(invoices = listOf(silverRing), expenses = listOf(rent, goods)), nov, mina)
        // Revenue 100,000 + 80,000 + 10,000 = 190,000, less 60,000 of goods = 130,000; less 30,000 rent = 100,000.
        assertEquals(190000.0, r.totalSales, 0.0)
        assertEquals(60000.0, r.goodsExpenses, 0.0)
        assertEquals(130000.0, r.estProfitAdj, 0.0)
        assertEquals(100000.0, r.netProfit, 0.0)
        assertEquals(mapOf(ExpenseKind.running to 30000.0, ExpenseKind.goods to 60000.0, ExpenseKind.drawings to 0.0), r.expenseKinds)
        assertEquals(12.0, r.metalGrams, 0.0)
        assertEquals(listOf(MetalKaratRow("unknown", 12.0, 1.0)), r.metalByKarat)
        assertNotNull(r.sourceBreakdown)
    }
}
