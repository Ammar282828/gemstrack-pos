package erp.app.screens.analytics

import erp.core.logic.CashIn
import erp.core.logic.MarginSettings
import erp.core.logic.NetProfit
import erp.core.logic.Period
import erp.core.logic.WALK_IN_ENTITY
import erp.core.logic.WALK_IN_NAME
import erp.core.logic.bookedAsSale
import erp.core.logic.cashInForPeriod
import erp.core.logic.invoiceMargin
import erp.core.logic.invoiceSaleValue
import erp.core.logic.invoicedOrderIds
import erp.core.logic.lineCategory
import erp.core.logic.orderMargin
import erp.core.logic.saleCustomerKey
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.CustomerSource
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.InvoiceStatus
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.Product
import kotlin.math.max

// What Analytics says, worked out once from the shelves (components/analytics/analytics-view.tsx `analyticsData`;
// AnalyticsFigures.swift). No view in this file. Every money rule is core's; what is here is the page's own gathering
// of them.

/** The books Analytics reads, with the lookups it needs. Customers are the live ones: a removed customer is out of every list. */
class AnaBooks(
    val invoices: List<Invoice>,
    val orders: List<Order>,
    val products: List<Product>,
    val customers: List<Customer>,
    val expenses: List<Expense>,
    val extraRevenue: List<AdditionalRevenue>,
) {
    val ordersById: Map<String, Order> = orders.associateBy { it.id }
    val customersById: Map<String, Customer> = customers.associateBy { it.id }
    val productsBySku: Map<String, Product> = HashMap<String, Product>().also { m -> for (p in products) if (!m.containsKey(p.sku)) m[p.sku] = p }
}

/** Which records fall in the period. No range: all time, everything counts. */
class AnaScope(val range: AnaRange?) {
    /** date-fns `isWithinInterval(parseISO(iso), …)`; a date that does not read is out of any range. */
    fun has(iso: String?): Boolean {
        val r = range ?: return true
        val d = AnaDate.parseISO(iso) ?: return false
        return r.contains(d)
    }
}

// MARK: Rows

class AnaDay(
    /** "2026-10-08". */
    val date: String,
    var sales: Double = 0.0,
    var orders: Int = 0,
    var itemsSold: Double = 0.0,
)

class AnaKarat(val karat: String, var grams: Double = 0.0, var pieces: Double = 0.0)

class AnaTopProduct(val sku: String, val name: String, val quantity: Double, val revenue: Double)

class AnaCategorySale(val categoryId: String, val name: String, val sales: Double)

class AnaTopCustomer(
    val key: String,
    /** Set when the sale goes to someone in the book; their page opens from the row. */
    val customerId: String?,
    val name: String,
    val totalSpent: Double,
    val orderCount: Int,
)

class AnaExpenseCategory(val category: String, val amount: Double)

class AnaSourceRow(val key: String, val label: String, val revenue: Double, val orderCount: Int) {
    val avgOrderValue: Double get() = if (orderCount > 0) revenue / orderCount else 0.0
}

class AnaSourcePoint(val date: String, val label: String, val amount: Double)

// MARK: The figures

class AnaFigures {
    /** Invoices (jewellery side, not refunded) and uninvoiced orders in the period: "Nothing in this range" when both are none. */
    var invoicesInRange = 0
    var ordersInRange = 0

    var totalSales = 0.0
    var invoiceSales = 0.0
    var orderSales = 0.0
    var extraRevenue = 0.0
    var totalUnpaid = 0.0
    var totalOrders = 0
    var averageOrderValue = 0.0
    var averageItemsPerOrder = 0.0
    var totalItemsSold = 0.0
    var totalDiscounts = 0.0

    /** Each sale at its own margin (lib/margin.ts). Owners only: null margin settings leave it 0. */
    var estProfit = 0.0
    var salesCosted = 0
    var salesCount = 0

    // Gold, by weight: grams of gold in the jewellery sold. Coins are not in here.
    var goldGrams = 0.0
    var goldPieces = 0.0
    var goldByKarat: List<AnaKarat> = emptyList()

    var salesOverTime: List<AnaDay> = emptyList()
    var invoicesByDay: Map<String, List<Invoice>> = emptyMap()
    var topProducts: List<AnaTopProduct> = emptyList()
    var salesByCategory: List<AnaCategorySale> = emptyList()
    var topCustomers: List<AnaTopCustomer> = emptyList()

    var totalExpenses = 0.0
    var expensesByCategory: List<AnaExpenseCategory> = emptyList()

