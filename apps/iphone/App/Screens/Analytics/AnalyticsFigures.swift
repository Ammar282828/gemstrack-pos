import Foundation
import ERPCore

// What Analytics says, worked out once from the shelves (components/analytics/analytics-view.tsx
// `analyticsData`). No view in this file. Every money rule is ERPCore's (invoiceSaleValue,
// bookedAsSale, cashInForPeriod, invoicedOrderIds, invoiceMargin / orderMargin, saleCustomerKey);
// what is here is the page's own gathering of them, plus the few helpers it uses that ERPCore does
// not hold yet (AnalyticsRules.swift, AnalyticsCoins.swift: each marked TODO(logic)).

/// The books Analytics reads, with the lookups it needs. Customers are the live ones: a removed
/// customer is out of every list, the web's store keeps them out too.
struct AnaBooks {
    let invoices: [Invoice]
    let orders: [Order]
    let products: [Product]
    let customers: [Customer]
    let expenses: [Expense]
    let extraRevenue: [AdditionalRevenue]

    let ordersById: [String: Order]
    let customersById: [String: Customer]
    let productsBySku: [String: Product]

    init(invoices: [Invoice], orders: [Order], products: [Product], customers: [Customer],
         expenses: [Expense], extraRevenue: [AdditionalRevenue]) {
        self.invoices = invoices
        self.orders = orders
        self.products = products
        self.customers = customers
        self.expenses = expenses
        self.extraRevenue = extraRevenue
        var o: [String: Order] = [:]
        for x in orders { o[x.id] = x }
        var c: [String: Customer] = [:]
        for x in customers { c[x.id] = x }
        var p: [String: Product] = [:]
        for x in products where p[x.sku] == nil { p[x.sku] = x }
        ordersById = o
        customersById = c
        productsBySku = p
    }
}

/// Which records fall in the period. No range: all time, everything counts.
struct AnaScope {
    let range: AnaRange?

    /// date-fns `isWithinInterval(parseISO(iso), …)`; a date that does not read is out of any range.
    func has(_ iso: String?) -> Bool {
        guard let range else { return true }
        guard let d = AnaDate.parseISO(iso) else { return false }
        return range.contains(d)
    }
}

// MARK: Rows

struct AnaDay: Identifiable {
    /// "2026-10-08".
    let date: String
    /// Noon of that day, where a chart draws it.
    let plotDate: Date
    var sales = 0.0
    var orders = 0
    var itemsSold = 0.0
    var id: String { date }

    init(date: String) {
        self.date = date
        plotDate = AnaDate.plotDate(day: date)
    }
}

struct AnaKarat: Identifiable {
    let karat: String
    var grams = 0.0
    var pieces = 0.0
    var id: String { karat }
}

struct AnaTopProduct: Identifiable {
    let sku: String
    let name: String
    let quantity: Double
    let revenue: Double
    var id: String { sku }
}

struct AnaCategorySale: Identifiable {
    let categoryId: String
    let name: String
    let sales: Double
    var id: String { categoryId }
}

struct AnaTopCustomer: Identifiable {
    let key: String
    /// Set when the sale goes to someone in the book; their page opens from the row.
    let customerId: String?
    let name: String
    let totalSpent: Double
    let orderCount: Int
    var id: String { key }
}

struct AnaExpenseCategory: Identifiable {
    let category: String
    let amount: Double
    var id: String { category }
}

struct AnaSourceRow: Identifiable {
    let key: String
    let label: String
    let revenue: Double
    let orderCount: Int
    var avgOrderValue: Double { orderCount > 0 ? revenue / Double(orderCount) : 0 }
    var id: String { key }
}

struct AnaSourcePoint: Identifiable {
    let id: String
    let plotDate: Date
    let label: String
    let amount: Double
}

// MARK: The figures

struct AnaFigures {
    /// Invoices (jewellery side, not refunded) and uninvoiced orders in the period: the page says
    /// "Nothing in this range" when both are none.
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

    /// Each sale at its own margin (lib/margin.ts). Owners only: nil margin settings leave it 0.
    var estProfit = 0.0
    var salesCosted = 0
    var salesCount = 0

    // Gold, by weight: grams of gold in the jewellery sold. Coins are not in here.
    var goldGrams = 0.0
    var goldPieces = 0.0
    var goldByKarat: [AnaKarat] = []

