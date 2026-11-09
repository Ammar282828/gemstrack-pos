// Ported from src/lib/analytics/books.ts (tests: BooksTests, from books.test.ts).
//
// The shop's books for a period: every figure Analytics shows, worked out in one place, so the Overview and its
// pages read the same numbers. Pure functions of their inputs. Every money rule is the one the owner already settled:
//
//  - coins apart from everything (CoinSales.swift), shown only in `coinSummary`;
//  - a sale is worth `invoiceSaleValue` (exchange added back), on its order's date (`getInvoiceRevenueDate`);
//  - a sale at its own margin (Margin.swift), extra revenue at the assumed one;
//  - an order counts as a sale only while `bookedAsSale` (not yet an invoice, not cancelled, not awaiting a transfer);
//  - profit before running costs is `NetProfit.beforeRunning` (revenue less goods where the house records them),
//    net profit that less the running costs only;
//  - cash in is `cashInForPeriod`; credit handed back is shown as money out and added back to money in.
//
// Cash is always worked out, even in a period with no sale (a payment on an older bill still lands).
// Metal weight counts the house's metal (`BooksOptions.metal`), not only gold.
//
// Days are Karachi's, as for every date in ERPCore; a zoneless date-time is read as Karachi's clock.

import Foundation

// MARK: - Types

public struct BooksInput {
    public var invoices: [Invoice]
    public var orders: [Order]
    public var products: [Product]
    public var customers: [Customer]
    public var expenses: [Expense]
    public var additionalRevenues: [AdditionalRevenue]
    /// Category titles by id where the store has more than the built-in list (`categoryTitle` is the fallback).
    public var categoryTitles: [String: String]

    public init(invoices: [Invoice] = [], orders: [Order] = [], products: [Product] = [], customers: [Customer] = [],
                expenses: [Expense] = [], additionalRevenues: [AdditionalRevenue] = [], categoryTitles: [String: String] = [:]) {
        self.invoices = invoices
        self.orders = orders
        self.products = products
        self.customers = customers
        self.expenses = expenses
        self.additionalRevenues = additionalRevenues
        self.categoryTitles = categoryTitles
    }
}

/// The house's own settings the books read: what the TS takes from `STORE_CONFIG` and the environment.
public struct BooksOptions {
    /// "Today", for tests and for a screen that wants one clock.
    public var now: Date
    /// The metal whose weight counts as "metal sold": "gold" or "silver".
    public var metal: String
    public var margin: MarginSettings
    /// The house's goods categories (Mina's stock and karigars); none at Taheri.
    public var goods: [String]
    /// The house files its goods as expenses, so profit is revenue less goods (Mina). Defaults to "has goods categories".
    public var recordsGoods: Bool
    /// Gold apart from silver (descriptor `goldApartMargin`, a percent; nil: off, as Taheri).
    public var goldApartMargin: Double?

    public init(now: Date = Date(), metal: String = "gold", margin: MarginSettings = .default, goods: [String] = [], recordsGoods: Bool? = nil, goldApartMargin: Double? = nil) {
        self.now = now
        self.metal = metal
        self.margin = margin
        self.goods = goods
        self.recordsGoods = recordsGoods ?? !goods.isEmpty
        self.goldApartMargin = goldApartMargin
    }
}

public enum ExpenseKind: String, CaseIterable, Equatable {
    case running, goods, drawings
}

public struct SalesDay: Equatable, Identifiable {
    /// yyyy-MM-dd
    public let date: String
    public var sales: Double
    public var orders: Int
    public var itemsSold: Double
    /// Of `sales`, gold (GoldApart).
    public var gold: Double = 0
    public var id: String { date }
}

public struct TopProduct: Equatable, Identifiable {
    public let sku: String
    public let name: String
    public let quantity: Double
    public let revenue: Double
    public var id: String { sku }
}

public struct CategorySale: Equatable, Identifiable {
    public let categoryId: String
    public let categoryName: String
    public let sales: Double
    public var id: String { categoryId }
}

public struct TopCustomer: Equatable, Identifiable {
    public let key: String
    public let customerId: String?
    public let customerName: String
    public let totalSpent: Double
    public let orderCount: Int
    public var id: String { key }
}

public struct ExpenseByCategory: Equatable, Identifiable {
    public let category: String
    public let amount: Double
    public let kind: ExpenseKind
    public var id: String { category }
}

public struct SourceRow: Equatable, Identifiable {
    public let key: String
    public let label: String
    public let revenue: Double
    public let orderCount: Int
    public let avgOrderValue: Double
    public var id: String { key }
}

/// One day of revenue by source (every active source present, missing ones 0).
public struct SourceTrendPoint: Equatable, Identifiable {
    public let date: String
    public let values: [String: Double]
    public var id: String { date }
}

/// One weekday's average (Monday = 0 ... Sunday = 6).
public struct WeekdayRow: Equatable, Identifiable {
    public let weekday: Int
    public let label: String
    public let revenue: Double
    /// How many of that weekday the period holds (days with no sale count as 0 in the average).
    public let days: Int
    public let avg: Double
    /// Sales (invoices and orders) on that weekday.
    public let count: Int
    public var id: Int { weekday }
}

public struct ReceivableRow: Equatable, Identifiable {
    /// The invoice id; its page is `/invoices/<id>`.
    public let id: String
    public let customerName: String
    public let customerId: String?
    /// The day it counts for (its order's date when made from one).
    public let date: String
    /// Jewellery and coin part together.
    public var balanceDue: Double
    /// Of which on coins.
    public var coinDue: Double
}

public struct ExpenseRow: Equatable, Identifiable {
    public let id: String
    public let date: String
    public let category: String
    public let description: String
    public let amount: Double
    public let kind: ExpenseKind
}

public struct MetalKaratRow: Equatable, Identifiable {
    public let karat: String
    public let grams: Double
    public let pieces: Double
    public var id: String { karat }
}

/// Customers who bought on one day, split by whether that was their first-ever sale.
public struct CustomerDay: Equatable {
    public let date: String
    public var newKeys: [String]
    public var returningKeys: [String]
}

public struct RevenueMixRow: Equatable, Identifiable {
    /// "invoices", "orders" or "extra".
    public let key: String
    public let label: String
    public let value: Double
    public var id: String { key }
}