    /** Cash flow (cash-in.ts); null when nothing at all was in the period. */
    var cash: CashIn? = null

    var sourceBreakdown: List<AnaSourceRow> = emptyList()
    var sourceTrend: List<AnaSourcePoint> = emptyList()

    /** Coin bills on record (any date) and the coin card over this period. */
    var coinInvoiceCount = 0
    var coin: AnaCoins.Summary = AnaCoins.summarise(emptyList())

    /** Credit handed back to customers: cash-in.ts nets it off the payments; here it is money out, added back to money in so the net is the same. */
    val creditPaidBack: Double get() = cash?.paidBack ?: 0.0
    val cashIn: Double get() = (cash?.total ?: 0.0) + creditPaidBack
    val cashOut: Double get() = totalExpenses + creditPaidBack
    val netCashFlow: Double get() = cashIn - cashOut
    val exchangeOffInvoices: Double get() = cash?.exchangeOffInvoices ?: 0.0

    companion object {
        /** [margin] null is a non-owner: no margin is worked out for them at all. */
        fun of(books: AnaBooks, range: AnaRange?, margin: MarginSettings?): AnaFigures {
            val f = AnaFigures()
            val scope = AnaScope(range)
            val ordersById = books.ordersById
            val revenueDate: (Invoice) -> String = { inv -> AnaRules.revenueDate(inv, ordersById) }

            // Coins out, before anything is counted (coins.ts).
            val (jewellery, coins) = AnaCoins.splitAll(books.invoices)

            val inRange: (Invoice) -> Boolean = { inv ->
                if (inv.status == InvoiceStatus.refunded) false
                else range == null || (inv.createdAt.isNotEmpty() && scope.has(revenueDate(inv)))
            }
            val filteredInvoices = jewellery.filter(inRange)
            val filteredCoins = coins.filter(inRange)
            // An order not invoiced, not closed, and not an online one still waiting for its transfer.
            val filteredOrders = books.orders.filter { bookedAsSale(it) && scope.has(it.createdAt) }
            val filteredExpenses = books.expenses.filter { scope.has(it.date) }
            val filteredExtra = books.extraRevenue.filter { scope.has(it.date) }

            f.invoicesInRange = filteredInvoices.size
            f.ordersInRange = filteredOrders.size
            f.coinInvoiceCount = coins.size
            f.coin = AnaCoins.summarise(filteredCoins)

            if (filteredInvoices.isEmpty() && filteredOrders.isEmpty() && filteredExpenses.isEmpty() && filteredExtra.isEmpty()) return f

            val gather = AnaGather(books, margin, revenueDate)
            for (inv in filteredInvoices) gather.invoice(inv)
            for (o in filteredOrders) gather.order(o)
            for (r in filteredExtra) gather.extra(r)
            for (e in filteredExpenses) gather.expense(e)
            gather.finish(f, filteredInvoices.size, filteredOrders.size)

            // Cash IN = invoice payments collected in this period (on ALL invoices: a payment in the range may belong to
            // an invoice written earlier) + cash advances on orders not invoiced yet, each on its own day + gold taken in
            // exchange, which the owner counts as cash. Cash OUT = expenses paid in this period.
            f.cash = cashInForPeriod(
                invoices = jewellery,
                orders = books.orders,
                invoiced = invoicedOrderIds(books.orders, books.invoices),
                extraRevenues = books.extraRevenue,
                period = Period(range?.from, range?.to),
                invoiceDate = revenueDate,
            )
            return f
        }
    }
}

// MARK: Gathering

private class ProductAcc(val name: String, var quantity: Double = 0.0, var revenue: Double = 0.0)

private class CustomerAcc(val resolvedName: String?, var spent: Double = 0.0, var count: Int = 0)

private class SourceAcc(var revenue: Double = 0.0, var count: Int = 0)

/** One pass over what is in the period. A class so the running totals are not passed around by hand. */
private class AnaGather(val books: AnaBooks, val margin: MarginSettings?, val revenueDate: (Invoice) -> String) {
    /** The book's name for a customer id, so a walk-in renamed since to a real person counts as that person. */
    val nameOf: (String) -> String? = { id -> books.customersById[id]?.name }