    var salesOverTime: [AnaDay] = []
    var invoicesByDay: [String: [Invoice]] = [:]
    var topProducts: [AnaTopProduct] = []
    var salesByCategory: [AnaCategorySale] = []
    var topCustomers: [AnaTopCustomer] = []

    var totalExpenses = 0.0
    var expensesByCategory: [AnaExpenseCategory] = []

    /// Cash flow (cash-in.ts); nil when nothing at all was in the period.
    var cash: ERPCore.CashIn?

    var sourceBreakdown: [AnaSourceRow] = []
    var sourceTrend: [AnaSourcePoint] = []

    /// Coin bills on record (any date) and the coin card over this period.
    var coinInvoiceCount = 0
    var coin = AnaCoins.summarise([])

    var cashIn: Double { cash?.total ?? 0 }
    var cashOut: Double { totalExpenses }
    var netCashFlow: Double { cashIn - totalExpenses }
    var exchangeOffInvoices: Double { cash?.exchangeOffInvoices ?? 0 }
}

extension AnaFigures {
    /// `margin` nil is a non-owner: no margin is worked out for them at all.
    init(_ books: AnaBooks, range: AnaRange?, margin: MarginSettings?) {
        self.init()
        let scope = AnaScope(range: range)
        let ordersById = books.ordersById
        let revenueDate: (Invoice) -> String = { (inv: Invoice) -> String in AnaRules.revenueDate(inv, ordersById) }

        // Coins out, before anything is counted (coins.ts).
        let split = AnaCoins.splitAll(books.invoices)

        let inRange: (Invoice) -> Bool = { (inv: Invoice) -> Bool in
            if inv.status == .refunded { return false }
            return range == nil || (!inv.createdAt.isEmpty && scope.has(revenueDate(inv)))
        }
        let filteredInvoices = split.jewellery.filter(inRange)
        let filteredCoins = split.coins.filter(inRange)
        // An order not invoiced, not closed, and not an online one still waiting for its transfer.
        let filteredOrders = books.orders.filter { (o: Order) -> Bool in bookedAsSale(o) && scope.has(o.createdAt) }
        let filteredExpenses = books.expenses.filter { (e: Expense) -> Bool in scope.has(e.date) }
        let filteredExtra = books.extraRevenue.filter { (r: AdditionalRevenue) -> Bool in scope.has(r.date) }

        invoicesInRange = filteredInvoices.count
        ordersInRange = filteredOrders.count
        coinInvoiceCount = split.coins.count
        coin = AnaCoins.summarise(filteredCoins)

        if filteredInvoices.isEmpty && filteredOrders.isEmpty && filteredExpenses.isEmpty && filteredExtra.isEmpty { return }

        let gather = AnaGather(books: books, margin: margin, revenueDate: revenueDate)
        for inv in filteredInvoices { gather.invoice(inv) }
        for o in filteredOrders { gather.order(o) }
        for r in filteredExtra { gather.extra(r) }
        for e in filteredExpenses { gather.expense(e) }
        gather.finish(into: &self, invoiceCount: filteredInvoices.count, orderCount: filteredOrders.count)

        // Cash IN = invoice payments collected in this period (on ALL invoices: a payment in the range may
        // belong to an invoice written earlier) + cash advances on orders not invoiced yet, each on its own
        // day + gold taken in exchange, which the owner counts as cash. Cash OUT = expenses paid in this period.
        let period = ERPCore.Period(from: range?.from, to: range?.to)
        cash = cashInForPeriod(
            invoices: split.jewellery,
            orders: books.orders,
            invoiced: invoicedOrderIds(books.orders, books.invoices),
            extraRevenues: books.extraRevenue,
            period: period,
            invoiceDate: revenueDate
        )
    }
}

// MARK: Gathering

private struct AnaProductAcc {
    var name: String
    var quantity = 0.0
    var revenue = 0.0
}

private struct AnaCustomerAcc {
    var spent = 0.0
    var count = 0
    let resolvedName: String?
}

private struct AnaSourceAcc {
    var revenue = 0.0
    var count = 0
}