public struct Books {
    // Revenue (jewellery only; coins apart)
    public var totalSales = 0.0
    /// Of `totalSales`, the gold pieces' (GoldApart); the rest is the house's own metal and extra revenue.
    public var goldRevenue = 0.0
    /// `totalSales` less `goldRevenue`.
    public var silverRevenue = 0.0
    /// Gold's estimated profit at the house's margin where gold is apart, else 0: a caption beside gold revenue, never added into any profit.
    public var goldProfit = 0.0
    public var invoiceSales = 0.0
    public var orderSales = 0.0
    public var extraRevenue = 0.0
    public var totalUnpaid = 0.0
    /// Invoices plus uninvoiced orders (extra revenue is not an order).
    public var totalOrders = 0
    public var averageOrderValue = 0.0
    public var totalItemsSold = 0.0
    public var totalDiscounts = 0.0
    public var averageItemsPerOrder = 0.0
    // What was earned
    /// Each sale at its own margin, before the house's goods are looked at.
    public var estProfit = 0.0
    public var salesCosted = 0
    public var salesCount = 0
    /// Profit before running costs (Mina: revenue less goods, Gross profit).
    public var estProfitAdj = 0.0
    /// Revenue less `estProfitAdj`: what the pieces cost (estimated at Taheri, goods bought at Mina).
    public var costOfPieces = 0.0
    /// `estProfitAdj` less the running costs only.
    public var netProfit = 0.0
    /// In percent of revenue.
    public var netMargin = 0.0
    // Metal, by weight (the house's metal; coins are not in here)
    public var metalGrams = 0.0
    public var metalPieces = 0.0
    /// Heaviest karat first.
    public var metalByKarat: [MetalKaratRow] = []
    // Series and rankings
    public var salesOverTime: [SalesDay] = []
    public var topProductsByRevenue: [TopProduct] = []
    public var topProductsByQuantity: [TopProduct] = []
    public var salesByCategory: [CategorySale] = []
    public var topCustomers: [TopCustomer] = []
    public var byWeekday: [WeekdayRow] = []
    /// Invoices / orders not invoiced yet / extra revenue, in that order, zeros kept.
    public var revenueMix: [RevenueMixRow] = []
    // Expenses
    public var totalExpenses = 0.0
    public var runningExpenses = 0.0
    public var goodsExpenses = 0.0
    /// Neither running costs nor goods: the partners' drawings.
    public var drawingsExpenses = 0.0
    public var expensesByCategory: [ExpenseByCategory] = []
    /// The ten biggest single expenses of the period.
    public var largestExpenses: [ExpenseRow] = []
    // Cash flow
    public var cashIn = 0.0
    public var cashInFromInvoicePayments = 0.0
    public var cashInFromOrderAdvances = 0.0
    public var cashInFromExtraRevenue = 0.0
    public var cashInFromExchange = 0.0
    public var exchangeOffInvoices = 0.0
    public var cashOut = 0.0
    public var cashOutRunning = 0.0
    public var cashOutGoods = 0.0
    public var cashOutDrawings = 0.0
    public var creditPaidBack = 0.0
    public var netCashFlow = 0.0
    /// Revenue less the cash that came in on it: what is still to collect (exchange off a bill is not revenue).
    public var accrualVsCashGap = 0.0
    // Who still owes (this period's sales, largest first)
    public var receivables: [ReceivableRow] = []
    public var receivablesTotal = 0.0
    // Customers
    public var newCustomers = 0
    public var returningCustomers = 0
    public var revenueFromNew = 0.0
    public var revenueFromReturning = 0.0
    public var customerDays: [CustomerDay] = []
    // Acquisition source
    public var sourceBreakdown: [SourceRow] = []
    public var sourceTrend: [SourceTrendPoint] = []
    public var sourceActiveKeys: [String] = []
    // Coins, apart
    public var coinSummary = summariseCoins([])
    /// The house has coin sales at all (any period).
    public var hasCoins = false
    // The period itself
    /// Jewellery invoices in the period.
    public var invoices: [Invoice] = []
    /// The same invoices by the day they count for (yyyy-MM-dd).
    public var invoicesByDay: [String: [Invoice]] = [:]
    /// A range was chosen and holds no invoice and no order.
    public var rangeEmpty = false

    public func expenseKind(_ kind: ExpenseKind) -> Double {
        switch kind {
        case .running: return runningExpenses
        case .goods: return goodsExpenses
        case .drawings: return drawingsExpenses
        }
    }
}

// MARK: - Sources

public let UNCLASSIFIED_KEY = "unclassified"
public let SOURCE_KEYS: [String] = customerSources + [UNCLASSIFIED_KEY]
public func sourceLabel(_ key: String) -> String { customerSourceLabel(key) ?? "Unclassified" }

// MARK: - Karachi's calendar (date-fns, in the shop's zone)

enum BooksCal {
    static let cal: Calendar = ERPDate.karachiCalendar

    static func startOfDay(_ d: Date) -> Date { JS.karachiStartOfDay(d) }
    static func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d) ?? d }
    static func addMonths(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .month, value: n, to: d) ?? d }
    static func addYears(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .year, value: n, to: d) ?? d }
    /// date-fns `endOfDay`: the last millisecond of the day.
    static func endOfDay(_ d: Date) -> Date { addDays(startOfDay(d), 1).addingTimeInterval(-0.001) }
    static func startOfMonth(_ d: Date) -> Date { cal.date(from: cal.dateComponents([.year, .month], from: d)) ?? startOfDay(d) }
    static func endOfMonth(_ d: Date) -> Date { endOfDay(addDays(startOfMonth(addMonths(d, 1)), -1)) }
    static func year(_ d: Date) -> Int { cal.component(.year, from: d) }
    static func month(_ d: Date) -> Int { cal.component(.month, from: d) }
    static func dayOfMonth(_ d: Date) -> Int { cal.component(.day, from: d) }
    /// Monday = 0 ... Sunday = 6.
    static func weekdayIndex(_ d: Date) -> Int { (cal.component(.weekday, from: d) + 5) % 7 }
    /// date-fns `startOfWeek(d, { weekStartsOn: 1 })`.
    static func startOfWeek(_ d: Date) -> Date { addDays(startOfDay(d), -weekdayIndex(d)) }
    static func dayKey(_ d: Date) -> String { ERPDate.karachiDay(d) }
    static func monthKey(_ d: Date) -> String { String(format: "%04d-%02d", year(d), month(d)) }

    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    static let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    /// "Nov 4"
    static func monthDay(_ d: Date) -> String { "\(months[month(d) - 1]) \(dayOfMonth(d))" }
    /// "Tue, Nov 4"
    static func weekdayMonthDay(_ d: Date) -> String { "\(weekdays[weekdayIndex(d)]), \(monthDay(d))" }
    /// "Nov 26"
    static func monthYear(_ d: Date) -> String { String(format: "%@ %02d", months[month(d) - 1], year(d) % 100) }
    /// "November 2026"
    static func longMonthYear(_ d: Date) -> String { "\(longMonths[month(d) - 1]) \(year(d))" }

    /// date-fns `eachMonthOfInterval`: the first of every month from `start`'s through `end`'s.
    static func eachMonth(from start: Date, to end: Date) -> [Date] {
        var out: [Date] = []
        var m = startOfMonth(start)
        while m <= end {
            out.append(m)
            m = addMonths(m, 1)
        }
        return out
    }
}

private func ms(_ d: Date) -> Int64 { JS.ms(d) }
private func date(fromMs t: Int64) -> Date { Date(timeIntervalSince1970: Double(t) / 1000) }

/// A running `Object.entries` that keeps the order keys first arrived in (the sorts below are stable on it).
struct OrderedSums<V> {
    private(set) var keys: [String] = []
    private var dict: [String: V] = [:]

    subscript(key: String) -> V? {
        get { dict[key] }
        set {
            guard let value = newValue else { return }
            if dict[key] == nil { keys.append(key) }
            dict[key] = value
        }
    }

    var entries: [(key: String, value: V)] { keys.map { (key: $0, value: dict[$0]!) } }
}

private func nonEmpty(_ options: [String?], fallback: String) -> String {
    for o in options { if let o, !o.isEmpty { return o } }
    return fallback
}

// MARK: - The shared preparation

private struct Dated<T> {
    let item: T
    /// Instant in milliseconds; nil when the date does not read.
    let t: Int64?
    let date: Date?
}

private func timeOf(_ iso: String?) -> (t: Int64?, date: Date?) {
    guard let iso, !iso.isEmpty, let d = JS.parseISO(iso) else { return (nil, nil) }
    return (ms(d), d)
}

