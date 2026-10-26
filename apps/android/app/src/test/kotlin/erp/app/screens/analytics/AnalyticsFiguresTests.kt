package erp.app.screens.analytics

import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.logic.NetProfit
import erp.core.logic.invoiceSaleValue
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Product
import erp.app.ui.AppClock
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Analytics figures (AnalyticsFigures.swift, AnalyticsRules.swift, AnalyticsCoins.swift) on made-up books. */
class AnalyticsFiguresTests {
    // Monday 12 October 2026, 13:00 in Karachi.
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    private fun item(sku: String, total: Double, category: String = "Ring", grams: Double = 4.0, karat: String = "21k", quantity: Double = 1.0, metal: String = "gold") =
        mapOf("sku" to sku, "name" to "Made up $sku", "categoryId" to category, "metalType" to metal, "karat" to karat,
            "metalWeightG" to grams, "quantity" to quantity, "itemTotal" to total)

    private fun invoice(
        id: String, day: String, items: List<Map<String, Any?>>, paid: Double? = null, discount: Double = 0.0,
        exchange: Double = 0.0, extra: Map<String, Any?> = emptyMap(),
    ): Invoice {
        val subtotal = items.sumOf { it["itemTotal"] as Double }
        val grand = subtotal - discount - exchange
        val amountPaid = paid ?: grand
        val doc = mutableMapOf<String, Any?>(
            "id" to id, "customerName" to "Made Up Buyer", "items" to items, "subtotal" to subtotal, "discountAmount" to discount,
            "exchanges" to if (exchange > 0) listOf(mapOf("description" to "Old ring", "value" to exchange)) else emptyList<Any>(),
            "grandTotal" to grand, "amountPaid" to amountPaid, "balanceDue" to grand - amountPaid,
            "createdAt" to "${day}T07:00:00.000Z",
            "paymentHistory" to if (amountPaid > 0) listOf(mapOf("amount" to amountPaid, "date" to "${day}T07:00:00.000Z", "method" to "Cash")) else emptyList<Any>(),
        )
        doc.putAll(extra)
        return Invoice.fromMap(doc)
    }

    private fun order(id: String, day: String, subtotal: Double, status: String = "Pending", extra: Map<String, Any?> = emptyMap()) =
        Order.fromMap(mapOf("id" to id, "createdAt" to "${day}T07:00:00.000Z", "status" to status, "subtotal" to subtotal, "grandTotal" to subtotal, "customerName" to "Made Up Buyer") + extra)

    private fun expense(id: String, day: String, amount: Double, category: String = "Shop", extra: Map<String, Any?> = emptyMap()) =
        Expense.fromMap(mapOf("id" to id, "date" to "${day}T07:00:00.000Z", "category" to category, "description" to "Made up", "amount" to amount) + extra)

    private fun extraRevenue(id: String, day: String, amount: Double) =
        AdditionalRevenue.fromMap(mapOf("id" to id, "date" to "${day}T07:00:00.000Z", "description" to "Made up", "amount" to amount))

    private fun books(
        invoices: List<Invoice> = emptyList(), orders: List<Order> = emptyList(), expenses: List<Expense> = emptyList(),
        extra: List<AdditionalRevenue> = emptyList(), customers: List<Customer> = emptyList(), products: List<Product> = emptyList(),
    ) = AnaBooks(invoices, orders, products, customers, expenses, extra)

    @Before fun pin() { AppClock.pinned = now }

    @After fun unpin() { AppClock.pinned = null }

    private val thisMonth = AnaPeriod.rangeFor("this-month", now, null, null)

    // MARK: The period

    @Test fun everyScreenOpensOnThisMonthTheFirstToToday() {
        assertEquals("this-month", AnaPeriod.defaultKey)
        assertEquals("this-month", AnaPeriod.quick.first().key)
        val r = thisMonth!!
        assertEquals("2026-10-01", AnaDate.dayKey(r.from))
        assertEquals("2026-10-12", AnaDate.dayKey(r.to))
        assertEquals("1 Oct 2026 to 12 Oct 2026", AnaPeriod.describe(r))
        // The first of the month is the whole period on the 1st: a one-day range reads as one day.
        val first = AnaPeriod.rangeFor("this-month", Instant.parse("2026-10-01T03:00:00Z"), null, null)!!
        assertEquals("1 Oct 2026", AnaPeriod.describe(first))
    }