/// One pass over what is in the period. A class so the running totals are not passed around by hand.
private final class AnaGather {
    let books: AnaBooks
    let margin: MarginSettings?
    let revenueDate: (Invoice) -> String
    /// The book's name for a customer id, so a walk-in renamed since to a real person counts as that person.
    let nameOf: (String) -> String?

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
    var karatOrder: [String] = []
    var karats: [String: AnaKarat] = [:]
    var days: [String: AnaDay] = [:]
    var invoicesByDay: [String: [Invoice]] = [:]
    var productOrder: [String] = []
    var products: [String: AnaProductAcc] = [:]
    var categoryOrder: [String] = []
    var categories: [String: Double] = [:]
    var customerOrder: [String] = []
    var customers: [String: AnaCustomerAcc] = [:]
    var sources: [String: AnaSourceAcc] = [:]
    var sourceByDate: [String: [String: Double]] = [:]
    var expenseTotal = 0.0
    var expenseOrder: [String] = []
    var expenseByCategory: [String: Double] = [:]

    init(books: AnaBooks, margin: MarginSettings?, revenueDate: @escaping (Invoice) -> String) {
        self.books = books
        self.margin = margin
        self.revenueDate = revenueDate
        let byId = books.customersById
        nameOf = { (id: String) -> String? in byId[id]?.name }
    }

    // MARK: Sources

    /// A sale's acquisition source: the record's own wins, else the linked customer's saved one, else
    /// unclassified. Invoices carry it on `acquisitionSource`, orders on `source`.
    private func sourceKey(_ recorded: CustomerSource?, _ customerId: String?) -> String {
        if let r = recorded, !r.rawValue.isEmpty { return r.rawValue }
        if let id = customerId, !id.isEmpty, let s = books.customersById[id]?.source, !s.rawValue.isEmpty { return s.rawValue }
        return AnaSources.unclassified
    }

    private func accrueSource(_ key: String, _ day: String, _ amount: Double) {
        sources[key, default: AnaSourceAcc()].revenue += amount
        sources[key, default: AnaSourceAcc()].count += 1
        if !day.isEmpty {
            sourceByDate[day, default: [:]][key, default: 0] += amount
        }
    }

    private func accrueCustomer(_ key: String, _ resolved: String?, _ amount: Double) {
        if customers[key] == nil {
            customerOrder.append(key)
            let named = (resolved ?? "").isEmpty ? nil : resolved
            customers[key] = AnaCustomerAcc(resolvedName: named)
        }
        customers[key]?.spent += amount
        customers[key]?.count += 1
    }

    private func dayKey(_ iso: String) -> String {
        guard let d = AnaDate.parseISO(iso) else { return "" }
        return AnaDate.dayKey(d)
    }

    // MARK: A record at a time

    func invoice(_ inv: Invoice) {
        let value = invoiceSaleValue(inv)
        totalSales += value
        invoiceSales += value
        if let margin {
            // Each sale at its own margin: from the 24k rate typed when it was made, else the house's estimate.
            let m = invoiceMargin(inv, settings: margin)
            estProfit += value * m.percent / 100
            if !m.assumed { costed += 1 }
        }
        counted += 1
        discounts += inv.discountAmount
        unpaid += max(0, inv.balanceDue)

        let key = dayKey(revenueDate(inv))
        if !key.isEmpty {
            days[key, default: AnaDay(date: key)].sales += value
            days[key, default: AnaDay(date: key)].orders += 1
            invoicesByDay[key, default: []].append(inv)
        }
        accrueSource(sourceKey(inv.acquisitionSource, inv.customerId), key, value)
        // The customer, else the stored name (so named customers without a linked account aren't all
        // collapsed into "Walk-in"), else the one walk-in row (walk-in.ts).
        accrueCustomer(saleCustomerKey(inv, currentName: nameOf), inv.customerName, value)

        for item in inv.items { line(item, key) }
    }

    private func line(_ item: InvoiceItem, _ day: String) {
        let quantity = item.quantity
        itemsSold += quantity
        if !day.isEmpty { days[day, default: AnaDay(date: day)].itemsSold += quantity }
        let units = quantity == 0 ? 1.0 : quantity

        // The metal actually sold. A piece with no recorded weight adds nothing rather than a guess.
        if item.metalType == .gold {
            let g = item.metalWeightG * units
            if g > 0 {
                goldGrams += g
                goldPieces += units
                let k = item.karat?.rawValue ?? "unknown"
                if karats[k] == nil {
                    karatOrder.append(k)
                    karats[k] = AnaKarat(karat: k)
                }
                karats[k]?.grams += g
                karats[k]?.pieces += units
            }
        }

        if products[item.sku] == nil {
            productOrder.append(item.sku)
            products[item.sku] = AnaProductAcc(name: item.name)
        }
        products[item.sku]?.quantity += quantity
        products[item.sku]?.revenue += item.itemTotal

        if !item.categoryId.isEmpty {
            if categories[item.categoryId] == nil {
                categoryOrder.append(item.categoryId)
                categories[item.categoryId] = 0
            }
            categories[item.categoryId, default: 0] += item.itemTotal
        }
    }