/// Everything that does not depend on the period, worked out once so a year of months does not redo it.
struct BooksPrepared {
    fileprivate let input: BooksInput
    fileprivate let opts: BooksOptions
    var now: Date { opts.now }
    fileprivate let ordersById: [String: Order]
    fileprivate let customersById: [String: Customer]
    fileprivate let productsBySku: [String: Product]
    fileprivate let jewellery: [Dated<Invoice>]
    fileprivate let coins: [Dated<Invoice>]
    fileprivate let orders: [Dated<Order>]
    fileprivate let expenses: [Dated<Expense>]
    fileprivate let extras: [Dated<AdditionalRevenue>]
    fileprivate let invoiced: Set<String>
    /// Customer key -> time of the customer's first-ever sale, walk-ins excluded.
    fileprivate let firstSale: [String: Int64]
}

func prepareBooks(_ input: BooksInput, _ opts: BooksOptions) -> BooksPrepared {
    var ordersById: [String: Order] = [:]
    for o in input.orders { ordersById[o.id] = o }
    var customersById: [String: Customer] = [:]
    for c in input.customers { customersById[c.id] = c }
    var productsBySku: [String: Product] = [:]
    for p in input.products where productsBySku[p.sku] == nil { productsBySku[p.sku] = p }

    let split = splitAllCoinSales(input.invoices)
    let revenueTime: (Invoice) -> (t: Int64?, date: Date?) = { inv in
        timeOf(getInvoiceRevenueDate(inv, ordersById: ordersById))
    }
    func dated(_ list: [Invoice]) -> [Dated<Invoice>] {
        var out: [Dated<Invoice>] = []
        for inv in list where !inv.createdAt.isEmpty && inv.status != .refunded {
            let r = revenueTime(inv)
            if r.t != nil { out.append(Dated(item: inv, t: r.t, date: r.date)) }
        }
        return out
    }

    // The first time each named customer bought anything: any invoice (coins too) or order that counts as a sale.
    var firstSale: [String: Int64] = [:]
    let nameOf: (String) -> String? = { customersById[$0]?.name }
    func seen(_ key: String, _ t: Int64?) {
        guard let t, key != WALK_IN_ENTITY else { return }
        if let prev = firstSale[key], prev <= t { return }
        firstSale[key] = t
    }
    for inv in input.invoices where !inv.createdAt.isEmpty && inv.status != .refunded {
        seen(saleCustomerKey(inv, currentName: nameOf), revenueTime(inv).t)
    }
    for o in input.orders where bookedAsSale(o) {
        seen(saleCustomerKey(o, currentName: nameOf), timeOf(o.createdAt).t)
    }

    var orders: [Dated<Order>] = []
    for o in input.orders where bookedAsSale(o) {
        let r = timeOf(o.createdAt)
        if r.t != nil { orders.append(Dated(item: o, t: r.t, date: r.date)) }
    }
    var extras: [Dated<AdditionalRevenue>] = []
    for e in input.additionalRevenues where !e.date.isEmpty {
        let r = timeOf(e.date)
        if r.t != nil { extras.append(Dated(item: e, t: r.t, date: r.date)) }
    }

    return BooksPrepared(
        input: input, opts: opts, ordersById: ordersById, customersById: customersById, productsBySku: productsBySku,
        jewellery: dated(split.jewellery), coins: dated(split.coins), orders: orders,
        expenses: input.expenses.map { e in let r = timeOf(e.date); return Dated(item: e, t: r.t, date: r.date) },
        extras: extras, invoiced: invoicedOrderIds(input.orders, input.invoices), firstSale: firstSale
    )
}

private struct Bounds {
    let start: Int64?
    let end: Int64?
    let cashFrom: Date?
    let cashTo: Date?
}

/// The period as the old page read it: no `from` is all time; no `to` runs to today.
private func boundsOf(_ range: Period?, _ now: Date) -> Bounds {
    let from = range?.from.map { BooksCal.startOfDay($0) }
    let to: Date? = range?.to.map { BooksCal.endOfDay($0) } ?? (range?.from != nil ? BooksCal.endOfDay(now) : nil)
    return Bounds(start: from.map(ms), end: from != nil ? to.map(ms) : nil, cashFrom: from, cashTo: to)
}

private func inside(_ t: Int64?, _ start: Int64?, _ end: Int64?) -> Bool {
    guard let start else { return true }
    guard let t, let end else { return false }
    return t >= start && t <= end
}

private func expenseKind(_ category: String?, _ goods: [String]) -> ExpenseKind {
    if NetProfit.isRunningCost(category: category, goods: goods) { return .running }
    return NetProfit.isGoodsExpense(category: category, goods: goods) ? .goods : .drawings
}

/// Payment dates are read as the rest of the page reads them (parseISO); an open period holds everything.
private func paymentInPeriod(_ iso: String, _ from: Date?, _ to: Date?) -> Bool {
    if from == nil && to == nil { return true }
    guard let t = JS.parseISO(iso).map(JS.ms) else { return false }
    return (from.map { t >= JS.ms($0) } ?? true) && (to.map { t <= JS.ms($0) } ?? true)
}

// MARK: - The books for a period

/// Every figure Analytics shows for `range` (see the file comment for the rules).
public func computeBooks(_ input: BooksInput, range: Period? = nil, options: BooksOptions = BooksOptions()) -> Books {
    computeBooks(prepareBooks(input, options), range)
}

private final class DayAcc {
    var sales = 0.0
    var orders = 0
    var itemsSold = 0.0
    var gold = 0.0
}