    var totalSales = 0.0
    var invoiceSales = 0.0
    var orderSales = 0.0
    var extraRevenue = 0.0
    var unpaid = 0.0
    var discounts = 0.0
    var itemsSold = 0.0
    var estProfit = 0.0
    var costed = 0
    var counted = 0
    var goldGrams = 0.0
    var goldPieces = 0.0
    val karats = LinkedHashMap<String, AnaKarat>()
    val days = HashMap<String, AnaDay>()
    val invoicesByDay = HashMap<String, MutableList<Invoice>>()
    val products = LinkedHashMap<String, ProductAcc>()
    val categories = LinkedHashMap<String, Double>()
    val customers = LinkedHashMap<String, CustomerAcc>()
    val sources = HashMap<String, SourceAcc>()
    val sourceByDate = HashMap<String, HashMap<String, Double>>()
    var expenseTotal = 0.0
    val expenseByCategory = LinkedHashMap<String, Double>()

    private fun day(key: String): AnaDay = days.getOrPut(key) { AnaDay(key) }

    // MARK: Sources

    /** A sale's acquisition source: the record's own wins, else the linked customer's saved one, else unclassified. */
    private fun sourceKey(recorded: CustomerSource?, customerId: String?): String {
        if (recorded != null && recorded.rawValue.isNotEmpty()) return recorded.rawValue
        if (!customerId.isNullOrEmpty()) {
            val s = books.customersById[customerId]?.source
            if (s != null && s.rawValue.isNotEmpty()) return s.rawValue
        }
        return AnaSources.unclassified
    }

    private fun accrueSource(key: String, day: String, amount: Double) {
        val acc = sources.getOrPut(key) { SourceAcc() }
        acc.revenue += amount
        acc.count += 1
        if (day.isNotEmpty()) {
            val byKey = sourceByDate.getOrPut(day) { HashMap() }
            byKey[key] = (byKey[key] ?: 0.0) + amount
        }
    }

    private fun accrueCustomer(key: String, resolved: String?, amount: Double) {
        val acc = customers.getOrPut(key) { CustomerAcc(if (resolved.isNullOrEmpty()) null else resolved) }
        acc.spent += amount
        acc.count += 1
    }

    private fun dayKey(iso: String): String = AnaDate.parseISO(iso)?.let { AnaDate.dayKey(it) } ?: ""

    // MARK: A record at a time

    fun invoice(inv: Invoice) {
        val value = invoiceSaleValue(inv)
        totalSales += value
        invoiceSales += value
        if (margin != null) {
            // Each sale at its own margin: from the 24k rate typed when it was made, else the house's estimate.
            val m = invoiceMargin(inv, margin)
            estProfit += value * m.percent / 100
            if (!m.assumed) costed += 1
        }
        counted += 1
        discounts += inv.discountAmount
        unpaid += max(0.0, inv.balanceDue)

        val key = dayKey(revenueDate(inv))
        if (key.isNotEmpty()) {
            val d = day(key)
            d.sales += value
            d.orders += 1
            invoicesByDay.getOrPut(key) { ArrayList() }.add(inv)
        }
        accrueSource(sourceKey(inv.acquisitionSource, inv.customerId), key, value)
        // The customer, else the stored name (so named customers without a linked account aren't all collapsed into
        // "Walk-in"), else the one walk-in row (walk-in.ts).
        accrueCustomer(saleCustomerKey(inv, nameOf), inv.customerName, value)

        for (item in inv.items) line(item, key)
    }

    private fun line(item: InvoiceItem, day: String) {
        val quantity = item.quantity
        itemsSold += quantity
        if (day.isNotEmpty()) day(day).itemsSold += quantity
        val units = if (quantity == 0.0) 1.0 else quantity

        // The metal actually sold. A piece with no recorded weight adds nothing rather than a guess.
        if (item.metalType == MetalType.gold) {
            val g = item.metalWeightG * units
            if (g > 0) {
                goldGrams += g
                goldPieces += units
                val k = item.karat?.rawValue ?: "unknown"
                val acc = karats.getOrPut(k) { AnaKarat(k) }
                acc.grams += g
                acc.pieces += units
            }
        }

        val p = products.getOrPut(item.sku) { ProductAcc(item.name) }
        p.quantity += quantity
        p.revenue += item.itemTotal

        // Its own category, else its order's, else its name's (lineCategory, categories.ts).
        lineCategory(item.categoryId, item.itemCategory, item.name)?.let { cat ->
            categories[cat] = (categories[cat] ?: 0.0) + item.itemTotal
        }
    }