    /// An uninvoiced order counts at its subtotal, the full order value: grandTotal is that less the
    /// advance, which is still earned.
    func order(_ o: Order) {
        let amount = o.subtotal
        totalSales += amount
        orderSales += amount
        if let margin {
            let m = orderMargin(o, settings: margin)
            estProfit += amount * m.percent / 100
            if !m.assumed { costed += 1 }
        }
        counted += 1

        let key = dayKey(o.createdAt)
        if !key.isEmpty {
            days[key, default: AnaDay(date: key)].sales += amount
            days[key, default: AnaDay(date: key)].orders += 1
        }
        accrueSource(sourceKey(o.source, o.customerId), key, amount)
        accrueCustomer(saleCustomerKey(o, currentName: nameOf), o.customerName, amount)
    }

    func extra(_ r: AdditionalRevenue) {
        totalSales += r.amount
        extraRevenue += r.amount
        if let margin { estProfit += r.amount * margin.assumedMargin }
        let key = dayKey(r.date)
        if !key.isEmpty { days[key, default: AnaDay(date: key)].sales += r.amount }
    }

    /// Every logged expense is cash out; the ones with a category also make the category chart.
    func expense(_ e: Expense) {
        expenseTotal += e.amount
        if !e.category.isEmpty {
            if expenseByCategory[e.category] == nil {
                expenseOrder.append(e.category)
                expenseByCategory[e.category] = 0
            }
            expenseByCategory[e.category, default: 0] += e.amount
        }
    }

    // MARK: Putting it together

    private func customerRow(_ key: String) -> AnaTopCustomer {
        let acc = customers[key] ?? AnaCustomerAcc(resolvedName: nil)
        if key == WALK_IN_ENTITY {
            return AnaTopCustomer(key: key, customerId: nil, name: WALK_IN_NAME, totalSpent: acc.spent, orderCount: acc.count)
        }
        if key.hasPrefix("name:") {
            // A named customer without a linked account: the stored name.
            return AnaTopCustomer(key: key, customerId: nil, name: String(key.dropFirst(5)), totalSpent: acc.spent, orderCount: acc.count)
        }
        let name = AnaText.firstFilled([books.customersById[key]?.name, acc.resolvedName], fallback: WALK_IN_NAME)
        return AnaTopCustomer(key: key, customerId: key, name: name, totalSpent: acc.spent, orderCount: acc.count)
    }