func computeBooks(_ p: BooksPrepared, _ range: Period?) -> Books {
    let b = boundsOf(range, p.now)
    let start = b.start, end = b.end
    let filteredInvoices = p.jewellery.filter { inside($0.t, start, end) }
    let filteredCoinInvoices = p.coins.filter { inside($0.t, start, end) }
    let filteredOrders = p.orders.filter { inside($0.t, start, end) }
    let filteredExpenses = p.expenses.filter { inside($0.t, start, end) }.map { $0.item }
    let filteredExtras = p.extras.filter { inside($0.t, start, end) }

    let customersById = p.customersById
    let nameOf: (String) -> String? = { customersById[$0]?.name }
    let margin = p.opts.margin
    let goods = p.opts.goods

    // Invoices carry the channel on `acquisitionSource` (the bare `source` is Shopify's); orders on `source`. An
    // explicit one wins, else the linked customer's saved source.
    func resolveSource(_ rec: CustomerSource?, _ customerId: String?) -> String {
        if let r = rec, !r.rawValue.isEmpty { return r.rawValue }
        if let id = customerId, !id.isEmpty, let s = customersById[id]?.source, !s.rawValue.isEmpty { return s.rawValue }
        return UNCLASSIFIED_KEY
    }
    var sourceAgg: [String: (revenue: Double, count: Int)] = [:]
    var sourceByDate: [String: [String: Double]] = [:]
    func accrueSource(_ key: String, _ dateKey: String, _ amount: Double) {
        var a = sourceAgg[key] ?? (0, 0)
        a.revenue += amount
        a.count += 1
        sourceAgg[key] = a
        sourceByDate[dateKey, default: [:]][key, default: 0] += amount
    }

    var totalSales = 0.0, invoiceSalesAcc = 0.0, goldRevenue = 0.0
    var estProfit = 0.0, salesCosted = 0, salesCount = 0
    var totalItemsSold = 0.0
    var metalGrams = 0.0, metalPieces = 0.0
    var metalByKarat = OrderedSums<(grams: Double, pieces: Double)>()
    var totalDiscounts = 0.0, totalUnpaid = 0.0
    var salesByDate: [String: DayAcc] = [:]
    var productPerformance = OrderedSums<(quantity: Double, revenue: Double, name: String)>()
    var categoryPerformance = OrderedSums<Double>()
    var customerPerformance = OrderedSums<(spent: Double, count: Int, resolvedName: String?)>()
    var weekdayCount = [Int](repeating: 0, count: 7)
    var customerDay: [String: [String]] = [:]
    var invoicesByDay: [String: [Invoice]] = [:]
    func day(_ k: String) -> DayAcc {
        if let d = salesByDate[k] { return d }
        let d = DayAcc()
        salesByDate[k] = d
        return d
    }
    func seenOnDay(_ dateKey: String, _ customerKey: String) {
        guard customerKey != WALK_IN_ENTITY else { return }
        if !(customerDay[dateKey] ?? []).contains(customerKey) { customerDay[dateKey, default: []].append(customerKey) }
    }
    func accrueCustomer(_ key: String, _ resolved: String?, _ amount: Double) {
        var c = customerPerformance[key] ?? (0, 0, (resolved ?? "").isEmpty ? nil : resolved)
        c.spent += amount
        c.count += 1
        customerPerformance[key] = c
    }

    for entry in filteredInvoices {
        let invoice = entry.item
        let invAmount = invoiceSaleValue(invoice)
        totalSales += invAmount
        let invGold = GoldApart.invoiceGoldPart(invoice, invAmount)
        goldRevenue += invGold
        invoiceSalesAcc += invAmount
        let invMargin = invoiceMargin(invoice, settings: margin)
        estProfit += invAmount * invMargin.percent / 100
        salesCount += 1
        if !invMargin.assumed { salesCosted += 1 }
        totalDiscounts += invoice.discountAmount.isNaN ? 0 : invoice.discountAmount
        totalUnpaid += max(0, invoice.balanceDue.isNaN ? 0 : invoice.balanceDue)

        let revenueDate = BooksCal.startOfDay(entry.date ?? Date())
        let dateKey = BooksCal.dayKey(revenueDate)
        let d = day(dateKey)
        d.sales += invAmount
        d.gold += invGold
        d.orders += 1
        weekdayCount[BooksCal.weekdayIndex(revenueDate)] += 1
        invoicesByDay[dateKey, default: []].append(invoice)

        accrueSource(resolveSource(invoice.acquisitionSource, invoice.customerId), dateKey, invAmount)

        // The customer, else the stored name (so named customers without a linked account are not all collapsed into
        // "Walk-in"), else the one walk-in row (walk-in.ts).
        let customerKey = saleCustomerKey(invoice, currentName: nameOf)
        accrueCustomer(customerKey, invoice.customerName, invAmount)
        seenOnDay(dateKey, customerKey)

        for item in invoice.items {
            let quantity = item.quantity.isNaN ? 0 : item.quantity
            let itemTotal = item.itemTotal.isNaN ? 0 : item.itemTotal
            totalItemsSold += quantity
            d.itemsSold += quantity

            // The metal actually sold. A piece with no recorded weight adds nothing rather than a guess.
            if item.metalType.rawValue == p.opts.metal {
                let units = quantity == 0 ? 1.0 : quantity
                let g = (item.metalWeightG.isNaN ? 0 : item.metalWeightG) * units
                if g > 0 {
                    metalGrams += g
                    metalPieces += units
                    let k = nonEmpty([item.karat?.rawValue], fallback: "unknown")
                    var cur = metalByKarat[k] ?? (0, 0)
                    cur.grams += g
                    cur.pieces += units
                    metalByKarat[k] = cur
                }
            }

            var prod = productPerformance[item.sku] ?? (0, 0, item.name)
            prod.quantity += quantity
            prod.revenue += itemTotal
            productPerformance[item.sku] = prod

            // Its own category, else its order's, else its name's (categories.ts lineCategory).
            if let cat = lineCategory(categoryId: item.categoryId, itemCategory: item.itemCategory, name: item.name) {
                categoryPerformance[cat] = (categoryPerformance[cat] ?? 0) + itemTotal
            }
        }
    }

    // Uninvoiced orders into revenue at the subtotal (the full order value: grandTotal is that less the advance,
    // which is still earned income).
    var orderSales = 0.0
    for entry in filteredOrders {
        let order = entry.item
        let amount = order.subtotal.isNaN ? 0 : order.subtotal
        totalSales += amount
        orderSales += amount
        let ordGold = GoldApart.orderGoldPart(order, amount)
        goldRevenue += ordGold
        let ordMargin = orderMargin(order, settings: margin)
        estProfit += amount * ordMargin.percent / 100
        salesCount += 1
        if !ordMargin.assumed { salesCosted += 1 }

        let orderDate = BooksCal.startOfDay(entry.date ?? Date())
        let dateKey = BooksCal.dayKey(orderDate)
        let d = day(dateKey)
        d.sales += amount
        d.gold += ordGold
        d.orders += 1
        weekdayCount[BooksCal.weekdayIndex(orderDate)] += 1

        accrueSource(resolveSource(order.source, order.customerId), dateKey, amount)

        let customerKey = saleCustomerKey(order, currentName: nameOf)
        accrueCustomer(customerKey, order.customerName, amount)
        seenOnDay(dateKey, customerKey)
    }

    // Extra revenue, before salesOverTime is read so it shows in the chart.
    var extraRevenue = 0.0
    for entry in filteredExtras {
        let amount = entry.item.amount.isNaN ? 0 : entry.item.amount
        totalSales += amount
        extraRevenue += amount
        estProfit += amount * margin.assumedMargin
        day(BooksCal.dayKey(BooksCal.startOfDay(entry.date ?? Date()))).sales += amount
    }

    let totalOrders = filteredInvoices.count + filteredOrders.count
    let orderRevenueTotal = invoiceSalesAcc + orderSales

    // Expenses
    var totalExpenses = 0.0, runningExpenses = 0.0, goodsExpenses = 0.0
    var expenseByCategory = OrderedSums<Double>()
    for e in filteredExpenses {
        let amount = e.amount.isNaN ? 0 : e.amount
        totalExpenses += amount
        if NetProfit.isRunningCost(e, goods: goods) { runningExpenses += amount }
        else if NetProfit.isGoodsExpense(e, goods: goods) { goodsExpenses += amount }
        if !e.category.isEmpty { expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + amount }
    }
    let drawingsExpenses = totalExpenses - runningExpenses - goodsExpenses
    let expensesByCategory = expenseByCategory.entries
        .map { ExpenseByCategory(category: $0.key, amount: $0.value, kind: expenseKind($0.key, goods)) }
        .jsSorted { $1.amount - $0.amount }
    let largestExpenses = Array(filteredExpenses.jsSorted { $1.amount - $0.amount }.prefix(10)).map {
        ExpenseRow(id: $0.id, date: $0.date, category: $0.category, description: $0.description, amount: $0.amount.isNaN ? 0 : $0.amount,
                   kind: expenseKind($0.category, goods))
    }

    let salesOverTime = salesByDate
        .map { SalesDay(date: $0.key, sales: $0.value.sales, orders: $0.value.orders, itemsSold: $0.value.itemsSold, gold: $0.value.gold) }
        .sorted { $0.date < $1.date }

    let productRows = productPerformance.entries.map { e in
        TopProduct(sku: e.key, name: nonEmpty([p.productsBySku[e.key]?.name, e.value.name], fallback: "Unnamed piece"),
                   quantity: e.value.quantity, revenue: e.value.revenue)
    }
    let topProductsByRevenue = Array(productRows.jsSorted { $1.revenue - $0.revenue }.prefix(10))
    let topProductsByQuantity = Array(productRows.jsSorted { $1.quantity - $0.quantity }.prefix(10))

    let salesByCategory = categoryPerformance.entries
        .map { e -> CategorySale in
            let title = p.input.categoryTitles[e.key] ?? categoryTitle(e.key)
            return CategorySale(categoryId: e.key, categoryName: nonEmpty([title], fallback: "Uncategorized"), sales: e.value)
        }
        .jsSorted { $1.sales - $0.sales }

    let topCustomers = Array(customerPerformance.entries.map { e -> TopCustomer in
        let key = e.key, data = e.value
        if key == WALK_IN_ENTITY {
            return TopCustomer(key: key, customerId: nil, customerName: WALK_IN_NAME, totalSpent: data.spent, orderCount: data.count)
        }
        if key.hasPrefix("name:") {
            // A named customer without a linked account: the stored name directly.
            return TopCustomer(key: key, customerId: nil, customerName: String(key.dropFirst(5)), totalSpent: data.spent, orderCount: data.count)
        }
        // A linked customer: the current name from the book.
        return TopCustomer(key: key, customerId: key,
                           customerName: nonEmpty([customersById[key]?.name, data.resolvedName], fallback: WALK_IN_NAME),
                           totalSpent: data.spent, orderCount: data.count)
    }.jsSorted { $1.totalSpent - $0.totalSpent }.prefix(10))

    // New and returning: a named customer is new when their first-ever sale falls in the period.
    var newCustomers = 0, returningCustomers = 0, revenueFromNew = 0.0, revenueFromReturning = 0.0
    for e in customerPerformance.entries where e.key != WALK_IN_ENTITY {
        let first = p.firstSale[e.key]
        let isNew = start == nil || (first != nil && first! >= start!)
        if isNew { newCustomers += 1; revenueFromNew += e.value.spent } else { returningCustomers += 1; revenueFromReturning += e.value.spent }
    }
    let customerDays: [CustomerDay] = customerDay.keys.sorted().map { dateKey in
        var row = CustomerDay(date: dateKey, newKeys: [], returningKeys: [])
        for key in customerDay[dateKey] ?? [] {
            if let first = p.firstSale[key], BooksCal.dayKey(date(fromMs: first)) == dateKey { row.newKeys.append(key) }
            else { row.returningKeys.append(key) }
        }
        return row
    }

    // By weekday: the average over the weekdays the period holds, quiet days counted as 0.
    let spanStart: Date? = start.map(date(fromMs:)) ?? salesOverTime.first.flatMap { JS.parseISO($0.date) }
    let spanEndRaw: Date? = end.map(date(fromMs:)) ?? salesOverTime.last.flatMap { JS.parseISO($0.date) }
    let spanEnd: Date? = spanEndRaw.map { $0 > p.now ? p.now : $0 }
    var weekdayDays = [Int](repeating: 0, count: 7)
    if let s = spanStart, let e = spanEnd {
        var d = BooksCal.startOfDay(s)
        while d <= e {
            weekdayDays[BooksCal.weekdayIndex(d)] += 1
            d = BooksCal.addDays(d, 1)
        }
    }
    var weekdayRevenue = [Double](repeating: 0, count: 7)
    for row in salesOverTime {
        if let d = JS.parseISO(row.date) { weekdayRevenue[BooksCal.weekdayIndex(d)] += row.sales }
    }
    let byWeekday = BooksCal.weekdays.enumerated().map { i, label in
        WeekdayRow(weekday: i, label: label, revenue: weekdayRevenue[i], days: weekdayDays[i],
                   avg: weekdayDays[i] > 0 ? weekdayRevenue[i] / Double(weekdayDays[i]) : 0, count: weekdayCount[i])
    }

    // Acquisition source: the canonical order, the real sources leading and Unclassified trailing.
    let sourceActiveKeys = SOURCE_KEYS.filter { (sourceAgg[$0]?.count ?? 0) > 0 }
    let sourceBreakdown = sourceActiveKeys.map { key -> SourceRow in
        let agg = sourceAgg[key]!
        return SourceRow(key: key, label: sourceLabel(key), revenue: agg.revenue, orderCount: agg.count,
                         avgOrderValue: agg.count > 0 ? agg.revenue / Double(agg.count) : 0)
    }.jsSorted { $1.revenue - $0.revenue }
    // One row per date (chronological) with a value for every active source, missing keys 0 so lines stay continuous.
    let sourceTrend = sourceByDate.keys.sorted().map { dateKey -> SourceTrendPoint in
        var values: [String: Double] = [:]
        for key in sourceActiveKeys { values[key] = sourceByDate[dateKey]?[key] ?? 0 }
        return SourceTrendPoint(date: dateKey, values: values)
    }

    // Cash flow.
    // In: invoice payments collected in the period (on ALL invoices: a payment may belong to an older bill), cash
    // advances on orders not invoiced yet, gold taken in exchange (which the owner counts as cash) and extra revenue.
    // Out: every expense paid in the period. Credit handed back is a negative payment on its invoice, so cash-in nets
    // it off the payments; here it is money out instead and added back to money in, so the net is the same.
    let ordersById = p.ordersById
    let cash = cashInForPeriod(
        invoices: p.jewellery.map { $0.item }, orders: p.input.orders, invoiced: p.invoiced,
        extraRevenues: p.input.additionalRevenues, period: Period(from: b.cashFrom, to: b.cashTo),
        invoiceDate: { getInvoiceRevenueDate($0, ordersById: ordersById) }
    )
    var paidBack = 0.0
    for entry in p.jewellery where entry.item.status != .refunded {
        for pay in entry.item.paymentHistory where paymentInPeriod(pay.date, b.cashFrom, b.cashTo) {
            if pay.kind == "credit-payback" && pay.amount < 0 { paidBack -= pay.amount }
        }
    }
    let cashIn = cash.total + paidBack
    let cashOut = totalExpenses + paidBack
    // Gold taken off an invoice's total is in Cash In but was never in revenue.
    let accrualVsCashGap = totalSales - (cashIn - paidBack - cash.exchangeOffInvoices)

    // Who still owes: this period's bills, jewellery and coins, largest first.
    var owed = OrderedSums<ReceivableRow>()
    func addOwed(_ inv: Invoice, coin: Bool) {
        let due = max(0, inv.balanceDue.isNaN ? 0 : inv.balanceDue)
        guard due > 0 else { return }
        var row = owed[inv.id] ?? ReceivableRow(
            id: inv.id, customerName: nonEmpty([inv.customerName], fallback: WALK_IN_NAME), customerId: inv.customerId,
            date: getInvoiceRevenueDate(inv, ordersById: ordersById), balanceDue: 0, coinDue: 0)
        row.balanceDue += due
        if coin { row.coinDue += due }
        owed[inv.id] = row
    }
    filteredInvoices.forEach { addOwed($0.item, coin: false) }
    filteredCoinInvoices.forEach { addOwed($0.item, coin: true) }
    let receivables = owed.entries.map { $0.value }.jsSorted { $1.balanceDue - $0.balanceDue }

    let estProfitAdj = NetProfit.beforeRunning(estimated: estProfit, revenue: totalSales, goods: goodsExpenses, recordsGoods: p.opts.recordsGoods)
    // Gold apart (Mina): its estimate at the margin, for the caption only; profit is the house's one rule.
    let goldProfit = p.opts.goldApartMargin.map { goldRevenue * $0 / 100 } ?? 0
    let netProfit = estProfitAdj - runningExpenses

    var out = Books()
    out.totalSales = totalSales
    out.goldRevenue = goldRevenue
    out.silverRevenue = totalSales - goldRevenue
    out.goldProfit = goldProfit
    out.invoiceSales = invoiceSalesAcc
    out.orderSales = orderSales
    out.extraRevenue = extraRevenue
    out.totalUnpaid = totalUnpaid
    out.totalOrders = totalOrders
    out.averageOrderValue = totalOrders > 0 ? orderRevenueTotal / Double(totalOrders) : 0
    out.totalItemsSold = totalItemsSold
    out.totalDiscounts = totalDiscounts
    out.averageItemsPerOrder = totalOrders > 0 ? totalItemsSold / Double(totalOrders) : 0
    out.estProfit = estProfit
    out.salesCosted = salesCosted
    out.salesCount = salesCount
    out.estProfitAdj = estProfitAdj
    out.costOfPieces = totalSales - estProfitAdj
    out.netProfit = netProfit
    out.netMargin = totalSales > 0 ? netProfit / totalSales * 100 : 0
    out.metalGrams = metalGrams
    out.metalPieces = metalPieces
    // Heaviest karat first: what the shop mostly sells leads.
    out.metalByKarat = metalByKarat.entries.map { MetalKaratRow(karat: $0.key, grams: $0.value.grams, pieces: $0.value.pieces) }
        .jsSorted { $1.grams - $0.grams }
    out.salesOverTime = salesOverTime
    out.topProductsByRevenue = topProductsByRevenue
    out.topProductsByQuantity = topProductsByQuantity
    out.salesByCategory = salesByCategory
    out.topCustomers = topCustomers
    out.byWeekday = byWeekday
    out.revenueMix = [
        RevenueMixRow(key: "invoices", label: "Invoices", value: invoiceSalesAcc),
        RevenueMixRow(key: "orders", label: "Orders not invoiced yet", value: orderSales),
        RevenueMixRow(key: "extra", label: "Extra revenue", value: extraRevenue),
    ]
    out.totalExpenses = totalExpenses
    out.runningExpenses = runningExpenses
    out.goodsExpenses = goodsExpenses
    out.drawingsExpenses = drawingsExpenses
    out.expensesByCategory = expensesByCategory
    out.largestExpenses = largestExpenses
    out.cashIn = cashIn
    out.cashInFromInvoicePayments = cash.invoicePayments + paidBack
    out.cashInFromOrderAdvances = cash.orderAdvances
    out.cashInFromExtraRevenue = cash.extraRevenue
    out.cashInFromExchange = cash.exchange
    out.exchangeOffInvoices = cash.exchangeOffInvoices
    out.cashOut = cashOut
    out.cashOutRunning = runningExpenses
    out.cashOutGoods = goodsExpenses
    out.cashOutDrawings = drawingsExpenses
    out.creditPaidBack = paidBack
    out.netCashFlow = cashIn - cashOut
    out.accrualVsCashGap = accrualVsCashGap
    out.receivables = receivables
    out.receivablesTotal = receivables.reduce(0) { $0 + $1.balanceDue }
    out.newCustomers = newCustomers
    out.returningCustomers = returningCustomers
    out.revenueFromNew = revenueFromNew
    out.revenueFromReturning = revenueFromReturning
    out.customerDays = customerDays
    out.sourceBreakdown = sourceBreakdown
    out.sourceTrend = sourceTrend
    out.sourceActiveKeys = sourceActiveKeys
    out.coinSummary = summariseCoins(filteredCoinInvoices.map { $0.item })
    out.hasCoins = !p.coins.isEmpty
    out.invoices = filteredInvoices.map { $0.item }
    out.invoicesByDay = invoicesByDay
    out.rangeEmpty = filteredInvoices.isEmpty && filteredOrders.isEmpty && start != nil
    return out
}

