// Ported from src/lib/analytics/books.ts (tests: BooksTests, from books.test.ts, value for value).
//
// The shop's books for a period: every figure Analytics shows, worked out in one place. Pure functions: no Android, no
// store. Every money rule is the one the owner already settled:
//
//  - coins apart from everything (Coins), shown only in `coinSummary`;
//  - a sale is worth `invoiceSaleValue` (exchange added back), on its order's date (`revenueDate`);
//  - a sale at its own margin (Margin.kt), extra revenue at the assumed one;
//  - an order counts as a sale only while `bookedAsSale` (not yet an invoice, not cancelled, not awaiting a transfer);
//  - profit before running costs is `NetProfit.beforeRunning` (revenue less goods where the house records them), net
//    profit that less the running costs only;
//  - cash in is `cashInForPeriod`; credit handed back is shown as money out and added back to money in.
//
// Cash is always worked out, even in a period with no sale (a payment on an older bill still lands).
//
// Days are Karachi's (ERPDate.karachi), as everywhere in the app: where the web's date-fns reads the browser's local
// day, this reads the shop's. The house's settings the web reads from STORE_CONFIG (the metal, the margin, the goods
// categories) come in as [BooksOptions].

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.Product
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

// MARK: Types

data class BooksInput(
    val invoices: List<Invoice>,
    val orders: List<Order>,
    val products: List<Product> = emptyList(),
    val customers: List<Customer> = emptyList(),
    val expenses: List<Expense> = emptyList(),
    val additionalRevenues: List<AdditionalRevenue> = emptyList(),
)

data class BooksOptions(
    /** "Today", for tests and for a page that wants one clock. */
    val now: Instant = Instant.now(),
    /** The metal whose weight counts as "metal sold"; the house's own (Mina: silver). */
    val metal: MetalType = MetalType.gold,
    /** The house's margin settings (STORE_EST_MARGIN, COST_RATTI_LESS). */
    val margin: MarginSettings = MarginSettings.default,
    /** The categories the house files its goods under (`goodsExpenseCategories`); empty: this house records none (Taheri). */
    val goods: List<String> = emptyList(),
    /** Gold apart from silver (`goldApartMargin`, a percent; null: off, as Taheri). */
    val goldApartMargin: Double? = null,
)

enum class ExpenseKind { running, goods, drawings }

data class SalesDay(val date: String, val sales: Double, val orders: Int, val itemsSold: Double, /** Of [sales], gold (GoldApart). */ val gold: Double = 0.0)
data class TopProduct(val sku: String, val name: String, val quantity: Double, val revenue: Double)
data class CategorySale(val categoryId: String, val categoryName: String, val sales: Double)
data class TopCustomer(val key: String, val customerId: String?, val customerName: String, val totalSpent: Double, val orderCount: Int)
data class ExpenseByCategory(val category: String, val amount: Double, val kind: ExpenseKind)
data class SourceBreakdown(val key: String, val label: String, val revenue: Double, val orderCount: Int, val avgOrderValue: Double)

/** One day of revenue per source; every active source has a value (a missing one is 0, so the lines stay continuous). */
data class SourceTrendRow(val date: String, val values: Map<String, Double>)

/** One weekday's average (Monday = 0 ... Sunday = 6). */
data class WeekdayRow(
    val weekday: Int,
    val label: String,
    /** Revenue on that weekday across the period. */
    val revenue: Double,
    /** How many of that weekday the period holds (days with no sale count as 0 in the average). */
    val days: Int,
    /** `revenue / days`. */
    val avg: Double,
    /** Sales (invoices and orders) on that weekday. */
    val count: Int,
)

data class ReceivableRow(
    val id: String,
    val customerName: String,
    val customerId: String?,
    /** The day it counts for (its order's date when made from one). */
    val date: String,
    /** Jewellery and coin part together. */
    val balanceDue: Double,
    /** Of which on coins. */
    val coinDue: Double,
)

data class ExpenseRow(val id: String, val date: String, val category: String, val description: String, val amount: Double, val kind: ExpenseKind)

data class MetalKaratRow(val karat: String, val grams: Double, val pieces: Double)

/** Customers who bought on one day, split by whether that was their first-ever sale. */
data class CustomerDay(val date: String, val newKeys: List<String>, val returningKeys: List<String>)

data class RevenueMixRow(val key: String, val label: String, val value: Double)