    func finish(into f: inout AnaFigures, invoiceCount: Int, orderCount: Int) {
        let orders = invoiceCount + orderCount
        f.totalSales = totalSales
        f.invoiceSales = invoiceSales
        f.orderSales = orderSales
        f.extraRevenue = extraRevenue
        f.totalUnpaid = unpaid
        f.totalOrders = orders
        f.averageOrderValue = orders > 0 ? (invoiceSales + orderSales) / Double(orders) : 0
        f.averageItemsPerOrder = orders > 0 ? itemsSold / Double(orders) : 0
        f.totalItemsSold = itemsSold
        f.totalDiscounts = discounts
        f.estProfit = estProfit
        f.salesCosted = costed
        f.salesCount = counted
        f.goldGrams = goldGrams
        f.goldPieces = goldPieces
        // Heaviest karat first: what the shop mostly sells leads.
        let karatRows: [AnaKarat] = karatOrder.compactMap { (k: String) -> AnaKarat? in karats[k] }
        f.goldByKarat = AnaSort.descending(karatRows) { (k: AnaKarat) -> Double in k.grams }

        f.salesOverTime = days.keys.sorted().compactMap { (k: String) -> AnaDay? in days[k] }
        f.invoicesByDay = invoicesByDay

        let productRows: [AnaTopProduct] = productOrder.compactMap { (sku: String) -> AnaTopProduct? in
            guard let acc = products[sku] else { return nil }
            let name = AnaText.firstFilled([books.productsBySku[sku]?.name, acc.name], fallback: "Unnamed piece")
            return AnaTopProduct(sku: sku, name: name, quantity: acc.quantity, revenue: acc.revenue)
        }
        f.topProducts = Array(AnaSort.descending(productRows) { (p: AnaTopProduct) -> Double in p.revenue }.prefix(10))

        let categoryRows: [AnaCategorySale] = categoryOrder.map { (id: String) -> AnaCategorySale in
            AnaCategorySale(categoryId: id, name: AnaCategories.title(id), sales: categories[id] ?? 0)
        }
        f.salesByCategory = AnaSort.descending(categoryRows) { (c: AnaCategorySale) -> Double in c.sales }

        let customerRows: [AnaTopCustomer] = customerOrder.map { (k: String) -> AnaTopCustomer in customerRow(k) }
        f.topCustomers = Array(AnaSort.descending(customerRows) { (c: AnaTopCustomer) -> Double in c.totalSpent }.prefix(10))

        f.totalExpenses = expenseTotal
        let expenseRows: [AnaExpenseCategory] = expenseOrder.map { (c: String) -> AnaExpenseCategory in
            AnaExpenseCategory(category: c, amount: expenseByCategory[c] ?? 0)
        }
        f.expensesByCategory = AnaSort.descending(expenseRows) { (e: AnaExpenseCategory) -> Double in e.amount }

        // One row per source that has at least one sale, the real sources leading and Unclassified trailing.
        let activeKeys: [String] = AnaSources.keys.filter { (k: String) -> Bool in (sources[k]?.count ?? 0) > 0 }
        let sourceRows: [AnaSourceRow] = activeKeys.map { (k: String) -> AnaSourceRow in
            AnaSourceRow(key: k, label: AnaSources.label(k), revenue: sources[k]?.revenue ?? 0, orderCount: sources[k]?.count ?? 0)
        }
        f.sourceBreakdown = AnaSort.descending(sourceRows) { (s: AnaSourceRow) -> Double in s.revenue }

        // One value per source per day (chronological), a missing one 0, so the lines stay continuous.
        var trend: [AnaSourcePoint] = []
        for date in sourceByDate.keys.sorted() {
            let plot = AnaDate.plotDate(day: date)
            for k in activeKeys {
                trend.append(AnaSourcePoint(id: date + "|" + k, plotDate: plot, label: AnaSources.label(k),
                                            amount: sourceByDate[date]?[k] ?? 0))
            }
        }
        f.sourceTrend = trend
    }
}

// MARK: The detail tabs

/// Products, Customers and Categories keep a breakdown of their own (components/analytics/*-breakdown.tsx).
/// It counts every invoice that is not refunded, coins included, on the day it was written, not on its
/// order's day; its revenue is each piece's own total, before invoice discounts and trade-ins.
enum AnaBreakdown {
    static func invoices(_ books: AnaBooks, range: AnaRange?) -> [Invoice] {
        let scope = AnaScope(range: range)
        return books.invoices.filter { (inv: Invoice) -> Bool in
            if inv.status == .refunded { return false }
            return range == nil || (!inv.createdAt.isEmpty && scope.has(inv.createdAt))
        }
    }

    struct ProductRow: Identifiable {
        let sku: String
        let name: String
        let quantity: Double
        let revenue: Double
        let orders: Int
        var id: String { sku }
    }

    private struct ProductAcc {
        var quantity = 0.0
        var revenue = 0.0
        var orders = Set<String>()
    }

    static func products(_ books: AnaBooks, range: AnaRange?) -> [ProductRow] {
        var order: [String] = []
        var acc: [String: ProductAcc] = [:]
        for inv in invoices(books, range: range) {
            for item in inv.items where !item.sku.isEmpty {
                if acc[item.sku] == nil {
                    order.append(item.sku)
                    acc[item.sku] = ProductAcc()
                }
                acc[item.sku]?.quantity += item.quantity
                acc[item.sku]?.revenue += item.itemTotal
                _ = acc[item.sku]?.orders.insert(inv.id)
            }
        }
        return order.compactMap { (sku: String) -> ProductRow? in
            guard let a = acc[sku] else { return nil }
            let name = AnaText.firstFilled([books.productsBySku[sku]?.name], fallback: "Unknown piece")
            return ProductRow(sku: sku, name: name, quantity: a.quantity, revenue: a.revenue, orders: a.orders.count)
        }
    }

    struct CustomerRow: Identifiable {
        let key: String
        let customerId: String?
        let name: String
        let totalSpent: Double
        let orderCount: Int
        let itemsPurchased: Double
        var averageSpent: Double { orderCount > 0 ? totalSpent / Double(orderCount) : 0 }
        var id: String { key }
    }