// MARK: - One preparation, many periods

/// The books prepared once, so a page that asks for its period, the one before and twelve months does the shared work
/// (coin split, dates, first sales) once.
public struct BooksEngine {
    private let prepared: BooksPrepared

    public init(_ input: BooksInput, options: BooksOptions = BooksOptions()) {
        prepared = prepareBooks(input, options)
    }

    public func books(_ range: Period?) -> Books { computeBooks(prepared, range) }

    /// `monthlySeries`: the last N months ending this month, or all from the first record (nil).
    public func months(_ months: Int? = 12) -> [MonthRow] { monthlySeries(prepared, months: months) }
}

// MARK: - The period before

public struct PreviousPeriod {
    public let range: AnalyticsRange
    /// After "vs": "last month", "last year", "previous 7 days".
    public let label: String
}

/// The period to compare with. A whole or month-to-date calendar month is compared with the same days of the month
/// before ("vs last month", so 1-5 November meets 1-5 October, not a stray week of October); a year or year-to-date
/// with the same span of the year before; anything else with the same number of days immediately before it. nil for
/// all time (no `from`).
public func previousPeriod(_ range: Period?, now: Date = Date()) -> PreviousPeriod? {
    guard let rawFrom = range?.from else { return nil }
    let from = BooksCal.startOfDay(rawFrom)
    let to = BooksCal.endOfDay(range?.to ?? now)
    let days = JS.calendarDays(to, since: from) + 1
    if days < 1 { return nil }
    if BooksCal.dayOfMonth(from) == 1 && BooksCal.year(to) == BooksCal.year(from) && BooksCal.month(to) == BooksCal.month(from) {
        let prevFrom = BooksCal.startOfMonth(BooksCal.addMonths(from, -1))
        let sameDays = BooksCal.addDays(prevFrom, BooksCal.dayOfMonth(to) - 1)
        let prevTo = BooksCal.endOfDay(min(sameDays, BooksCal.endOfMonth(prevFrom)))
        return PreviousPeriod(range: AnalyticsRange(from: prevFrom, to: prevTo), label: "last month")
    }
    if BooksCal.month(from) == 1 && BooksCal.dayOfMonth(from) == 1 && BooksCal.year(to) == BooksCal.year(from) {
        return PreviousPeriod(range: AnalyticsRange(from: BooksCal.addYears(from, -1), to: BooksCal.endOfDay(BooksCal.addYears(to, -1))),
                              label: "last year")
    }
    return PreviousPeriod(
        range: AnalyticsRange(from: BooksCal.startOfDay(BooksCal.addDays(from, -days)), to: BooksCal.endOfDay(BooksCal.addDays(from, -1))),
        label: days == 1 ? "the day before" : "previous \(days) days"
    )
}