data class Books(
    // Revenue (jewellery only; coins apart)
    val totalSales: Double,
    /** Of [totalSales], the gold pieces' (GoldApart); the rest is the house's own metal and extra revenue. */
    val goldRevenue: Double,
    /** [totalSales] less [goldRevenue]. */
    val silverRevenue: Double,
    /** Gold's estimated profit at the house's margin where gold is apart, else 0: a caption beside gold revenue, never added into any profit. */
    val goldProfit: Double,
    val invoiceSales: Double,
    val orderSales: Double,
    val extraRevenue: Double,
    val totalUnpaid: Double,
    /** Invoices plus uninvoiced orders (extra revenue is not an order). */
    val totalOrders: Int,
    val averageOrderValue: Double,
    val totalItemsSold: Double,
    val totalDiscounts: Double,
    val averageItemsPerOrder: Double,
    // What was earned
    /** Each sale at its own margin, before the house's goods are looked at. */
    val estProfit: Double,
    val salesCosted: Int,
    val salesCount: Int,
    /** Profit before running costs: `NetProfit.beforeRunning` (Mina: revenue less goods, Gross profit). */
    val estProfitAdj: Double,
    /** Revenue less `estProfitAdj`: what the pieces cost (estimated at Taheri, goods bought at Mina). */
    val costOfPieces: Double,
    /** `estProfitAdj` less the running costs only. */
    val netProfit: Double,
    /** In percent of revenue. */
    val netMargin: Double,
    // Metal, by weight (the house's metal; coins are not in here)
    val metalGrams: Double,
    val metalPieces: Double,
    /** Heaviest karat first. */
    val metalByKarat: List<MetalKaratRow>,
    // Series and rankings
    val salesOverTime: List<SalesDay>,
    val topProductsByRevenue: List<TopProduct>,
    val topProductsByQuantity: List<TopProduct>,
    val salesByCategory: List<CategorySale>,
    val topCustomers: List<TopCustomer>,
    val byWeekday: List<WeekdayRow>,
    /** Invoices / orders not invoiced yet / extra revenue, in that order, zeros kept. */
    val revenueMix: List<RevenueMixRow>,
    // Expenses
    val totalExpenses: Double,
    val runningExpenses: Double,
    val goodsExpenses: Double,
    /** Expenses that are neither running costs nor goods: partners' drawings. */
    val drawingsExpenses: Double,
    val expenseKinds: Map<ExpenseKind, Double>,
    val expensesByCategory: List<ExpenseByCategory>,
    /** The ten biggest single expenses of the period. */
    val largestExpenses: List<ExpenseRow>,
    // Cash flow
    val cashIn: Double,
    val cashInFromInvoicePayments: Double,
    val cashInFromOrderAdvances: Double,
    val cashInFromExtraRevenue: Double,
    val cashInFromExchange: Double,
    val exchangeOffInvoices: Double,
    val cashOut: Double,
    /** The three kinds of expense, as money out (`cashOut` is their sum plus `creditPaidBack`). */
    val cashOutRunning: Double,
    val cashOutGoods: Double,
    val cashOutDrawings: Double,
    val creditPaidBack: Double,
    val netCashFlow: Double,
    /** Revenue less the cash that came in on it: what is still to collect (exchange off a bill is not revenue). */
    val accrualVsCashGap: Double,
    // Who still owes (this period's sales, largest first)
    val receivables: List<ReceivableRow>,
    val receivablesTotal: Double,
    // Customers
    /** Named customers (walk-ins left out) whose first-ever sale falls in the period. */
    val newCustomers: Int,
    /** Named customers who bought in the period but had bought before it. */
    val returningCustomers: Int,
    val revenueFromNew: Double,
    val revenueFromReturning: Double,
    /** Per day, for the new-vs-returning chart; use [bucketCustomerFlow]. */
    val customerDays: List<CustomerDay>,
    // Acquisition source
    val sourceBreakdown: List<SourceBreakdown>,
    val sourceTrend: List<SourceTrendRow>,
    val sourceActiveKeys: List<String>,
    // Coins, apart
    val coinSummary: CoinSummary,
    /** The house has coin sales at all (any period): the metal page shows its coin section only then. */
    val hasCoins: Boolean,
    // The period itself
    /** Jewellery invoices in the period. */
    val invoices: List<Invoice>,
    /** The same invoices by the day they count for (yyyy-MM-dd). */
    val invoicesByDay: Map<String, List<Invoice>>,
    /** A range was chosen and holds no invoice and no order (the old "Nothing in this range"). */
    val rangeEmpty: Boolean,
) {
    companion object {
        /** Every figure Analytics shows for [range] (see the file comment for the rules). A pure function of its inputs. */
        // (The previous period, the buckets and the month-by-month rows are the file's top-level functions, below.)
        fun compute(input: BooksInput, range: Period?, opts: BooksOptions = BooksOptions()): Books = computeWith(prepare(input, opts), range)
    }
}

// MARK: Sources

/** The catch-all for sales with no source on the record or customer. */
const val UNCLASSIFIED_KEY = "unclassified"

/** The configured sources plus an "unclassified" catch-all, in the ERP's order. */
val SOURCE_KEYS: List<String> = customerSources + UNCLASSIFIED_KEY

fun sourceLabel(key: String): String = customerSourceLabel(key) ?: "Unclassified"

// MARK: Karachi's calendar (date-fns, in the shop's day)

internal object BooksCal {
    private val zone = ERPDate.karachi
    private val en = Locale.US

    private val fMonthDay: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d", en)
    private val fWeekdayMonthDay: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE, MMM d", en)
    private val fMonthYearShort: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM yy", en)
    private val fMonthYearLong: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM yyyy", en)

    fun day(d: Instant): LocalDate = d.atOffset(zone).toLocalDate()

    fun startOf(day: LocalDate): Instant = day.atStartOfDay(zone).toInstant()

    fun endOf(day: LocalDate): Instant = startOf(day.plusDays(1)).minusMillis(1)

    fun startOfDay(d: Instant): Instant = startOf(day(d))

    /** date-fns `endOfDay`: the last millisecond of the day. */
    fun endOfDay(d: Instant): Instant = endOf(day(d))

    fun dayKey(d: LocalDate): String = d.toString()

    fun monthKey(d: LocalDate): String = "%04d-%02d".format(Locale.ROOT, d.year, d.monthValue)

    fun startOfMonth(d: LocalDate): LocalDate = d.withDayOfMonth(1)

    fun endOfMonth(d: LocalDate): LocalDate = d.withDayOfMonth(d.lengthOfMonth())

    /** date-fns `differenceInCalendarDays(a, b)`. */
    fun daysBetween(a: LocalDate, b: LocalDate): Int = ChronoUnit.DAYS.between(b, a).toInt()

    fun weekdayIndex(d: LocalDate): Int = d.dayOfWeek.value - 1