    private struct CustomerAcc {
        var spent = 0.0
        var count = 0
        var items = 0.0
        let resolvedName: String?
    }

    static func customers(_ books: AnaBooks, range: AnaRange?) -> [CustomerRow] {
        let byId = books.customersById
        let nameOf: (String) -> String? = { (id: String) -> String? in byId[id]?.name }
        var order: [String] = []
        var acc: [String: CustomerAcc] = [:]
        for inv in invoices(books, range: range) {
            let key = saleCustomerKey(inv, currentName: nameOf)
            if acc[key] == nil {
                order.append(key)
                let named = inv.customerName.isEmpty ? nil : inv.customerName
                acc[key] = CustomerAcc(resolvedName: named)
            }
            acc[key]?.spent += invoiceSaleValue(inv)
            acc[key]?.count += 1
            var pieces = 0.0
            for item in inv.items { pieces += item.quantity }
            acc[key]?.items += pieces
        }
        return order.compactMap { (key: String) -> CustomerRow? in
            guard let a = acc[key] else { return nil }
            if key == WALK_IN_ENTITY {
                return CustomerRow(key: key, customerId: nil, name: WALK_IN_NAME, totalSpent: a.spent, orderCount: a.count, itemsPurchased: a.items)
            }
            if key.hasPrefix("name:") {
                return CustomerRow(key: key, customerId: nil, name: String(key.dropFirst(5)), totalSpent: a.spent, orderCount: a.count, itemsPurchased: a.items)
            }
            let name = AnaText.firstFilled([byId[key]?.name, a.resolvedName], fallback: WALK_IN_NAME)
            return CustomerRow(key: key, customerId: key, name: name, totalSpent: a.spent, orderCount: a.count, itemsPurchased: a.items)
        }
    }

    struct CategoryRow: Identifiable {
        let id: String
        let name: String
        let revenue: Double
        let itemsSold: Double
        let orders: Int
    }

    private struct CategoryAcc {
        var revenue = 0.0
        var items = 0.0
        var orders = Set<String>()
    }

    static func categories(_ books: AnaBooks, range: AnaRange?) -> [CategoryRow] {
        var order: [String] = []
        var acc: [String: CategoryAcc] = [:]
        for inv in invoices(books, range: range) {
            for item in inv.items {
                let id = item.categoryId.isEmpty ? "uncategorized" : item.categoryId
                if acc[id] == nil {
                    order.append(id)
                    acc[id] = CategoryAcc()
                }
                acc[id]?.items += item.quantity
                acc[id]?.revenue += item.itemTotal
                _ = acc[id]?.orders.insert(inv.id)
            }
        }
        let rows: [CategoryRow] = order.compactMap { (id: String) -> CategoryRow? in
            guard let a = acc[id] else { return nil }
            return CategoryRow(id: id, name: AnaCategories.title(id), revenue: a.revenue, itemsSold: a.items, orders: a.orders.count)
        }
        return AnaSort.descending(rows) { (c: CategoryRow) -> Double in c.revenue }
    }
}

// MARK: Sales: the years and the months

struct AnaYear: Identifiable {
    let year: Int
    let revenue: Double
    let expenses: Double
    let unpaid: Double
    /// The estimated profit; owners only (0 where no margin was worked out).
    let profit: Double
    var netProfit: Double { revenue - expenses }
    var id: Int { year }
}

struct AnaMonth: Identifiable {
    /// "2026-10".
    let key: String
    let plotDate: Date
    let label: String
    let revenue: Double
    let sales: Int
    var id: String { key }
}

/// The Sales tab's two views over the whole history, which the period does not bound: the point of
/// them is the shape of the trend, not a slice of it. Same revenue basis as everywhere: an invoice's
/// sale value (exchange counted) on its order's day, uninvoiced orders at their subtotal, extra revenue.
struct AnaHistory {
    var yearly: [AnaYear] = []
    var months: [AnaMonth] = []
    /// Revenue averaged across the months that had sales.
    var monthlyAverage = 0.0
    /// The month with the most revenue (the first, if tied).
    var bestMonth: String?
}

private struct AnaYearAcc {
    var revenue = 0.0
    var expenses = 0.0
    var unpaid = 0.0
    var profit = 0.0
}