public func previousRange(_ range: Period?, now: Date = Date()) -> AnalyticsRange? {
    previousPeriod(range, now: now)?.range
}

extension Period {
    /// An Analytics range as the books read it.
    public init(_ range: AnalyticsRange?) { self.init(from: range?.from, to: range?.to) }
}

// MARK: - Change against the period before

public struct Delta: Equatable {
    /// Percent change against the period before.
    public let pct: Double
    public let better: Bool
}

/// The change from `previous` to `current`; nil when the period before was empty (nothing to compare with).
/// `upIsGood` false for a figure where less is better.
public func deltaOf(_ current: Double, _ previous: Double?, upIsGood: Bool = true) -> Delta? {
    guard let previous, abs(previous) > 0 else { return nil }
    let pct = (current - previous) / abs(previous) * 100
    return Delta(pct: pct, better: upIsGood ? pct >= 0 : pct <= 0)
}

// MARK: - Sales over time, by day, week or month

public enum BooksBucket: String, CaseIterable, Identifiable {
    case day, week, month
    public var id: String { rawValue }
}

/// The default grain for a period: days up to 45 of them, weeks up to 200, else months (all time: months).
public func autoBucket(_ range: Period?, now: Date = Date()) -> BooksBucket {
    guard let from = range?.from else { return .month }
    let days = JS.calendarDays(BooksCal.endOfDay(range?.to ?? now), since: BooksCal.startOfDay(from)) + 1
    return days <= 45 ? .day : days <= 200 ? .week : .month
}