    /** An uninvoiced order counts at its subtotal, the full order value: grandTotal is that less the advance, which is still earned. */
    fun order(o: Order) {
        val amount = o.subtotal
        totalSales += amount
        orderSales += amount
        if (margin != null) {
            val m = orderMargin(o, settings = margin)
            estProfit += amount * m.percent / 100
            if (!m.assumed) costed += 1
        }
        counted += 1

        val key = dayKey(o.createdAt)
        if (key.isNotEmpty()) {
            val d = day(key)
            d.sales += amount
            d.orders += 1
        }
        accrueSource(sourceKey(o.source, o.customerId), key, amount)
        accrueCustomer(saleCustomerKey(o, nameOf), o.customerName, amount)
    }

    fun extra(r: AdditionalRevenue) {
        totalSales += r.amount
        extraRevenue += r.amount
        if (margin != null) estProfit += r.amount * margin.assumedMargin
        val key = dayKey(r.date)
        if (key.isNotEmpty()) day(key).sales += r.amount
    }

    /** Every logged expense is cash out; the ones with a category also make the category chart. */
    fun expense(e: Expense) {
        expenseTotal += e.amount
        if (e.category.isNotEmpty()) expenseByCategory[e.category] = (expenseByCategory[e.category] ?: 0.0) + e.amount
    }

    // MARK: Putting it together

    private fun customerRow(key: String): AnaTopCustomer {
        val acc = customers[key] ?: CustomerAcc(null)
        if (key == WALK_IN_ENTITY) return AnaTopCustomer(key, null, WALK_IN_NAME, acc.spent, acc.count)
        // A named customer without a linked account: the stored name.
        if (key.startsWith("name:")) return AnaTopCustomer(key, null, key.drop(5), acc.spent, acc.count)
        val name = AnaText.firstFilled(listOf(books.customersById[key]?.name, acc.resolvedName), WALK_IN_NAME)
        return AnaTopCustomer(key, key, name, acc.spent, acc.count)
    }

    fun finish(f: AnaFigures, invoiceCount: Int, orderCount: Int) {
        val orders = invoiceCount + orderCount
        f.totalSales = totalSales
        f.invoiceSales = invoiceSales
        f.orderSales = orderSales
        f.extraRevenue = extraRevenue
        f.totalUnpaid = unpaid
        f.totalOrders = orders
        f.averageOrderValue = if (orders > 0) (invoiceSales + orderSales) / orders else 0.0
        f.averageItemsPerOrder = if (orders > 0) itemsSold / orders else 0.0
        f.totalItemsSold = itemsSold
        f.totalDiscounts = discounts
        f.estProfit = estProfit
        f.salesCosted = costed
        f.salesCount = counted
        f.goldGrams = goldGrams
        f.goldPieces = goldPieces
        // Heaviest karat first: what the shop mostly sells leads.
        f.goldByKarat = AnaSort.descending(karats.values.toList()) { it.grams }

        f.salesOverTime = days.keys.sorted().map { days.getValue(it) }
        f.invoicesByDay = invoicesByDay

        val productRows = products.map { (sku, acc) ->
            val name = AnaText.firstFilled(listOf(books.productsBySku[sku]?.name, acc.name), "Unnamed piece")
            AnaTopProduct(sku, name, acc.quantity, acc.revenue)
        }
        f.topProducts = AnaSort.descending(productRows) { it.revenue }.take(10)

        val categoryRows = categories.map { (id, sales) -> AnaCategorySale(id, AnaCategories.title(id), sales) }
        f.salesByCategory = AnaSort.descending(categoryRows) { it.sales }

        val customerRows = customers.keys.map { customerRow(it) }
        f.topCustomers = AnaSort.descending(customerRows) { it.totalSpent }.take(10)

        f.totalExpenses = expenseTotal
        val expenseRows = expenseByCategory.map { (c, amount) -> AnaExpenseCategory(c, amount) }
        f.expensesByCategory = AnaSort.descending(expenseRows) { it.amount }

        // One row per source that has at least one sale, the real sources leading and Unclassified trailing.
        val activeKeys = AnaSources.keys.filter { (sources[it]?.count ?: 0) > 0 }
        val sourceRows = activeKeys.map { k -> AnaSourceRow(k, AnaSources.label(k), sources[k]?.revenue ?: 0.0, sources[k]?.count ?: 0) }
        f.sourceBreakdown = AnaSort.descending(sourceRows) { it.revenue }

        // One value per source per day (chronological), a missing one 0, so the lines stay continuous.
        val trend = ArrayList<AnaSourcePoint>()
        for (date in sourceByDate.keys.sorted()) {
            for (k in activeKeys) trend.add(AnaSourcePoint(date, AnaSources.label(k), sourceByDate[date]?.get(k) ?: 0.0))
        }
        f.sourceTrend = trend
    }
}