    @Test fun karachisMidnightDecidesTheMonth() {
        // 19:30 UTC on 30 Sept is 00:30 on 1 Oct in Karachi.
        val r = AnaPeriod.rangeFor("this-month", Instant.parse("2026-09-30T19:30:00Z"), null, null)!!
        assertEquals("2026-10-01", AnaDate.dayKey(r.from))
    }

    @Test fun theOtherQuickPeriodsAndTheYears() {
        assertEquals("2026-09-13", AnaDate.dayKey(AnaPeriod.rangeFor("last-30", now, null, null)!!.from))
        assertEquals("2026-07-15", AnaDate.dayKey(AnaPeriod.rangeFor("last-90", now, null, null)!!.from))
        assertEquals("2026-01-01", AnaDate.dayKey(AnaPeriod.rangeFor("this-year", now, null, null)!!.from))
        val last = AnaPeriod.rangeFor("last-year", now, null, null)!!
        assertEquals("2025-01-01", AnaDate.dayKey(last.from))
        assertEquals("2025-12-31", AnaDate.dayKey(last.to))
        assertNull(AnaPeriod.rangeFor("all-time", now, null, null))
        assertEquals(2024, AnaPeriod.year("year-2024"))
        assertNull(AnaPeriod.year("year-24"))
        assertNull(AnaPeriod.year("year-20x4"))
        assertEquals("2024-12-31", AnaDate.dayKey(AnaPeriod.rangeFor("year-2024", now, null, null)!!.to))
    }

    @Test fun aCustomPeriodNeedsADayAndAnEndDefaultsToIt() {
        val r = AnaPeriod.rangeFor("custom", now, "2026-09-01", "2026-09-05")!!
        assertEquals("2026-09-01", AnaDate.dayKey(r.from))
        assertEquals("2026-09-05", AnaDate.dayKey(r.to))
        val one = AnaPeriod.rangeFor("custom", now, "2026-09-01", null)!!
        assertEquals("2026-09-01", AnaDate.dayKey(one.to))
        assertEquals("custom", AnaPeriod.read("custom", "2026-09-01", "2026-09-05", now).key)
    }

    @Test fun aBrokenKeyFallsBackToThisMonth() {
        assertEquals("this-month", AnaPeriod.read("", null, null, now).key)
        assertEquals("this-month", AnaPeriod.read("forever", null, null, now).key)
        assertEquals("this-month", AnaPeriod.read("custom", "nonsense", null, now).key)
        assertEquals("this-month", AnaPeriod.read("custom", null, null, now).key)
        assertEquals("last-90", AnaPeriod.read("last-90", null, null, now).key)
        assertEquals("year-2025", AnaPeriod.read("year-2025", null, null, now).key)
    }

    @Test fun aRangeIncludesBothEnds() {
        val r = thisMonth!!
        assertTrue(r.contains(r.from))
        assertTrue(r.contains(r.to))
        assertFalse(r.contains(r.from.minusMillis(1)))
        assertFalse(r.contains(r.to.plusMillis(1)))
    }

    @Test fun monthsRollOverTheYear() {
        assertEquals("2027-01", AnaDate.nextMonth("2026-12"))
        assertEquals("2026-11", AnaDate.nextMonth("2026-10"))
        assertEquals("Oct 26", AnaDate.monthShort("2026-10"))
        assertEquals("October 2026", AnaDate.monthLong(AnaDate.parseISO("2026-10-12")!!))
    }

    @Test fun theMonthlyPdfChoicesAreTheLastTwoYearsAndTheServersAddress() {
        val choices = monthChoices()
        assertEquals(24, choices.size)
        assertEquals("2026-10", choices[0].key)
        assertEquals("October 2026", choices[0].label)
        assertEquals("2024-11", choices[23].key)
        assertEquals(24, choices.map { it.key }.distinct().size)
        assertEquals("/api/reports/monthly?month=2025-12", monthlyPath("2025-12"))
    }

    // MARK: Revenue