public struct BucketRow: Equatable, Identifiable {
    /// The bucket's first day, yyyy-MM-dd.
    public let key: String
    /// Axis label: "Nov 4", for a week the day it starts on, "Nov 25".
    public let label: String
    /// Tooltip title: "Tue, Nov 4", "Week of Nov 3", "November 2026".
    public let tip: String
    /// The bucket's first day, noon-free: where a chart draws it.
    public let start: Date
    public var sales: Double
    public var orders: Int
    public var itemsSold: Double
    public var id: String { key }
}

private func bucketStart(_ d: Date, _ b: BooksBucket) -> Date {
    switch b {
    case .day: return BooksCal.startOfDay(d)
    case .week: return BooksCal.startOfWeek(d)
    case .month: return BooksCal.startOfMonth(d)
    }
}

private func bucketNext(_ d: Date, _ b: BooksBucket) -> Date {
    switch b {
    case .day: return BooksCal.addDays(d, 1)
    case .week: return BooksCal.addDays(d, 7)
    case .month: return BooksCal.addMonths(d, 1)
    }
}

private func bucketLabels(_ d: Date, _ b: BooksBucket) -> (label: String, tip: String) {
    switch b {
    case .day: return (BooksCal.monthDay(d), BooksCal.weekdayMonthDay(d))
    case .week: return (BooksCal.monthDay(d), "Week of \(BooksCal.monthDay(d))")
    case .month: return (BooksCal.monthYear(d), BooksCal.longMonthYear(d))
    }
}

/// Daily sales summed into days, weeks (Monday first) or months. Quiet buckets are kept as zeros so a gap reads as a
/// gap: between the first and last sale, widened to `range` when one is given (so the current and previous periods
/// line up bucket for bucket).
public func bucketSeries(_ series: [SalesDay], _ bucket: BooksBucket, range: Period? = nil, now: Date = Date()) -> [BucketRow] {
    var sums: [String: (sales: Double, orders: Int, itemsSold: Double)] = [:]
    var first: Date?, last: Date?
    for row in series {
        guard let d = JS.parseISO(row.date) else { continue }
        let key = BooksCal.dayKey(bucketStart(d, bucket))
        var s = sums[key] ?? (0, 0, 0)
        s.sales += row.sales
        s.orders += row.orders
        s.itemsSold += row.itemsSold
        sums[key] = s
        if first == nil || d < first! { first = d }
        if last == nil || d > last! { last = d }
    }
    var lo = first, hi = last
    if let rf = range?.from {
        let from = BooksCal.startOfDay(rf), to = BooksCal.startOfDay(range?.to ?? now)
        if lo == nil || from < lo! { lo = from }
        if hi == nil || to > hi! { hi = to }
    }
    guard let low = lo, let high = hi else { return [] }
    var rows: [BucketRow] = []
    var d = bucketStart(low, bucket)
    while d <= high {
        let key = BooksCal.dayKey(d)
        let labels = bucketLabels(d, bucket)
        let s = sums[key] ?? (0, 0, 0)
        rows.append(BucketRow(key: key, label: labels.label, tip: labels.tip, start: d, sales: s.sales, orders: s.orders, itemsSold: s.itemsSold))
        d = bucketNext(d, bucket)
    }
    return rows
}

public struct ComparedRow: Equatable, Identifiable {
    public let key: String
    public let label: String
    public let tip: String
    public let start: Date
    public let value: Double
    public let orders: Int
    public let prev: Double?
    public let prevLabel: String?
    public var id: String { key }
}

/// The current buckets with the previous period's laid beside them, first with first (same axis, one measure).
public func compareSeries(_ current: [BucketRow], _ previous: [BucketRow]? = nil) -> [ComparedRow] {
    current.enumerated().map { i, r in
        let before = previous.flatMap { i < $0.count ? $0[i] : nil }
        return ComparedRow(key: r.key, label: r.label, tip: r.tip, start: r.start, value: r.sales, orders: r.orders,
                           prev: before?.sales, prevLabel: before?.tip)
    }
}

public struct CustomerFlowRow: Equatable, Identifiable {
    public let key: String
    public let label: String
    public let tip: String
    public let start: Date
    public let newCustomers: Int
    public let returningCustomers: Int
    public var id: String { key }
}

/// New and returning customers per bucket: a customer is new in the bucket of their first sale, returning after.
public func bucketCustomerFlow(_ days: [CustomerDay], _ bucket: BooksBucket, range: Period? = nil, now: Date = Date()) -> [CustomerFlowRow] {
    let empty = days.map { SalesDay(date: $0.date, sales: 0, orders: 0, itemsSold: 0) }
    let frame = bucketSeries(empty, bucket, range: range, now: now)
    var news: [String: Set<String>] = [:], all: [String: Set<String>] = [:]
    for d in days {
        guard let date = JS.parseISO(d.date) else { continue }
        let key = BooksCal.dayKey(bucketStart(date, bucket))
        for k in d.newKeys { news[key, default: []].insert(k); all[key, default: []].insert(k) }
        for k in d.returningKeys { all[key, default: []].insert(k) }
    }
    return frame.map { r in
        let n = news[r.key]?.count ?? 0
        return CustomerFlowRow(key: r.key, label: r.label, tip: r.tip, start: r.start, newCustomers: n,
                               returningCustomers: (all[r.key]?.count ?? 0) - n)
    }
}

// MARK: - Month by month

public struct MonthRow: Equatable, Identifiable {
    /// yyyy-MM
    public let key: String
    /// "Nov 26"
    public let month: String
    /// The month's first day: where a chart draws it.
    public let start: Date
    public let revenue: Double
    /// Sales (invoices and orders).
    public let sales: Int
    /// Profit before running costs (`estProfitAdj`).
    public let estProfit: Double
    public let running: Double
    public let goods: Double
    public let drawings: Double
    /// Net profit and its margin in percent.
    public let net: Double
    public let netMargin: Double
    public let cashIn: Double
    public let cashOut: Double
    /// Grams of the house's metal sold, in total and by karat.
    public let metalGrams: Double
    public let metalByKarat: [String: Double]
    public let coinRevenue: Double
    public let coinCount: Double
    public var id: String { key }
}

/// Calendar month by calendar month, each worked out by the same `computeBooks` as a chosen period, so a month's
/// figures are the ones the page shows when that month is picked. `months` is the last N ending this month (quiet
/// months kept), or nil from the first record on. Not bound to the page's range.
public func monthlySeries(_ input: BooksInput, months: Int? = 12, options: BooksOptions = BooksOptions()) -> [MonthRow] {
    monthlySeries(prepareBooks(input, options), months: months)
}