    fun startOfWeek(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    fun monthDay(d: LocalDate): String = fMonthDay.format(d)
    fun weekdayMonthDay(d: LocalDate): String = fWeekdayMonthDay.format(d)
    fun monthYearShort(d: LocalDate): String = fMonthYearShort.format(d)
    fun monthYearLong(d: LocalDate): String = fMonthYearLong.format(d)
}

// MARK: The shared preparation

private fun kindOf(category: String?, goods: List<String>): ExpenseKind = when {
    NetProfit.isRunningCost(category, goods) -> ExpenseKind.running
    NetProfit.isGoodsExpense(category, goods) -> ExpenseKind.goods
    else -> ExpenseKind.drawings
}

/** A record and the instant it counts for; null when its date does not read. */
private class Dated<T>(val item: T, val at: Instant?)

/** A sale counts on the day its order was taken (store.ts getInvoiceRevenueDate). */
fun revenueDate(inv: Invoice, ordersById: Map<String, Order>): String {
    if (JS.has(inv.sourceOrderId)) {
        val order = ordersById[inv.sourceOrderId ?: ""]
        if (order != null && JS.has(order.createdAt)) return order.createdAt
    }
    return inv.createdAt
}

/** Everything that does not depend on the period, worked out once so a year of months does not redo it. */
private class Prepared(
    val input: BooksInput,
    val opts: BooksOptions,
    val ordersById: Map<String, Order>,
    val customersById: Map<String, Customer>,
    val productsBySku: Map<String, Product>,
    val jewellery: List<Dated<Invoice>>,
    val coins: List<Dated<Invoice>>,
    val orders: List<Dated<Order>>,
    val expenses: List<Dated<Expense>>,
    val extras: List<Dated<AdditionalRevenue>>,
    val invoiced: Set<String>,
    /** Customer key -> time of the customer's first-ever sale, walk-ins excluded. */
    val firstSale: Map<String, Instant>,
) {
    val now: Instant get() = opts.now
    val recordsGoods: Boolean get() = opts.goods.isNotEmpty()
}

private fun prepare(input: BooksInput, opts: BooksOptions): Prepared {
    val orders = input.orders
    val invoices = input.invoices
    val ordersById = HashMap<String, Order>().also { m -> for (o in orders) m[o.id] = o }
    val customersById = HashMap<String, Customer>().also { m -> for (c in input.customers) m[c.id] = c }
    val productsBySku = HashMap<String, Product>().also { m -> for (p in input.products) if (!m.containsKey(p.sku)) m[p.sku] = p }
    val (jewellery, coins) = Coins.splitAll(invoices)
    fun dated(list: List<Invoice>): List<Dated<Invoice>> =
        list.filter { JS.has(it.createdAt) && it.status != InvoiceStatus.refunded }
            .map { Dated(it, JS.parseISO(revenueDate(it, ordersById))) }
            .filter { it.at != null }

    // The first time each named customer bought anything: any invoice (coins too) or order that counts as a sale.
    val nameOf: (String) -> String? = { id -> customersById[id]?.name }
    val firstSale = HashMap<String, Instant>()
    fun seen(key: String, at: Instant?) {
        if (at == null || key == WALK_IN_ENTITY) return
        val prev = firstSale[key]
        if (prev == null || at.isBefore(prev)) firstSale[key] = at
    }
    for (inv in invoices) if (JS.has(inv.createdAt) && inv.status != InvoiceStatus.refunded) seen(saleCustomerKey(inv, nameOf), JS.parseISO(revenueDate(inv, ordersById)))
    for (o in orders) if (bookedAsSale(o)) seen(saleCustomerKey(o, nameOf), JS.parseISO(o.createdAt))

    return Prepared(
        input = input, opts = opts, ordersById = ordersById, customersById = customersById, productsBySku = productsBySku,
        jewellery = dated(jewellery),
        coins = dated(coins),
        orders = orders.filter { bookedAsSale(it) }.map { Dated(it, JS.parseISO(it.createdAt)) }.filter { it.at != null },
        expenses = input.expenses.map { Dated(it, JS.parseISO(it.date)) },
        extras = input.additionalRevenues.filter { JS.has(it.date) }.map { Dated(it, JS.parseISO(it.date)) }.filter { it.at != null },
        invoiced = invoicedOrderIds(orders, invoices),
        firstSale = firstSale,
    )
}

private class Bounds(val start: Instant?, val end: Instant?, val cashFrom: Instant?, val cashTo: Instant?)

/** The period as the old page read it: no `from` is all time; no `to` runs to today. */
private fun boundsOf(range: Period?, now: Instant): Bounds {
    val from = range?.from?.let { BooksCal.startOfDay(it) }
    val to = when {
        range?.to != null -> BooksCal.endOfDay(range.to!!)
        range?.from != null -> BooksCal.endOfDay(now)
        else -> null
    }
    // What filters the sales: only with a `from`. What bounds the cash: the old page let a lone `to` bound it.
    return Bounds(start = from, end = if (from != null) to else null, cashFrom = from, cashTo = to)
}

private fun inside(at: Instant?, start: Instant?, end: Instant?): Boolean =
    start == null || (at != null && !at.isBefore(start) && !at.isAfter(end!!))

private class Acc(var revenue: Double = 0.0, var count: Int = 0)

private class Spent(var total: Double = 0.0, var count: Int = 0)

// MARK: The books for a period

private fun computeWith(p: Prepared, range: Period?): Books {
    val opts = p.opts
    val goods = opts.goods
    val b = boundsOf(range, p.now)
    val start = b.start
    val end = b.end
    val filteredInvoices = p.jewellery.filter { inside(it.at, start, end) }.map { it.item }
    val filteredCoinInvoices = p.coins.filter { inside(it.at, start, end) }.map { it.item }
    val filteredOrders = p.orders.filter { inside(it.at, start, end) }.map { it.item }
    val filteredExpenses = p.expenses.filter { start == null || inside(it.at, start, end) }.map { it.item }
    val filteredExtras = p.extras.filter { inside(it.at, start, end) }.map { it.item }

    val customersById = p.customersById
    val nameOf: (String) -> String? = { id -> customersById[id]?.name }
    // Invoices carry the channel on `acquisitionSource` (the bare `source` field is reserved for Shopify import
    // tagging); orders carry it on `source`. An explicit override wins, else the linked customer's saved source.
    fun resolveSource(recorded: String?, customerId: String?): String {
        if (!recorded.isNullOrEmpty()) return recorded
        if (!customerId.isNullOrEmpty()) {
            val s = customersById[customerId]?.source?.rawValue
            if (!s.isNullOrEmpty()) return s
        }
        return UNCLASSIFIED_KEY
    }
    val sourceAgg = HashMap<String, Acc>()
    val sourceByDate = HashMap<String, HashMap<String, Double>>()
    fun accrueSource(key: String, dateKey: String, amount: Double) {
        val a = sourceAgg.getOrPut(key) { Acc() }
        a.revenue += amount
        a.count += 1
        val byKey = sourceByDate.getOrPut(dateKey) { HashMap() }
        byKey[key] = (byKey[key] ?: 0.0) + amount
    }

    var totalSales = 0.0
    var invoiceSalesAcc = 0.0
    var goldRevenue = 0.0
    var estProfit = 0.0
    var salesCosted = 0
    var salesCount = 0
    var totalItemsSold = 0.0
    var metalGrams = 0.0
    var metalPieces = 0.0
    val metalByKarat = LinkedHashMap<String, MetalKaratAcc>()
    var totalDiscounts = 0.0
    var totalUnpaid = 0.0
    class DayAcc(var sales: Double = 0.0, var orders: Int = 0, var itemsSold: Double = 0.0, var gold: Double = 0.0)
    val salesByDate = HashMap<String, DayAcc>()
    class ProductAcc(var quantity: Double, var revenue: Double, val name: String?)
    val productPerformance = LinkedHashMap<String, ProductAcc>()
    val categoryPerformance = LinkedHashMap<String, Double>()
    class CustomerAcc(var totalSpent: Double, var orderCount: Int, val resolvedName: String?)
    val customerPerformance = LinkedHashMap<String, CustomerAcc>()
    val weekdayCount = IntArray(7)
    val customerDay = HashMap<String, LinkedHashSet<String>>()
    val invoicesByDay = LinkedHashMap<String, MutableList<Invoice>>()
    fun day(k: String): DayAcc = salesByDate.getOrPut(k) { DayAcc() }
    fun seenOnDay(dateKey: String, customerKey: String) {
        if (customerKey == WALK_IN_ENTITY) return
        customerDay.getOrPut(dateKey) { LinkedHashSet() }.add(customerKey)
    }

    for (invoice in filteredInvoices) {
        val invAmount = invoiceSaleValue(invoice)
        totalSales += invAmount
        val invGold = GoldApart.invoiceGoldPart(invoice, invAmount)
        goldRevenue += invGold
        invoiceSalesAcc += invAmount
        val m = invoiceMargin(invoice, opts.margin)
        estProfit += invAmount * m.percent / 100
        salesCount += 1
        if (!m.assumed) salesCosted += 1
        totalDiscounts += invoice.discountAmount
        totalUnpaid += max(0.0, invoice.balanceDue)

        val revenueDay = BooksCal.day(JS.parseISO(revenueDate(invoice, p.ordersById))!!)
        val dateKey = BooksCal.dayKey(revenueDay)
        val d = day(dateKey)
        d.sales += invAmount
        d.gold += invGold
        d.orders += 1
        weekdayCount[BooksCal.weekdayIndex(revenueDay)] += 1
        invoicesByDay.getOrPut(dateKey) { ArrayList() }.add(invoice)

        accrueSource(resolveSource(invoice.acquisitionSource?.rawValue, invoice.customerId), dateKey, invAmount)

        // The customer, else the stored name (so named customers without a linked account aren't all collapsed into
        // "Walk-in"), else the one walk-in row (walk-in.ts).
        val customerKey = saleCustomerKey(invoice, nameOf)
        val ca = customerPerformance.getOrPut(customerKey) { CustomerAcc(0.0, 0, invoice.customerName.ifEmpty { null }) }
        ca.totalSpent += invAmount
        ca.orderCount += 1
        seenOnDay(dateKey, customerKey)

        for (item in invoice.items) {
            val quantity = item.quantity
            val itemTotal = item.itemTotal
            totalItemsSold += quantity
            d.itemsSold += quantity

            // The metal actually sold. A piece with no recorded weight adds nothing rather than a guess, and the page
            // says how many were weighed.
            if (item.metalType == opts.metal) {
                val units = if (quantity == 0.0) 1.0 else quantity
                val g = item.metalWeightG * units
                if (g > 0) {
                    metalGrams += g
                    metalPieces += units
                    val k = item.karat?.rawValue ?: "unknown"
                    val acc = metalByKarat.getOrPut(k) { MetalKaratAcc() }
                    acc.grams += g
                    acc.pieces += units
                }
            }

            val pa = productPerformance.getOrPut(item.sku) { ProductAcc(0.0, 0.0, item.name) }
            pa.quantity += quantity
            pa.revenue += itemTotal

            // Its own category, else its order's, else its name's (lineCategory, categories.ts).
            val cat = lineCategory(item.categoryId, item.itemCategory, item.name)
            if (cat != null) categoryPerformance[cat] = (categoryPerformance[cat] ?: 0.0) + itemTotal
        }
    }

    // Uninvoiced orders into revenue. Use subtotal (the full order value): grandTotal is subtotal minus advance, which
    // would understate revenue since the advance is still earned income.
    var orderSales = 0.0
    for (order in filteredOrders) {
        val amount = order.subtotal
        totalSales += amount
        orderSales += amount
        val ordGold = GoldApart.orderGoldPart(order, amount)
        goldRevenue += ordGold
        val m = orderMargin(order, settings = opts.margin)
        estProfit += amount * m.percent / 100
        salesCount += 1
        if (!m.assumed) salesCosted += 1

        val orderDay = BooksCal.day(JS.parseISO(order.createdAt)!!)
        val dateKey = BooksCal.dayKey(orderDay)
        val d = day(dateKey)
        d.sales += amount
        d.gold += ordGold
        d.orders += 1
        weekdayCount[BooksCal.weekdayIndex(orderDay)] += 1

        accrueSource(resolveSource(order.source?.rawValue, order.customerId), dateKey, amount)

        val customerKey = saleCustomerKey(order, nameOf)
        val ca = customerPerformance.getOrPut(customerKey) { CustomerAcc(0.0, 0, order.customerName?.ifEmpty { null }) }
        ca.totalSpent += amount
        ca.orderCount += 1
        seenOnDay(dateKey, customerKey)
    }

    // Extra revenue, before salesOverTime is read so it shows in the chart.
    var extraRevenue = 0.0
    for (r in filteredExtras) {
        totalSales += r.amount
        extraRevenue += r.amount
        estProfit += r.amount * opts.margin.assumedMargin
        day(BooksCal.dayKey(BooksCal.day(JS.parseISO(r.date)!!))).sales += r.amount
    }

    val totalOrders = filteredInvoices.size + filteredOrders.size
    val orderRevenueTotal = invoiceSalesAcc + orderSales

    // Expenses
    var totalExpenses = 0.0
    var runningExpenses = 0.0
    var goodsExpenses = 0.0
    val expenseByCategoryMap = LinkedHashMap<String, Double>()
    for (e in filteredExpenses) {
        totalExpenses += e.amount
        if (NetProfit.isRunningCost(e.category, goods)) runningExpenses += e.amount
        else if (NetProfit.isGoodsExpense(e.category, goods)) goodsExpenses += e.amount
        if (e.category.isNotEmpty()) expenseByCategoryMap[e.category] = (expenseByCategoryMap[e.category] ?: 0.0) + e.amount
    }
    val drawingsExpenses = totalExpenses - runningExpenses - goodsExpenses
    val expensesByCategory = expenseByCategoryMap.map { (category, amount) -> ExpenseByCategory(category, amount, kindOf(category, goods)) }
        .sortedByDescending { it.amount }
    val largestExpenses = filteredExpenses.sortedByDescending { it.amount }.take(10)
        .map { ExpenseRow(it.id, it.date, it.category, it.description, it.amount, kindOf(it.category, goods)) }

    val salesOverTime = salesByDate.map { (date, d) -> SalesDay(date, d.sales, d.orders, d.itemsSold, d.gold) }.sortedBy { it.date }

    val productRows = productPerformance.map { (sku, d) ->
        TopProduct(sku, listOf(p.productsBySku[sku]?.name, d.name).firstOrNull { !it.isNullOrEmpty() } ?: "Unnamed piece", d.quantity, d.revenue)
    }
    val topProductsByRevenue = productRows.sortedByDescending { it.revenue }.take(10)
    val topProductsByQuantity = productRows.sortedByDescending { it.quantity }.take(10)

    val salesByCategory = categoryPerformance.map { (id, sales) -> CategorySale(id, categoryTitle(id) ?: "Uncategorized", sales) }
        .sortedByDescending { it.sales }

    val topCustomers = customerPerformance.map { (key, d) ->
        when {
            key == WALK_IN_ENTITY -> TopCustomer(key, null, WALK_IN_NAME, d.totalSpent, d.orderCount)
            // Named customer without a linked account: the stored name directly.
            key.startsWith("name:") -> TopCustomer(key, null, key.drop(5), d.totalSpent, d.orderCount)
            // Linked customer: the current name from the book.
            else -> TopCustomer(
                key, key, listOf(customersById[key]?.name, d.resolvedName).firstOrNull { !it.isNullOrEmpty() } ?: WALK_IN_NAME,
                d.totalSpent, d.orderCount,
            )
        }
    }.sortedByDescending { it.totalSpent }.take(10)

    // New and returning: a named customer is new when their first-ever sale falls in the period.
    var newCustomers = 0
    var returningCustomers = 0
    var revenueFromNew = 0.0
    var revenueFromReturning = 0.0
    for ((key, d) in customerPerformance) {
        if (key == WALK_IN_ENTITY) continue
        val first = p.firstSale[key]
        val isNew = start == null || (first != null && !first.isBefore(start))
        if (isNew) { newCustomers += 1; revenueFromNew += d.totalSpent } else { returningCustomers += 1; revenueFromReturning += d.totalSpent }
    }
    val customerDays = customerDay.keys.sorted().map { date ->
        val news = ArrayList<String>()
        val returning = ArrayList<String>()
        for (key in customerDay.getValue(date)) {
            val first = p.firstSale[key]
            if (first != null && BooksCal.dayKey(BooksCal.day(first)) == date) news.add(key) else returning.add(key)
        }
        CustomerDay(date, news, returning)
    }

    // By weekday: the average over the weekdays the period holds, quiet days counted as 0.
    val spanStart: Instant? = start ?: salesOverTime.firstOrNull()?.let { JS.parseISO(it.date) }
    val spanEndRaw: Instant? = if (start != null) end else salesOverTime.lastOrNull()?.let { JS.parseISO(it.date) }
    val spanEnd: Instant? = if (spanEndRaw != null && spanEndRaw.isAfter(p.now)) p.now else spanEndRaw
    val weekdayDays = IntArray(7)
    if (spanStart != null && spanEnd != null) {
        var d = BooksCal.day(spanStart)
        while (!BooksCal.startOf(d).isAfter(spanEnd)) {
            weekdayDays[BooksCal.weekdayIndex(d)] += 1
            d = d.plusDays(1)
        }
    }
    val weekdayRevenue = DoubleArray(7)
    for (row in salesOverTime) JS.parseISO(row.date)?.let { weekdayRevenue[BooksCal.weekdayIndex(BooksCal.day(it))] += row.sales }
    val byWeekday = WEEKDAYS.mapIndexed { i, label ->
        WeekdayRow(i, label, weekdayRevenue[i], weekdayDays[i], if (weekdayDays[i] > 0) weekdayRevenue[i] / weekdayDays[i] else 0.0, weekdayCount[i])
    }

    // Acquisition source: the canonical order, the real sources leading and Unclassified trailing.
    val sourceActiveKeys = SOURCE_KEYS.filter { (sourceAgg[it]?.count ?: 0) > 0 }
    val sourceBreakdown = sourceActiveKeys.map { key ->
        val a = sourceAgg.getValue(key)
        SourceBreakdown(key, sourceLabel(key), a.revenue, a.count, if (a.count > 0) a.revenue / a.count else 0.0)
    }.sortedByDescending { it.revenue }
    // One row per date (chronological) with a value for every active source, missing keys 0 so the lines stay continuous.
    val sourceTrend = sourceByDate.keys.sorted().map { date ->
        SourceTrendRow(date, sourceActiveKeys.associateWith { sourceByDate.getValue(date)[it] ?: 0.0 })
    }

    // Cash flow
    // In: invoice payments collected in the period (on ALL invoices: a payment may belong to an older bill), cash
    // advances on orders not invoiced yet, gold taken in exchange (which the owner counts as cash) and extra revenue; a
    // finalised order's advances are its invoice's payments and counted there only (cash-in.ts). Out: every expense paid
    // in the period. Credit handed back is a negative payment on its invoice, so cash-in.ts nets it off the payments;
    // here it is money out instead and added back to money in, so the net is the same.
    val cash = cashInForPeriod(
        invoices = p.jewellery.map { it.item },
        orders = p.input.orders,
        invoiced = p.invoiced,
        extraRevenues = p.input.additionalRevenues,
        period = Period(b.cashFrom, b.cashTo),
        invoiceDate = { inv -> revenueDate(inv, p.ordersById) },
    )
    val cashIn = cash.total + cash.paidBack
    val cashOut = totalExpenses + cash.paidBack
    // Gold taken off an invoice's total is in Cash In but was never in revenue.
    val accrualVsCashGap = totalSales - (cashIn - cash.paidBack - cash.exchangeOffInvoices)

    // Who still owes: this period's bills, jewellery and coins, largest first.
    val owed = LinkedHashMap<String, ReceivableRow>()
    fun addOwed(inv: Invoice, coin: Boolean) {
        val due = max(0.0, inv.balanceDue)
        if (due <= 0) return
        val row = owed[inv.id] ?: ReceivableRow(inv.id, inv.customerName.ifEmpty { WALK_IN_NAME }, inv.customerId, revenueDate(inv, p.ordersById), 0.0, 0.0)
        owed[inv.id] = row.copy(balanceDue = row.balanceDue + due, coinDue = if (coin) row.coinDue + due else row.coinDue)
    }
    filteredInvoices.forEach { addOwed(it, false) }
    filteredCoinInvoices.forEach { addOwed(it, true) }
    val receivables = owed.values.sortedByDescending { it.balanceDue }

    val estProfitAdj = NetProfit.beforeRunning(estProfit, totalSales, goodsExpenses, p.recordsGoods)
    // Gold apart (Mina): its estimate at the margin, for the caption only; profit is the house's one rule.
    val goldMargin = p.opts.goldApartMargin
    val goldProfit = if (goldMargin != null) goldRevenue * goldMargin / 100 else 0.0
    val netProfit = NetProfit.of(estProfitAdj, runningExpenses)

    return Books(
        totalSales = totalSales, goldRevenue = goldRevenue, silverRevenue = totalSales - goldRevenue, goldProfit = goldProfit,
        invoiceSales = invoiceSalesAcc, orderSales = orderSales, extraRevenue = extraRevenue,
        totalUnpaid = totalUnpaid, totalOrders = totalOrders,
        averageOrderValue = if (totalOrders > 0) orderRevenueTotal / totalOrders else 0.0,
        totalItemsSold = totalItemsSold, totalDiscounts = totalDiscounts,
        averageItemsPerOrder = if (totalOrders > 0) totalItemsSold / totalOrders else 0.0,
        estProfit = estProfit, salesCosted = salesCosted, salesCount = salesCount, estProfitAdj = estProfitAdj,
        costOfPieces = totalSales - estProfitAdj,
        netProfit = netProfit, netMargin = NetProfit.marginPercent(netProfit, totalSales),
        metalGrams = metalGrams, metalPieces = metalPieces,
        // Heaviest karat first: what the shop mostly sells leads.
        metalByKarat = metalByKarat.map { (k, v) -> MetalKaratRow(k, v.grams, v.pieces) }.sortedByDescending { it.grams },
        salesOverTime = salesOverTime, topProductsByRevenue = topProductsByRevenue, topProductsByQuantity = topProductsByQuantity,
        salesByCategory = salesByCategory, topCustomers = topCustomers, byWeekday = byWeekday,
        revenueMix = listOf(
            RevenueMixRow("invoices", "Invoices", invoiceSalesAcc),
            RevenueMixRow("orders", "Orders not invoiced yet", orderSales),
            RevenueMixRow("extra", "Extra revenue", extraRevenue),
        ),
        totalExpenses = totalExpenses, runningExpenses = runningExpenses, goodsExpenses = goodsExpenses, drawingsExpenses = drawingsExpenses,
        expenseKinds = mapOf(ExpenseKind.running to runningExpenses, ExpenseKind.goods to goodsExpenses, ExpenseKind.drawings to drawingsExpenses),
        expensesByCategory = expensesByCategory, largestExpenses = largestExpenses,
        cashIn = cashIn,
        cashInFromInvoicePayments = cash.invoicePayments + cash.paidBack,
        cashInFromOrderAdvances = cash.orderAdvances,
        cashInFromExtraRevenue = cash.extraRevenue,
        cashInFromExchange = cash.exchange,
        exchangeOffInvoices = cash.exchangeOffInvoices,
        cashOut = cashOut, cashOutRunning = runningExpenses, cashOutGoods = goodsExpenses, cashOutDrawings = drawingsExpenses,
        creditPaidBack = cash.paidBack, netCashFlow = cashIn - cashOut, accrualVsCashGap = accrualVsCashGap,
        receivables = receivables, receivablesTotal = receivables.sumOf { it.balanceDue },
        newCustomers = newCustomers, returningCustomers = returningCustomers, revenueFromNew = revenueFromNew,
        revenueFromReturning = revenueFromReturning, customerDays = customerDays,
        sourceBreakdown = sourceBreakdown, sourceTrend = sourceTrend, sourceActiveKeys = sourceActiveKeys,
        coinSummary = Coins.summarise(filteredCoinInvoices),
        hasCoins = p.coins.isNotEmpty(),
        invoices = filteredInvoices, invoicesByDay = invoicesByDay,
        rangeEmpty = filteredInvoices.isEmpty() && filteredOrders.isEmpty() && start != null,
    )
}

private class MetalKaratAcc(var grams: Double = 0.0, var pieces: Double = 0.0)

private val WEEKDAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

// MARK: The period before

data class PreviousPeriod(
    val range: Period,
    /** After "vs": "last month", "last year", "previous 7 days". */
    val label: String,
)

/**
 * The period to compare with. A whole or month-to-date calendar month is compared with the same days of the month
 * before ("vs last month", so 1-5 November meets 1-5 October, not a stray week of October); a year or year-to-date with
 * the same span of the year before; anything else with the same number of days immediately before it. null for all
 * time (no `from`).
 */
fun previousPeriod(range: Period?, now: Instant = Instant.now()): PreviousPeriod? {
    val rangeFrom = range?.from ?: return null
    val from = BooksCal.day(rangeFrom)
    val to = BooksCal.day(range.to ?: now)
    val days = BooksCal.daysBetween(to, from) + 1
    if (days < 1) return null
    if (from.dayOfMonth == 1 && to.year == from.year && to.month == from.month) {
        val prevFrom = BooksCal.startOfMonth(from.minusMonths(1))
        val prevTo = minOf(prevFrom.plusDays((to.dayOfMonth - 1).toLong()), BooksCal.endOfMonth(prevFrom))
        return PreviousPeriod(Period(BooksCal.startOf(prevFrom), BooksCal.endOf(prevTo)), "last month")
    }
    if (from.monthValue == 1 && from.dayOfMonth == 1 && to.year == from.year) {
        return PreviousPeriod(Period(BooksCal.startOf(from.minusYears(1)), BooksCal.endOf(to.minusYears(1))), "last year")
    }
    return PreviousPeriod(
        Period(BooksCal.startOf(from.minusDays(days.toLong())), BooksCal.endOf(from.minusDays(1))),
        if (days == 1) "the day before" else "previous $days days",
    )
}

/** [previousPeriod]'s range alone. */
fun previousRange(range: Period?, now: Instant = Instant.now()): Period? = previousPeriod(range, now)?.range

// MARK: Sales over time, by day, week or month

enum class Bucket { day, week, month }

/** The default grain for a period: days up to 45 of them, weeks up to 200, else months (all time: months). */
fun autoBucket(range: Period?, now: Instant = Instant.now()): Bucket {
    val from = range?.from ?: return Bucket.month
    val days = BooksCal.daysBetween(BooksCal.day(range.to ?: now), BooksCal.day(from)) + 1
    return if (days <= 45) Bucket.day else if (days <= 200) Bucket.week else Bucket.month
}

data class BucketRow(
    /** The bucket's first day, yyyy-MM-dd. */
    val key: String,
    /** Axis label: "Nov 4", for a week the day it starts on, "Nov 25". */
    val label: String,
    /** Tooltip title: "Tue, Nov 4", "Week of Nov 3", "November 2026". */
    val tip: String,
    val sales: Double,
    val orders: Int,
    val itemsSold: Double,
)

private fun bucketStart(d: LocalDate, b: Bucket): LocalDate = when (b) {
    Bucket.day -> d
    Bucket.week -> BooksCal.startOfWeek(d)
    Bucket.month -> BooksCal.startOfMonth(d)
}

private fun bucketNext(d: LocalDate, b: Bucket): LocalDate = when (b) {
    Bucket.day -> d.plusDays(1)
    Bucket.week -> d.plusWeeks(1)
    Bucket.month -> d.plusMonths(1)
}

private fun bucketLabels(d: LocalDate, b: Bucket): Pair<String, String> = when (b) {
    Bucket.day -> BooksCal.monthDay(d) to BooksCal.weekdayMonthDay(d)
    Bucket.week -> BooksCal.monthDay(d) to "Week of ${BooksCal.monthDay(d)}"
    Bucket.month -> BooksCal.monthYearShort(d) to BooksCal.monthYearLong(d)
}

/**
 * Daily sales summed into days, weeks (Monday first) or months. Quiet buckets are kept as zeros so a gap reads as a
 * gap: between the first and last sale, widened to [range] when one is given (so the current and previous periods line
 * up bucket for bucket).
 */
fun bucketSeries(series: List<SalesDay>, bucket: Bucket, range: Period? = null, now: Instant = Instant.now()): List<BucketRow> {
    class Sum(var sales: Double = 0.0, var orders: Int = 0, var itemsSold: Double = 0.0)
    val sums = HashMap<String, Sum>()
    var first: LocalDate? = null
    var last: LocalDate? = null
    for (row in series) {
        val at = JS.parseISO(row.date) ?: continue
        val d = BooksCal.day(at)
        val s = sums.getOrPut(BooksCal.dayKey(bucketStart(d, bucket))) { Sum() }
        s.sales += row.sales
        s.orders += row.orders
        s.itemsSold += row.itemsSold
        if (first == null || d.isBefore(first)) first = d
        if (last == null || d.isAfter(last)) last = d
    }
    var lo = first
    var hi = last
    val rangeFrom = range?.from
    if (rangeFrom != null) {
        val from = BooksCal.day(rangeFrom)
        val to = BooksCal.day(range.to ?: now)
        if (lo == null || from.isBefore(lo)) lo = from
        if (hi == null || to.isAfter(hi)) hi = to
    }
    if (lo == null || hi == null) return emptyList()
    val rows = ArrayList<BucketRow>()
    var d = bucketStart(lo, bucket)
    while (!d.isAfter(hi)) {
        val key = BooksCal.dayKey(d)
        val (label, tip) = bucketLabels(d, bucket)
        val s = sums[key]
        rows.add(BucketRow(key, label, tip, s?.sales ?: 0.0, s?.orders ?: 0, s?.itemsSold ?: 0.0))
        d = bucketNext(d, bucket)
    }
    return rows
}

data class ComparedRow(val key: String, val label: String, val tip: String, val value: Double, val orders: Int, val prev: Double? = null, val prevLabel: String? = null)

/** The current buckets with the previous period's laid beside them, first with first (same axis, one measure). */
fun compareSeries(current: List<BucketRow>, previous: List<BucketRow>? = null): List<ComparedRow> =
    current.mapIndexed { i, r ->
        val prev = previous?.getOrNull(i)
        ComparedRow(r.key, r.label, r.tip, r.sales, r.orders, prev?.sales, prev?.tip)
    }

data class CustomerFlowRow(val key: String, val label: String, val tip: String, val newCustomers: Int, val returningCustomers: Int)

/** New and returning customers per bucket: a customer is new in the bucket of their first sale, returning after. */
fun bucketCustomerFlow(days: List<CustomerDay>, bucket: Bucket, range: Period? = null, now: Instant = Instant.now()): List<CustomerFlowRow> {
    val frame = bucketSeries(days.map { SalesDay(it.date, 0.0, 0, 0.0) }, bucket, range, now)
    val news = HashMap<String, MutableSet<String>>()
    val all = HashMap<String, MutableSet<String>>()
    for (d in days) {
        val at = JS.parseISO(d.date) ?: continue
        val key = BooksCal.dayKey(bucketStart(BooksCal.day(at), bucket))
        val n = news.getOrPut(key) { HashSet() }
        val a = all.getOrPut(key) { HashSet() }
        d.newKeys.forEach { n.add(it); a.add(it) }
        d.returningKeys.forEach { a.add(it) }
    }
    return frame.map { r ->
        val n = news[r.key]?.size ?: 0
        CustomerFlowRow(r.key, r.label, r.tip, n, (all[r.key]?.size ?: 0) - n)
    }
}

// MARK: Month by month

data class MonthRow(
    /** yyyy-MM */
    val key: String,
    /** "Nov 26" */
    val month: String,
    val revenue: Double,
    /** Sales (invoices and orders). */
    val sales: Int,
    /** Profit before running costs (`estProfitAdj`). */
    val estProfit: Double,
    val running: Double,
    val goods: Double,
    val drawings: Double,
    /** Net profit and its margin in percent. */
    val net: Double,
    val netMargin: Double,
    val cashIn: Double,
    val cashOut: Double,
    /** Grams of the house's metal sold, in total and by karat. */
    val metalGrams: Double,
    val metalByKarat: Map<String, Double>,
    val coinRevenue: Double,
    val coinCount: Double,
)

/**
 * Calendar month by calendar month, each worked out by the same [Books.compute] as a chosen period, so a month's
 * figures are the ones the page shows when that month is picked. [months] is the last N ending this month (quiet months
 * kept), or null for "all", from the first record on. Not bound to the page's range.
 */
fun monthlySeries(input: BooksInput, months: Int? = 12, opts: BooksOptions = BooksOptions()): List<MonthRow> {
    val p = prepare(input, opts)
    val thisMonth = BooksCal.startOfMonth(BooksCal.day(p.now))
    val first: LocalDate
    if (months == null) {
        val times = (p.jewellery.map { it.at } + p.coins.map { it.at } + p.orders.map { it.at } + p.expenses.map { it.at } + p.extras.map { it.at })
            .filterNotNull()
        val earliest = times.minOrNull() ?: return emptyList()
        first = BooksCal.startOfMonth(BooksCal.day(earliest))
    } else {
        first = BooksCal.startOfMonth(thisMonth.minusMonths((max(1, months) - 1).toLong()))
    }
    val last = if (months == null) maxOf(thisMonth, first) else thisMonth
    val rows = ArrayList<MonthRow>()
    var m = first
    while (!m.isAfter(last)) {
        val b = computeWith(p, Period(BooksCal.startOf(m), BooksCal.endOf(BooksCal.endOfMonth(m))))
        rows.add(
            MonthRow(
                key = BooksCal.monthKey(m), month = BooksCal.monthYearShort(m),
                revenue = b.totalSales, sales = b.totalOrders, estProfit = b.estProfitAdj,
                running = b.runningExpenses, goods = b.goodsExpenses, drawings = b.drawingsExpenses,
                net = b.netProfit, netMargin = b.netMargin, cashIn = b.cashIn, cashOut = b.cashOut,
                metalGrams = b.metalGrams, metalByKarat = b.metalByKarat.associate { it.karat to it.grams },
                coinRevenue = b.coinSummary.revenue, coinCount = b.coinSummary.coins,
            ),
        )
        m = m.plusMonths(1)
    }
    return rows
}

/** The karats a run of months holds, heaviest overall first (the stack's keys). */
fun karatsOf(rows: List<MonthRow>): List<String> {
    val total = LinkedHashMap<String, Double>()
    for (r in rows) for ((k, g) in r.metalByKarat) total[k] = (total[k] ?: 0.0) + g
    return total.keys.sortedByDescending { total.getValue(it) }
}

data class MonthRevenueRow(val key: String, val month: String, val revenue: Double, val sales: Int)

data class MonthlyRevenue(val data: List<MonthRevenueRow>, val average: Double, val best: String?)

/**
 * Revenue per calendar month across the whole history, not bound to the range: the shape of the trend rather than a
 * slice. Same revenue basis as everywhere (invoice sale value on its order date, uninvoiced order subtotals, extra
 * revenue). Empty months are kept so gaps read as gaps.
 */
fun monthlyRevenue(input: BooksInput, opts: BooksOptions = BooksOptions()): MonthlyRevenue {
    val p = prepare(input, opts)
    class Sum(var revenue: Double = 0.0, var sales: Int = 0)
    val bucket = HashMap<String, Sum>()
    fun add(iso: String, amount: Double) {
        val at = JS.parseISO(iso) ?: return
        val s = bucket.getOrPut(BooksCal.monthKey(BooksCal.day(at))) { Sum() }
        s.revenue += amount
        s.sales += 1
    }
    p.jewellery.forEach { add(revenueDate(it.item, p.ordersById), invoiceSaleValue(it.item)) }
    p.orders.forEach { add(it.item.createdAt, it.item.subtotal) }
    p.extras.forEach { add(it.item.date, it.item.amount) }

    val keys = bucket.keys.sorted()
    if (keys.isEmpty()) return MonthlyRevenue(emptyList(), 0.0, null)
    // Every month between the first and last, so a quiet month shows as a gap instead of collapsing the timeline.
    val data = ArrayList<MonthRevenueRow>()
    var m = LocalDate.parse(keys.first() + "-01")
    val lastMonth = LocalDate.parse(keys.last() + "-01")
    while (!m.isAfter(lastMonth)) {
        val key = BooksCal.monthKey(m)
        val s = bucket[key]
        data.add(MonthRevenueRow(key, BooksCal.monthYearShort(m), s?.revenue ?: 0.0, s?.sales ?: 0))
        m = m.plusMonths(1)
    }
    val withRevenue = data.filter { it.revenue > 0 }
    val average = if (withRevenue.isNotEmpty()) withRevenue.sumOf { it.revenue } / withRevenue.size else 0.0
    var best = data.first()
    for (d in data) if (d.revenue > best.revenue) best = d
    return MonthlyRevenue(data, average, best.key)
}

data class YearRow(
    val year: Int, val revenue: Double, val expenses: Double, val unpaid: Double, val profit: Double, val netProfit: Double, val netMargin: Double,
    /** Of [revenue], gold's (gold apart, House of Mina: the year table's Silver and Gold columns; silver is the rest). Extra revenue is never gold. */
    val goldRevenue: Double = 0.0,
)

/** Each calendar year of the history, newest first (the old "Yearly Performance Overview"). */
fun yearlySummary(input: BooksInput, opts: BooksOptions = BooksOptions()): List<YearRow> {
    val p = prepare(input, opts)
    class Y(var revenue: Double = 0.0, var gold: Double = 0.0, var expenses: Double = 0.0, var unpaid: Double = 0.0, var profit: Double = 0.0, var goods: Double = 0.0)
    val yearMap = HashMap<Int, Y>()
    fun yr(at: Instant): Y = yearMap.getOrPut(BooksCal.day(at).year) { Y() }
    for (d in p.jewellery) {
        val at = d.at ?: continue
        val y = yr(at)
        val value = invoiceSaleValue(d.item)
        y.revenue += value
        y.gold += GoldApart.invoiceGoldPart(d.item, value)
        // Each sale at its own margin: from the 24k rate typed when it was made, else the assumed one (Margin.kt).
        y.profit += value * invoiceMargin(d.item, opts.margin).percent / 100
        y.unpaid += max(0.0, d.item.balanceDue)
    }
    for (d in p.orders) {
        val at = d.at ?: continue
        val y = yr(at)
        // Subtotal: the full order value regardless of advance paid.
        y.revenue += d.item.subtotal
        y.gold += GoldApart.orderGoldPart(d.item, d.item.subtotal)
        y.profit += d.item.subtotal * orderMargin(d.item, settings = opts.margin).percent / 100
    }
    for (d in p.extras) {
        val at = d.at ?: continue
        val y = yr(at)
        y.revenue += d.item.amount
        y.profit += d.item.amount * opts.margin.assumedMargin
    }
    for (d in p.expenses) {
        val at = d.at ?: continue
        // Drawings are a distribution of profit, not a cost of earning it; the goods (Mina's stock and karigars) are
        // already inside the estimated profit's margin. Where a house records its goods (Mina) they come off the
        // revenue as the gross profit (NetProfit.beforeRunning).
        val isGoods = NetProfit.isGoodsExpense(d.item.category, opts.goods)
        if (!isGoods && !NetProfit.isRunningCost(d.item.category, opts.goods)) continue
        val y = yr(at)
        if (isGoods) y.goods += d.item.amount else y.expenses += d.item.amount
    }
    return yearMap.map { (year, v) ->
        val profit = NetProfit.beforeRunning(v.profit, v.revenue, v.goods, p.recordsGoods)
        // That profit less the running costs, never revenue less every expense (NetProfit).
        val net = NetProfit.of(profit, v.expenses)
        YearRow(year, v.revenue, v.expenses, v.unpaid, profit, net, NetProfit.marginPercent(net, v.revenue), goldRevenue = v.gold)
    }.sortedByDescending { it.year }
}