    @Test fun anExchangeCountsAsCashInTheSaleValue() {
        // The bill is 300,000 less a 50,000 trade-in: 250,000 to pay, but the sale is worth the full 300,000.
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 300000.0)), exchange = 50000.0)
        assertEquals(250000.0, inv.grandTotal, 0.0)
        assertEquals(300000.0, invoiceSaleValue(inv), 0.0)
        val f = AnaFigures.of(books(invoices = listOf(inv)), thisMonth, null)
        assertEquals(300000.0, f.totalSales, 0.0)
        assertEquals(300000.0, f.invoiceSales, 0.0)
        assertEquals("PKR 3 lac", Money.pkrLac(f.totalSales, 2))
    }

    @Test fun revenueIsInvoicesPlusOrdersPlusExtraAndTheCountsFollow() {
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 100000.0, quantity = 2.0), item("B", 50000.0)), paid = 100000.0, discount = 10000.0)
        val ord = order("O1", "2026-10-06", 40000.0)
        val f = AnaFigures.of(books(invoices = listOf(inv), orders = listOf(ord), extra = listOf(extraRevenue("R1", "2026-10-07", 2500.0))), thisMonth, null)
        assertEquals(140000.0 + 40000.0 + 2500.0, f.totalSales, 0.0)
        assertEquals(140000.0, f.invoiceSales, 0.0)
        assertEquals(40000.0, f.orderSales, 0.0)
        assertEquals(2500.0, f.extraRevenue, 0.0)
        assertEquals(2, f.totalOrders)
        assertEquals((140000.0 + 40000.0) / 2, f.averageOrderValue, 0.0)
        assertEquals(3.0, f.totalItemsSold, 0.0)
        assertEquals(1.5, f.averageItemsPerOrder, 0.0)
        assertEquals(10000.0, f.totalDiscounts, 0.0)
        assertEquals(40000.0, f.totalUnpaid, 0.0)
        assertEquals(1, f.invoicesInRange)
        assertEquals(1, f.ordersInRange)
    }

    @Test fun refundedCancelledInvoicedAndOnlineWaitingSalesAreNotCounted() {
        val refunded = invoice("I9", "2026-10-05", listOf(item("A", 90000.0)), extra = mapOf("status" to "Refunded"))
        val cancelled = order("O2", "2026-10-06", 70000.0, status = "Cancelled")
        val invoiced = order("O3", "2026-10-06", 60000.0, extra = mapOf("invoiceId" to "I1"))
        val f = AnaFigures.of(books(invoices = listOf(refunded), orders = listOf(cancelled, invoiced)), thisMonth, null)
        assertEquals(0.0, f.totalSales, 0.0)
        assertEquals(0, f.invoicesInRange)
        assertEquals(0, f.ordersInRange)
    }

    @Test fun anInvoiceCountsOnItsOrdersDayNotItsOwn() {
        // Made on 5 Oct for an order placed in September: the sale belongs to September (getInvoiceRevenueDate).
        val ord = order("O1", "2026-09-20", 100000.0, status = "Completed", extra = mapOf("invoiceId" to "I1"))
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 100000.0)), extra = mapOf("sourceOrderId" to "O1"))
        val inMonth = AnaFigures.of(books(invoices = listOf(inv), orders = listOf(ord)), thisMonth, null)
        assertEquals(0.0, inMonth.totalSales, 0.0)
        val september = AnaPeriod.rangeFor("custom", now, "2026-09-01", "2026-09-30")
        assertEquals(100000.0, AnaFigures.of(books(invoices = listOf(inv), orders = listOf(ord)), september, null).totalSales, 0.0)
    }

    @Test fun allTimeCountsEverythingAndARangeDropsTheRest() {
        val old = invoice("I1", "2025-03-01", listOf(item("A", 10000.0)))
        val new = invoice("I2", "2026-10-02", listOf(item("B", 20000.0)))
        val b = books(invoices = listOf(old, new))
        assertEquals(30000.0, AnaFigures.of(b, null, null).totalSales, 0.0)
        assertEquals(20000.0, AnaFigures.of(b, thisMonth, null).totalSales, 0.0)
    }

    @Test fun salesOverTimeIsOneRowPerKarachiDayInOrder() {
        val a = invoice("I1", "2026-10-05", listOf(item("A", 10000.0)))
        val b = invoice("I2", "2026-10-05", listOf(item("B", 5000.0)))
        val c = invoice("I3", "2026-10-02", listOf(item("C", 7000.0)))
        val f = AnaFigures.of(books(invoices = listOf(a, b, c)), thisMonth, null)
        assertEquals(listOf("2026-10-02", "2026-10-05"), f.salesOverTime.map { it.date })
        assertEquals(15000.0, f.salesOverTime[1].sales, 0.0)
        assertEquals(2, f.salesOverTime[1].orders)
        assertEquals(2, f.invoicesByDay["2026-10-05"]?.size)
    }

    // MARK: Margin (decisions.md "Margin")

    @Test fun profitIsEachSalesOwnMarginAndOnlyForOwners() {
        val noRate = invoice("I1", "2026-10-05", listOf(item("A", 100000.0)))
        val f = AnaFigures.of(books(invoices = listOf(noRate), orders = listOf(order("O1", "2026-10-06", 50000.0))), thisMonth, MarginSettings.taheri)
        // No typed 24k rate on either: both at the house's 10%.
        assertEquals(15000.0, f.estProfit, 1e-6)
        assertEquals(0, f.salesCosted)
        assertEquals(2, f.salesCount)
        val notOwner = AnaFigures.of(books(invoices = listOf(noRate)), thisMonth, null)
        assertEquals(0.0, notOwner.estProfit, 0.0)
        assertEquals(0, notOwner.salesCosted)
        // Mina is not costed by gold: its own 40%.
        assertEquals(40000.0, AnaFigures.of(books(invoices = listOf(noRate)), thisMonth, MarginSettings.mina).estProfit, 1e-6)
    }

    @Test fun extraRevenueEarnsTheAssumedMarginToo() {
        val f = AnaFigures.of(books(extra = listOf(extraRevenue("R1", "2026-10-07", 10000.0))), thisMonth, MarginSettings.taheri)
        assertEquals(1000.0, f.estProfit, 1e-6)
        assertEquals(10000.0, f.totalSales, 0.0)
    }

    // MARK: Expenses and cash

    @Test fun expensesTotalEveryOneAndChartTheCategorised() {
        val f = AnaFigures.of(books(expenses = listOf(
            expense("E1", "2026-10-03", 1800.0), expense("E2", "2026-10-04", 5000.0, "Rent"), expense("E3", "2026-10-05", 700.0),
            expense("E4", "2026-10-06", 900.0, ""), expense("E5", "2025-01-01", 99999.0),
        )), thisMonth, null)
        assertEquals(1800.0 + 5000.0 + 700.0 + 900.0, f.totalExpenses, 0.0)
        assertEquals(listOf("Rent", "Shop"), f.expensesByCategory.map { it.category })
        assertEquals(2500.0, f.expensesByCategory[1].amount, 0.0)
        assertEquals(-f.totalExpenses, f.netCashFlow, 0.0)
    }

    @Test fun cashInIsPaymentsOnTheirOwnDayAndNetIsCashInLessExpenses() {
        // Paid in September, billed in October: the payment is September's cash.
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 100000.0)), paid = 0.0, extra = mapOf(
            "paymentHistory" to listOf(
                mapOf("amount" to 30000.0, "date" to "2026-09-28T07:00:00.000Z", "method" to "Cash"),
                mapOf("amount" to 20000.0, "date" to "2026-10-08T07:00:00.000Z", "method" to "Cash"),
            ), "amountPaid" to 50000.0, "balanceDue" to 50000.0))
        val f = AnaFigures.of(books(invoices = listOf(inv), expenses = listOf(expense("E1", "2026-10-09", 5000.0))), thisMonth, null)
        assertNotNull(f.cash)
        assertEquals(20000.0, f.cashIn, 0.0)
        assertEquals(15000.0, f.netCashFlow, 0.0)
        assertEquals(listOf("Invoice payments" to 20000.0), cashInParts(f))
    }

    @Test fun anExchangeIsCashInAndTheGapLeavesItOut() {
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 300000.0)), exchange = 50000.0)
        val f = AnaFigures.of(books(invoices = listOf(inv)), thisMonth, null)
        // Paid 250,000 across the counter and 50,000 of old gold: 300,000 in, 300,000 earned.
        assertEquals(300000.0, f.cashIn, 0.0)
        assertEquals(50000.0, f.exchangeOffInvoices, 0.0)
        val parts = cashInParts(f).toMap()
        assertEquals(250000.0, parts["Invoice payments"])
        assertEquals(50000.0, parts["Exchange"])
    }

    @Test fun nothingAtAllInThePeriodLeavesTheFiguresEmpty() {
        val f = AnaFigures.of(books(invoices = listOf(invoice("I1", "2025-01-01", listOf(item("A", 1000.0))))), thisMonth, MarginSettings.taheri)
        assertEquals(0, f.invoicesInRange)
        assertEquals(0, f.ordersInRange)
        assertNull(f.cash)
        assertEquals(0.0, f.cashIn, 0.0)
        assertEquals(listOf("Invoice payments" to 0.0), cashInParts(f))
    }

    // MARK: Gold, by weight, and the coins

    @Test fun goldIsWeighedByKaratHeaviestFirstAndCoinsAreNotInIt() {
        val inv = invoice("I1", "2026-10-05", listOf(
            item("A", 10000.0, grams = 5.0, karat = "21k", quantity = 2.0),
            item("B", 10000.0, grams = 12.0, karat = "22k"),
            item("C", 10000.0, grams = 0.0, karat = "18k"),
            item("D", 10000.0, grams = 9.0, karat = "silver", metal = "silver"),
        ))
        val coin = invoice("I2", "2026-10-06", listOf(item("COIN", 400000.0, category = AnaCoins.goldCoinCategory, grams = 11.664, karat = "22k")))
        val f = AnaFigures.of(books(invoices = listOf(inv, coin)), thisMonth, null)
        assertEquals(22.0, f.goldGrams, 1e-9)
        assertEquals(3.0, f.goldPieces, 0.0)
        assertEquals(listOf("21k" to 10.0, "22k" to 12.0).sortedByDescending { it.second }.map { it.first }, f.goldByKarat.map { it.karat })
        // The coin bill is its own card, not in revenue.
        assertEquals(40000.0, f.totalSales, 0.0)
        assertEquals(1, f.coinInvoiceCount)
        assertEquals(1, f.coin.invoices)
        assertEquals(400000.0, f.coin.revenue, 0.0)
        assertEquals(400000.0 / 11.664, f.coin.ratePerGram, 1e-6)
    }

    @Test fun aBillWithACoinAndARingIsSplitByLineTotals() {
        val inv = invoice("I1", "2026-10-05", listOf(
            item("COIN", 300000.0, category = AnaCoins.goldCoinCategory, grams = 11.0), item("RING", 100000.0),
        ), paid = 200000.0, discount = 40000.0)
        // Totals: 400,000 less 40,000 discount = 360,000 to pay; the coin is three quarters of the lines.
        val (jewellery, coins) = AnaCoins.splitAll(listOf(inv))
        assertEquals(1, jewellery.size)
        assertEquals(1, coins.size)
        assertEquals(listOf("RING"), jewellery[0].items.map { it.sku })
        assertEquals(listOf("COIN"), coins[0].items.map { it.sku })
        assertEquals(90000.0, jewellery[0].grandTotal, 0.0)
        assertEquals(270000.0, coins[0].grandTotal, 0.0)
        assertEquals(10000.0, jewellery[0].discountAmount, 0.0)
        assertEquals(30000.0, coins[0].discountAmount, 0.0)
        assertEquals(50000.0, jewellery[0].amountPaid, 0.0)
        assertEquals(150000.0, coins[0].amountPaid, 0.0)
        assertEquals(40000.0, jewellery[0].balanceDue, 0.0)
        // The two halves add back to the document.
        assertEquals(inv.grandTotal, jewellery[0].grandTotal + coins[0].grandTotal, 0.0)
    }

    @Test fun aWholeCoinBillOrAWholeRingBillGoesToOneSide() {
        val coinsOnly = invoice("I1", "2026-10-05", listOf(item("COIN", 1000.0, category = AnaCoins.goldCoinCategory)))
        val ringsOnly = invoice("I2", "2026-10-05", listOf(item("RING", 1000.0)))
        val s1 = AnaCoins.split(coinsOnly)
        assertNull(s1.jewellery)
        assertNotNull(s1.coins)
        val s2 = AnaCoins.split(ringsOnly)
        assertNotNull(s2.jewellery)
        assertNull(s2.coins)
    }

    @Test fun linesWithNoMoneyAreSharedByHeadcount() {
        val inv = invoice("I1", "2026-10-05", listOf(item("COIN", 0.0, category = AnaCoins.goldCoinCategory), item("RING", 0.0), item("R2", 0.0), item("R3", 0.0)))
        val s = AnaCoins.split(inv)
        assertNotNull(s.jewellery)
        assertNotNull(s.coins)
        assertEquals(3, s.jewellery.items.size)
    }

    @Test fun theCoinCardLeavesOutRefundsAndCountsWeightPerCoin() {
        val a = invoice("I1", "2026-10-05", listOf(item("COIN", 200000.0, category = AnaCoins.goldCoinCategory, grams = 5.0, quantity = 2.0)), paid = 100000.0)
        val b = invoice("I2", "2026-10-06", listOf(item("COIN", 90000.0, category = AnaCoins.goldCoinCategory, grams = 2.0)), extra = mapOf("status" to "Refunded"))
        val s = AnaCoins.summarise(listOf(a, b))
        assertEquals(1, s.invoices)
        assertEquals(2.0, s.coins, 0.0)
        assertEquals(10.0, s.grams, 0.0)
        assertEquals(20000.0, s.ratePerGram, 0.0)
        assertEquals(100000.0, s.outstanding, 0.0)
        assertEquals(0.0, AnaCoins.summarise(emptyList()).ratePerGram, 0.0)
    }

    // MARK: Who, what, where from

    @Test fun customersAreKeyedByAccountThenStoredNameThenTheOneWalkIn() {
        val saved = Customer.fromMap(mapOf("id" to "CUST-1", "name" to "Renamed Since", "source" to "social_media", "createdAt" to "2026-01-01T00:00:00.000Z"))
        val linked = invoice("I1", "2026-10-05", listOf(item("A", 60000.0)), extra = mapOf("customerId" to "CUST-1", "customerName" to "Old Name"))
        val named = invoice("I2", "2026-10-06", listOf(item("B", 20000.0)), extra = mapOf("customerName" to "Walk In Person"))
        val anon = invoice("I3", "2026-10-07", listOf(item("C", 5000.0)), extra = mapOf("customerName" to ""))
        val f = AnaFigures.of(books(invoices = listOf(linked, named, anon), customers = listOf(saved)), thisMonth, null)
        assertEquals(3, f.topCustomers.size)
        assertEquals("Renamed Since", f.topCustomers[0].name)
        assertEquals("CUST-1", f.topCustomers[0].customerId)
        assertEquals("Walk In Person", f.topCustomers[1].name)
        assertNull(f.topCustomers[1].customerId)
        assertNull(f.topCustomers[2].customerId)
        assertEquals("/customers/CUST-1", AnaPath.customer("CUST-1"))
        assertEquals("/customers/a%2Fb%20c", AnaPath.customer("a/b c"))
    }

    @Test fun aSalesSourceIsItsOwnThenTheCustomersThenUnclassifiedAndTheRealOnesLead() {
        val saved = Customer.fromMap(mapOf("id" to "CUST-1", "name" to "Buyer", "source" to "social_media", "createdAt" to "2026-01-01T00:00:00.000Z"))
        val own = invoice("I1", "2026-10-05", listOf(item("A", 10000.0)), extra = mapOf("acquisitionSource" to "walkin", "customerId" to "CUST-1"))
        val theirs = invoice("I2", "2026-10-05", listOf(item("B", 20000.0)), extra = mapOf("customerId" to "CUST-1"))
        val none = invoice("I3", "2026-10-06", listOf(item("C", 90000.0)))
        val f = AnaFigures.of(books(invoices = listOf(own, theirs, none), customers = listOf(saved)), thisMonth, null)
        assertEquals(setOf("walkin", "social_media", AnaSources.unclassified), f.sourceBreakdown.map { it.key }.toSet())
        assertEquals(AnaSources.unclassified, f.sourceBreakdown.first().key)
        assertEquals("Unclassified", AnaSources.label(AnaSources.unclassified))
        assertEquals(AnaSources.unclassified, AnaSources.keys.last())
        // A line per source per day, a missing one 0, so a line stays continuous.
        assertEquals(f.sourceBreakdown.size * 2, f.sourceTrend.size)
        assertEquals(0.0, f.sourceTrend.first { it.date == "2026-10-06" && it.label == AnaSources.label("social_media") }.amount, 0.0)
    }

    @Test fun topProductsAndCategoriesAreRankedAndProductsKeepTenAtMost() {
        val items = (1..12).map { item("SKU-$it", it * 1000.0, category = if (it % 2 == 0) "Ring" else "") }
        val inv = invoice("I1", "2026-10-05", items)
        val f = AnaFigures.of(books(invoices = listOf(inv)), thisMonth, null)
        assertEquals(10, f.topProducts.size)
        assertEquals("SKU-12", f.topProducts.first().sku)
        // A piece with no category does not make the category chart.
        assertEquals(1, f.salesByCategory.size)
        assertEquals("Ring", f.salesByCategory[0].categoryId)
        // A name from the shelf wins over the bill's.
        val prod = Product.fromMap(mapOf("sku" to "SKU-12", "name" to "Shelf Name", "categoryId" to "Ring"))
        val g = AnaFigures.of(books(invoices = listOf(inv), products = listOf(prod)), thisMonth, null)
        assertEquals("Shelf Name", g.topProducts.first().name)
        assertEquals("Made up SKU-11", g.topProducts[1].name)
    }

    @Test fun equalRevenueKeepsFirstSeenOrder() {
        val inv = invoice("I1", "2026-10-05", listOf(item("B", 100.0), item("A", 100.0), item("C", 100.0)))
        val f = AnaFigures.of(books(invoices = listOf(inv)), thisMonth, null)
        assertEquals(listOf("B", "A", "C"), f.topProducts.map { it.sku })
    }

    // MARK: The detail tabs

    @Test fun theBreakdownTabsCountOnTheBillsOwnDayCoinsIncludedAndBeforeDiscounts() {
        val ord = order("O1", "2026-09-20", 100000.0, status = "Completed", extra = mapOf("invoiceId" to "I1"))
        val ring = invoice("I1", "2026-10-05", listOf(item("RING", 100000.0)), discount = 10000.0, extra = mapOf("sourceOrderId" to "O1"))
        val coin = invoice("I2", "2026-10-06", listOf(item("COIN", 50000.0, category = AnaCoins.goldCoinCategory, quantity = 2.0)))
        val refunded = invoice("I3", "2026-10-06", listOf(item("RING", 7000.0)), extra = mapOf("status" to "Refunded"))
        val b = books(invoices = listOf(ring, coin, refunded), orders = listOf(ord))
        val products = AnaBreakdown.products(b, thisMonth)
        assertEquals(setOf("RING", "COIN"), products.map { it.sku }.toSet())
        assertEquals(100000.0, products.first { it.sku == "RING" }.revenue, 0.0)
        assertEquals("Unknown piece", products.first { it.sku == "RING" }.name)
        val categories = AnaBreakdown.categories(b, thisMonth)
        assertEquals(listOf("Ring", AnaCoins.goldCoinCategory), categories.map { it.id })
        assertEquals(2.0, categories[1].itemsSold, 0.0)
        val customers = AnaBreakdown.customers(b, thisMonth)
        assertEquals(1, customers.size)
        assertEquals(2, customers[0].orderCount)
        assertEquals(3.0, customers[0].itemsPurchased, 0.0)
        assertEquals((90000.0 + 50000.0) / 2, customers[0].averageSpent, 0.0)
    }

    @Test fun anUncategorisedLineIsNamedUncategorised() {
        val inv = invoice("I1", "2026-10-05", listOf(item("A", 1000.0, category = "")))
        val rows = AnaBreakdown.categories(books(invoices = listOf(inv)), thisMonth)
        assertEquals("Uncategorized", rows.single().name)
        assertEquals("Uncategorized", AnaCategories.title("nothing-like-it"))
    }

    // MARK: The history (Sales tab)

    @Test fun theHistoryBinsByYearAndMonthKeepsDrawingsOutOfCostsAndFillsQuietMonths() {
        val b = books(
            invoices = listOf(
                invoice("I1", "2025-12-15", listOf(item("A", 100000.0)), paid = 60000.0),
                invoice("I2", "2026-02-10", listOf(item("B", 300000.0))),
            ),
            orders = listOf(order("O1", "2026-02-12", 50000.0)),
            expenses = listOf(
                expense("E1", "2026-02-01", 10000.0),
                expense("E2", "2026-02-02", 90000.0, "Drawings", mapOf("paidBy" to "partner", "partnerId" to "P1")),
            ),
            extra = listOf(extraRevenue("R1", "2026-02-20", 1000.0)),
        )
        val h = AnaHistory.of(b, MarginSettings.taheri)
        assertEquals(listOf(2026, 2025), h.yearly.map { it.year })
        val y26 = h.yearly[0]
        assertEquals(351000.0, y26.revenue, 0.0)
        // Net profit is the estimate less expenses, never revenue less expenses: the goods cost something.
        assertTrue(y26.profit > 0 && y26.profit < y26.revenue)
        assertEquals(y26.profit - y26.expenses, y26.netProfit, 0.0)
        assertTrue(y26.netProfit < y26.revenue - y26.expenses)
        assertTrue(NetProfit.marginPercent(y26.netProfit, y26.revenue) < 15.0, "a jewellery shop is not at 100% margin")
        assertEquals(40000.0, h.yearly[1].unpaid, 0.0)
        assertEquals(listOf("2025-12", "2026-01", "2026-02"), h.months.map { it.key })
        assertEquals(0.0, h.months[1].revenue, 0.0)
        assertEquals(0, h.months[1].sales)
        assertEquals("2026-02", h.bestMonth)
        // Revenue averaged across the months that had any.
        assertEquals((100000.0 + 351000.0) / 2, h.monthlyAverage, 0.0)
        assertEquals(0.0, AnaHistory.of(b, null).yearly[0].profit, 0.0)
        assertTrue(AnaHistory.of(b, MarginSettings.taheri).yearly[0].profit > 0)
    }

    @Test fun anEmptyHistoryHasNothingAndNoBestMonth() {
        val h = AnaHistory.of(books(), null)
        assertTrue(h.yearly.isEmpty())
        assertTrue(h.months.isEmpty())
        assertNull(h.bestMonth)
    }

    // MARK: Small rules

    @Test fun theNumberWordsReadLikeJavaScript() {
        assertEquals("1,234.5", AnaFormat.number(1234.5, 1))
        assertEquals("1,234", AnaFormat.number(1234.4, 0))
        assertEquals("1.072", AnaFormat.number(1.0716, 3))
        assertEquals("1.5", AnaFormat.count(1.5))
        assertEquals("3", AnaFormat.count(3.0))
        // toFixed works on the double's exact value: 1.005 is a hair under, so it rounds down.
        assertEquals("1.00", AnaFormat.fixed(1.005, 2))
        assertEquals("0.50", AnaFormat.fixed(0.5, 2))
        assertEquals("bill", AnaFormat.plural(1, "bill", "bills"))
        assertEquals("bills", AnaFormat.plural(2, "bill", "bills"))
    }

    @Test fun skusAndNames() {
        assertTrue(AnaSku.isStock("RNG-101"))
        assertFalse(AnaSku.isStock("NEW-3"))
        assertFalse(AnaSku.isStock("BILL-3"))
        assertFalse(AnaSku.isStock(""))
        assertEquals("b", AnaText.firstFilled(listOf(null, "", "b", "c"), "z"))
        assertEquals("z", AnaText.firstFilled(listOf(null, ""), "z"))
    }

    @Test fun moneyIsSaidInLacAndCrore() {
        assertEquals("PKR 4.5 lac", Money.pkrLac(450000.0))
        assertEquals("PKR 1.2 crore", Money.pkrLac(12000000.0))
        assertEquals("PKR 85,000", Money.pkrLac(85000.0))
    }

    @Test fun onlyTheFiveAnalyticsAddressesAreHere() {
        val paths = listOf("/analytics", "/analytics/sales", "/analytics/products", "/analytics/customers", "/analytics/categories")
        for (p in paths) assertTrue(AnalyticsRoutes.any { it.matches(p) }, p)
        assertFalse(AnalyticsRoutes.any { it.matches("/analytics/unknown") })
        assertFalse(AnalyticsRoutes.any { it.matches("/expenses") })
        assertEquals(listOf("Analytics", "Sales", "Products", "Customers", "Categories"), AnaSection.values().map { it.title })
    }
}