func monthlySeries(_ p: BooksPrepared, months: Int?) -> [MonthRow] {
    let thisMonth = BooksCal.startOfMonth(p.now)
    let first: Date
    if let months {
        first = BooksCal.startOfMonth(BooksCal.addMonths(thisMonth, -(max(1, months) - 1)))
    } else {
        let times: [Int64] = (p.jewellery.compactMap { $0.t } + p.coins.compactMap { $0.t } + p.orders.compactMap { $0.t }
            + p.expenses.compactMap { $0.t } + p.extras.compactMap { $0.t })
        guard let lowest = times.min() else { return [] }
        first = BooksCal.startOfMonth(date(fromMs: lowest))
    }
    let last = months == nil ? max(thisMonth, first) : thisMonth
    return BooksCal.eachMonth(from: first, to: last).map { m in
        let b = computeBooks(p, Period(from: m, to: BooksCal.endOfMonth(m)))
        var karats: [String: Double] = [:]
        for k in b.metalByKarat { karats[k.karat] = k.grams }
        return MonthRow(
            key: BooksCal.monthKey(m), month: BooksCal.monthYear(m), start: m,
            revenue: b.totalSales, sales: b.totalOrders, estProfit: b.estProfitAdj,
            running: b.runningExpenses, goods: b.goodsExpenses, drawings: b.drawingsExpenses,
            net: b.netProfit, netMargin: b.netMargin, cashIn: b.cashIn, cashOut: b.cashOut,
            metalGrams: b.metalGrams, metalByKarat: karats, coinRevenue: b.coinSummary.revenue, coinCount: b.coinSummary.coins
        )
    }
}

/// The karats a run of months holds, heaviest overall first (the stack's keys).
public func karatsOf(_ rows: [MonthRow]) -> [String] {
    var order: [String] = []
    var total: [String: Double] = [:]
    for r in rows {
        for k in r.metalByKarat.keys.sorted() {
            if total[k] == nil { order.append(k) }
            total[k, default: 0] += r.metalByKarat[k] ?? 0
        }
    }
    return order.jsSorted { (total[$1] ?? 0) - (total[$0] ?? 0) }
}

public struct MonthlyRevenue: Equatable {
    public struct Row: Equatable, Identifiable {
        public let key: String
        public let month: String
        public let start: Date
        public let revenue: Double
        public let sales: Int
        public var id: String { key }
    }
    public let data: [Row]
    public let average: Double
    public let best: String?
}

/// Revenue per calendar month across the whole history, not bound to the range: the shape of the trend rather than a
/// slice. Same revenue basis as everywhere (invoice sale value on its order date, uninvoiced order subtotals, extra
/// revenue). Empty months are kept so gaps read as gaps.
public func monthlyRevenue(_ input: BooksInput, options: BooksOptions = BooksOptions()) -> MonthlyRevenue {
    let p = prepareBooks(input, options)
    var bucket: [String: (revenue: Double, sales: Int)] = [:]
    func add(_ d: Date?, _ amount: Double) {
        guard let d else { return }
        let key = BooksCal.monthKey(d)
        var cur = bucket[key] ?? (0, 0)
        cur.revenue += amount
        cur.sales += 1
        bucket[key] = cur
    }
    for e in p.jewellery { add(e.date, invoiceSaleValue(e.item)) }
    for e in p.orders { add(e.date, e.item.subtotal.isNaN ? 0 : e.item.subtotal) }
    for e in p.extras { add(e.date, e.item.amount.isNaN ? 0 : e.item.amount) }

    let keys = bucket.keys.sorted()
    guard let firstKey = keys.first, let lastKey = keys.last,
          let lo = JS.parseISO(firstKey + "-01"), let hi = JS.parseISO(lastKey + "-01") else {
        return MonthlyRevenue(data: [], average: 0, best: nil)
    }
    let data = BooksCal.eachMonth(from: lo, to: hi).map { m -> MonthlyRevenue.Row in
        let key = BooksCal.monthKey(m)
        return MonthlyRevenue.Row(key: key, month: BooksCal.monthYear(m), start: m, revenue: bucket[key]?.revenue ?? 0, sales: bucket[key]?.sales ?? 0)
    }
    let withRevenue = data.filter { $0.revenue > 0 }
    let average = withRevenue.isEmpty ? 0 : withRevenue.reduce(0) { $0 + $1.revenue } / Double(withRevenue.count)
    var best = data.first
    for d in data where d.revenue > (best?.revenue ?? -1) { best = d }
    return MonthlyRevenue(data: data, average: average, best: best?.key)
}

public struct YearRow: Equatable, Identifiable {
    public let year: Int
    public let revenue: Double
    public let expenses: Double
    public let unpaid: Double
    public let profit: Double
    public let netProfit: Double
    public let netMargin: Double
    public var id: Int { year }
}

/// Each calendar year of the history, newest first (the old "Yearly Performance Overview").
public func yearlySummary(_ input: BooksInput, options: BooksOptions = BooksOptions()) -> [YearRow] {
    let p = prepareBooks(input, options)
    struct Acc { var revenue = 0.0, expenses = 0.0, unpaid = 0.0, profit = 0.0, goods = 0.0 }
    var years: [Int: Acc] = [:]
    let margin = options.margin
    for e in p.jewellery {
        guard let d = e.date else { continue }
        let yr = BooksCal.year(d)
        let value = invoiceSaleValue(e.item)
        years[yr, default: Acc()].revenue += value
        // Each sale at its own margin: from the 24k rate typed when it was made, else the assumed one (margin.ts).
        years[yr, default: Acc()].profit += value * invoiceMargin(e.item, settings: margin).percent / 100
        years[yr, default: Acc()].unpaid += max(0, e.item.balanceDue.isNaN ? 0 : e.item.balanceDue)
    }
    for e in p.orders {
        guard let d = e.date else { continue }
        let yr = BooksCal.year(d)
        // Subtotal: the full order value regardless of advance paid.
        let sub = e.item.subtotal.isNaN ? 0 : e.item.subtotal
        years[yr, default: Acc()].revenue += sub
        years[yr, default: Acc()].profit += sub * orderMargin(e.item, settings: margin).percent / 100
    }
    for e in p.extras {
        guard let d = e.date else { continue }
        let yr = BooksCal.year(d)
        let amount = e.item.amount.isNaN ? 0 : e.item.amount
        years[yr, default: Acc()].revenue += amount
        years[yr, default: Acc()].profit += amount * margin.assumedMargin
    }
    for e in p.expenses {
        guard let d = e.date else { continue }
        // Drawings are a distribution of profit, not a cost of earning it; the goods are already inside the estimated
        // profit's margin. Where a house records its goods (Mina) they come off the revenue as the gross profit.
        let isGoods = NetProfit.isGoodsExpense(e.item, goods: options.goods)
        if !isGoods && !NetProfit.isRunningCost(e.item, goods: options.goods) { continue }
        let yr = BooksCal.year(d)
        let amount = e.item.amount.isNaN ? 0 : e.item.amount
        if isGoods { years[yr, default: Acc()].goods += amount } else { years[yr, default: Acc()].expenses += amount }
    }
    return years.map { year, data -> YearRow in
        let profit = NetProfit.beforeRunning(estimated: data.profit, revenue: data.revenue, goods: data.goods, recordsGoods: options.recordsGoods)
        // That profit less the running costs, never revenue less every expense (net-profit.ts).
        let net = profit - data.expenses
        return YearRow(year: year, revenue: data.revenue, expenses: data.expenses, unpaid: data.unpaid, profit: profit,
                       netProfit: net, netMargin: data.revenue > 0 ? net / data.revenue * 100 : 0)
    }.sorted { $0.year > $1.year }
}