// MARK: The detail tabs

/**
 * Products, Customers and Categories keep a breakdown of their own (the breakdown components under components/analytics). It counts
 * every invoice that is not refunded, coins included, on the day it was written, not on its order's day; its revenue is
 * each piece's own total, before invoice discounts and trade-ins.
 */
object AnaBreakdown {
    fun invoices(books: AnaBooks, range: AnaRange?): List<Invoice> {
        val scope = AnaScope(range)
        return books.invoices.filter { inv ->
            if (inv.status == InvoiceStatus.refunded) false else range == null || (inv.createdAt.isNotEmpty() && scope.has(inv.createdAt))
        }
    }

    class ProductRow(val sku: String, val name: String, val quantity: Double, val revenue: Double, val orders: Int)

    private class ProductAcc(var quantity: Double = 0.0, var revenue: Double = 0.0, val orders: HashSet<String> = HashSet())

    fun products(books: AnaBooks, range: AnaRange?): List<ProductRow> {
        val acc = LinkedHashMap<String, ProductAcc>()
        for (inv in invoices(books, range)) {
            for (item in inv.items) {
                if (item.sku.isEmpty()) continue
                val a = acc.getOrPut(item.sku) { ProductAcc() }
                a.quantity += item.quantity
                a.revenue += item.itemTotal
                a.orders.add(inv.id)
            }
        }
        return acc.map { (sku, a) ->
            ProductRow(sku, AnaText.firstFilled(listOf(books.productsBySku[sku]?.name), "Unknown piece"), a.quantity, a.revenue, a.orders.size)
        }
    }

    class CustomerRow(
        val key: String,
        val customerId: String?,
        val name: String,
        val totalSpent: Double,
        val orderCount: Int,
        val itemsPurchased: Double,
    ) {
        val averageSpent: Double get() = if (orderCount > 0) totalSpent / orderCount else 0.0
    }

    private class CustomerAcc(val resolvedName: String?, var spent: Double = 0.0, var count: Int = 0, var items: Double = 0.0)

    fun customers(books: AnaBooks, range: AnaRange?): List<CustomerRow> {
        val byId = books.customersById
        val nameOf: (String) -> String? = { id -> byId[id]?.name }
        val acc = LinkedHashMap<String, CustomerAcc>()
        for (inv in invoices(books, range)) {
            val key = saleCustomerKey(inv, nameOf)
            val a = acc.getOrPut(key) { CustomerAcc(if (inv.customerName.isEmpty()) null else inv.customerName) }
            a.spent += invoiceSaleValue(inv)
            a.count += 1
            a.items += inv.items.sumOf { it.quantity }
        }
        return acc.map { (key, a) ->
            when {
                key == WALK_IN_ENTITY -> CustomerRow(key, null, WALK_IN_NAME, a.spent, a.count, a.items)
                key.startsWith("name:") -> CustomerRow(key, null, key.drop(5), a.spent, a.count, a.items)
                else -> CustomerRow(key, key, AnaText.firstFilled(listOf(byId[key]?.name, a.resolvedName), WALK_IN_NAME), a.spent, a.count, a.items)
            }
        }
    }

    class CategoryRow(val id: String, val name: String, val revenue: Double, val itemsSold: Double, val orders: Int)

    private class CategoryAcc(var revenue: Double = 0.0, var items: Double = 0.0, val orders: HashSet<String> = HashSet())

    fun categories(books: AnaBooks, range: AnaRange?): List<CategoryRow> {
        val acc = LinkedHashMap<String, CategoryAcc>()
        for (inv in invoices(books, range)) {
            for (item in inv.items) {
                val id = lineCategory(item.categoryId, item.itemCategory, item.name) ?: "uncategorized"
                val a = acc.getOrPut(id) { CategoryAcc() }
                a.items += item.quantity
                a.revenue += item.itemTotal
                a.orders.add(inv.id)
            }
        }
        val rows = acc.map { (id, a) -> CategoryRow(id, AnaCategories.title(id), a.revenue, a.items, a.orders.size) }
        return AnaSort.descending(rows) { it.revenue }
    }
}

// MARK: Sales: the years and the months

class AnaYear(val year: Int, val revenue: Double, val expenses: Double, val unpaid: Double, val profit: Double) {
    val netProfit: Double get() = NetProfit.of(profit, expenses)
}

class AnaMonth(
    /** "2026-10". */
    val key: String,
    val label: String,
    val revenue: Double,
    val sales: Int,
)