extension AnaHistory {
    init(_ books: AnaBooks, margin: MarginSettings?) {
        self.init()
        let split = AnaCoins.splitAll(books.invoices)
        let ordersById = books.ordersById

        var years: [Int: AnaYearAcc] = [:]
        var buckets: [String: (revenue: Double, sales: Int)] = [:]

        func addMonth(_ iso: String, _ amount: Double) {
            guard let d = AnaDate.parseISO(iso) else { return }
            let key = AnaDate.monthKey(d)
            var cur = buckets[key] ?? (revenue: 0, sales: 0)
            cur.revenue += amount
            cur.sales += 1
            buckets[key] = cur
        }

        for inv in split.jewellery where inv.status != .refunded && !inv.createdAt.isEmpty {
            let date = AnaRules.revenueDate(inv, ordersById)
            guard let d = AnaDate.parseISO(date) else { continue }
            let value = invoiceSaleValue(inv)
            let yr = AnaDate.year(of: d)
            years[yr, default: AnaYearAcc()].revenue += value
            if let margin {
                years[yr, default: AnaYearAcc()].profit += value * invoiceMargin(inv, settings: margin).percent / 100
            }
            years[yr, default: AnaYearAcc()].unpaid += max(0, inv.balanceDue)
            addMonth(date, value)
        }
        for o in books.orders where bookedAsSale(o) {
            guard let d = AnaDate.parseISO(o.createdAt) else { continue }
            let yr = AnaDate.year(of: d)
            years[yr, default: AnaYearAcc()].revenue += o.subtotal
            if let margin {
                years[yr, default: AnaYearAcc()].profit += o.subtotal * orderMargin(o, settings: margin).percent / 100
            }
            addMonth(o.createdAt, o.subtotal)
        }
        for r in books.extraRevenue where !r.date.isEmpty {
            guard let d = AnaDate.parseISO(r.date) else { continue }
            let yr = AnaDate.year(of: d)
            years[yr, default: AnaYearAcc()].revenue += r.amount
            if let margin { years[yr, default: AnaYearAcc()].profit += r.amount * margin.assumedMargin }
            addMonth(r.date, r.amount)
        }
        // Drawings are a distribution of profit, not a cost of earning it.
        for e in books.expenses where !e.date.isEmpty && AnaRules.isBusinessCost(e) {
            guard let d = AnaDate.parseISO(e.date) else { continue }
            years[AnaDate.year(of: d), default: AnaYearAcc()].expenses += e.amount
        }

        let yearRows: [AnaYear] = years.map { (pair: (key: Int, value: AnaYearAcc)) -> AnaYear in
            AnaYear(year: pair.key, revenue: pair.value.revenue, expenses: pair.value.expenses,
                    unpaid: pair.value.unpaid, profit: pair.value.profit)
        }
        yearly = yearRows.sorted { (a: AnaYear, b: AnaYear) -> Bool in a.year > b.year }

        // Walk every month between the first and the last, so a quiet month shows as a gap.
        let keys = buckets.keys.sorted()
        guard let first = keys.first, let last = keys.last else { return }
        var rows: [AnaMonth] = []
        var cursor = first
        var guardCount = 0
        while guardCount < 2400 {
            guardCount += 1
            let b = buckets[cursor]
            let plot = AnaDate.plotDate(month: cursor)
            rows.append(AnaMonth(key: cursor, plotDate: plot, label: AnaDate.monthShort(plot),
                                 revenue: b?.revenue ?? 0, sales: b?.sales ?? 0))
            if cursor >= last { break }
            cursor = AnaHistory.nextMonth(cursor)
        }
        months = rows

        let withRevenue = rows.filter { (m: AnaMonth) -> Bool in m.revenue > 0 }
        var sum = 0.0
        for m in withRevenue { sum += m.revenue }
        monthlyAverage = withRevenue.isEmpty ? 0 : sum / Double(withRevenue.count)
        var best: AnaMonth?
        for m in rows {
            if let b = best {
                if m.revenue > b.revenue { best = m }
            } else {
                best = m
            }
        }
        bestMonth = best?.key
    }

    /// "2026-12" -> "2027-01".
    fileprivate static func nextMonth(_ key: String) -> String {
        let parts = key.split(separator: "-")
        guard parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]) else { return key + "x" }
        let ny = m == 12 ? y + 1 : y
        let nm = m == 12 ? 1 : m + 1
        return String(format: "%04d-%02d", ny, nm)
    }
}