/**
 * The Sales tab's two views over the whole history, which the period does not bound: the point of them is the shape of
 * the trend, not a slice of it. Same revenue basis as everywhere: an invoice's sale value (exchange counted) on its
 * order's day, uninvoiced orders at their subtotal, extra revenue.
 */
class AnaHistory(
    val yearly: List<AnaYear> = emptyList(),
    val months: List<AnaMonth> = emptyList(),
    /** Revenue averaged across the months that had sales. */
    val monthlyAverage: Double = 0.0,
    /** The month with the most revenue (the first, if tied). */
    val bestMonth: String? = null,
) {
    private class YearAcc(var revenue: Double = 0.0, var expenses: Double = 0.0, var unpaid: Double = 0.0, var profit: Double = 0.0)

    companion object {
        fun of(books: AnaBooks, margin: MarginSettings?): AnaHistory {
            val (jewellery, _) = AnaCoins.splitAll(books.invoices)
            val ordersById = books.ordersById

            val years = HashMap<Int, YearAcc>()
            val revenueOf = HashMap<String, Double>()
            val salesOf = HashMap<String, Int>()

            fun addMonth(iso: String, amount: Double) {
                val d = AnaDate.parseISO(iso) ?: return
                val key = AnaDate.monthKey(d)
                revenueOf[key] = (revenueOf[key] ?: 0.0) + amount
                salesOf[key] = (salesOf[key] ?: 0) + 1
            }

            for (inv in jewellery) {
                if (inv.status == InvoiceStatus.refunded || inv.createdAt.isEmpty()) continue
                val date = AnaRules.revenueDate(inv, ordersById)
                val d = AnaDate.parseISO(date) ?: continue
                val value = invoiceSaleValue(inv)
                val acc = years.getOrPut(AnaDate.year(d)) { YearAcc() }
                acc.revenue += value
                if (margin != null) acc.profit += value * invoiceMargin(inv, margin).percent / 100
                acc.unpaid += max(0.0, inv.balanceDue)
                addMonth(date, value)
            }
            for (o in books.orders) {
                if (!bookedAsSale(o)) continue
                val d = AnaDate.parseISO(o.createdAt) ?: continue
                val acc = years.getOrPut(AnaDate.year(d)) { YearAcc() }
                acc.revenue += o.subtotal
                if (margin != null) acc.profit += o.subtotal * orderMargin(o, settings = margin).percent / 100
                addMonth(o.createdAt, o.subtotal)
            }
            for (r in books.extraRevenue) {
                if (r.date.isEmpty()) continue
                val d = AnaDate.parseISO(r.date) ?: continue
                val acc = years.getOrPut(AnaDate.year(d)) { YearAcc() }
                acc.revenue += r.amount
                if (margin != null) acc.profit += r.amount * margin.assumedMargin
                addMonth(r.date, r.amount)
            }
            // Drawings are a distribution of profit, not a cost of earning it.
            for (e in books.expenses) {
                if (e.date.isEmpty() || !AnaRules.isBusinessCost(e)) continue
                val d = AnaDate.parseISO(e.date) ?: continue
                years.getOrPut(AnaDate.year(d)) { YearAcc() }.expenses += e.amount
            }

            val yearly = years.map { (y, a) -> AnaYear(y, a.revenue, a.expenses, a.unpaid, a.profit) }.sortedByDescending { it.year }

            // Walk every month between the first and the last, so a quiet month shows as a gap.
            val keys = revenueOf.keys.sorted()
            val first = keys.firstOrNull()
            val last = keys.lastOrNull()
            if (first == null || last == null) return AnaHistory(yearly = yearly)
            val rows = ArrayList<AnaMonth>()
            var cursor: String = first
            var guard = 0
            while (guard < 2400) {
                guard += 1
                rows.add(AnaMonth(cursor, AnaDate.monthShort(cursor), revenueOf[cursor] ?: 0.0, salesOf[cursor] ?: 0))
                if (cursor >= last) break
                cursor = AnaDate.nextMonth(cursor)
            }

            val withRevenue = rows.filter { it.revenue > 0 }
            val average = if (withRevenue.isEmpty()) 0.0 else withRevenue.sumOf { it.revenue } / withRevenue.size
            var best: AnaMonth? = null
            for (m in rows) {
                val b = best
                if (b == null || m.revenue > b.revenue) best = m
            }
            return AnaHistory(yearly, rows, average, best?.key)
        }
    }
}
