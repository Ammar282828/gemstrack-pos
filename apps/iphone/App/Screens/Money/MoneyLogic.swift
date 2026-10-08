import Foundation
import ERPCore

// What the Money screens work out for themselves, with no SwiftUI in it (so it also compiles and
// tests on Linux with ERPCore): paths and words, Karachi's months, the Hisaab page's summary and
// a person's running balance. Every type carries Money, Expense or Hisaab in its name so it cannot
// meet another group's helpers in the one module.

// MARK: Paths and words

enum MoneyPaths {
    /// One part of a path: an id with a "/" or "?" in it must not split the address.
    static func encode(_ part: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        return part.addingPercentEncoding(withAllowedCharacters: allowed) ?? part
    }

    /// What JavaScript's encodeURIComponent leaves alone (a query value).
    private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
    }

    /// The ERP's own pages for what is not native yet (edit, delete, add): `?web=1` asks for the
    /// ERP page even where a native screen exists.
    static let expensesWeb = "/expenses?web=1"
    static let revenueWeb = "/additional-revenue?web=1"
    static let hisaabWeb = "/hisaab?web=1"

    /// A repair opens as a sheet on the Repairs list (src/app/additional-revenue/page.tsx RepairLink).
    static func repair(_ id: String) -> String { "/repairs?id=" + component(id) }

    static func invoice(_ id: String) -> String { "/invoices/" + encode(id) }

    /// One person's ledger: "/hisaab/<id>?type=customer|karigar".
    static func ledger(_ id: String, isCustomer: Bool, web: Bool = false) -> String {
        "/hisaab/" + encode(id) + "?type=" + (isCustomer ? "customer" : "karigar") + (web ? "&web=1" : "")
    }

    /// "/hisaab/CUST-1?type=customer" is the ledger of "CUST-1". Nil for the list and for a deeper path.
    static func ledgerID(fromPath path: String) -> String? {
        let bare = path.split(separator: "?").first.map(String.init) ?? path
        let prefix = "/hisaab/"
        guard bare.hasPrefix(prefix) else { return nil }
        let rest = String(bare.dropFirst(prefix.count))
        guard !rest.isEmpty, !rest.contains("/") else { return nil }
        return rest.removingPercentEncoding ?? rest
    }

    static func query(_ name: String, in path: String) -> String? {
        URLComponents(string: path)?.queryItems?.first { $0.name == name }?.value
    }
}

enum MoneyFormat {
    private static let gramsFormat: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 3
        f.maximumFractionDigits = 3
        return f
    }()

    /// "25.600 g": grams to the milligram, as the Hisaab page prints them.
    static func grams(_ g: Double) -> String {
        (gramsFormat.string(from: NSNumber(value: g)) ?? String(format: "%.3f", g)) + " g"
    }
}

// MARK: Months

/// A document with Karachi's day beside it ("yyyy-MM-dd", "" when it has no readable date).
struct MoneyLine<Item: Identifiable>: Identifiable where Item.ID == String {
    let item: Item
    let day: String
    var id: String { item.id }
}

/// One month of a list, with what it came to.
struct MoneyMonth<Item: Identifiable>: Identifiable where Item.ID == String {
    let key: String
    let title: String
    let hint: String
    let rows: [MoneyLine<Item>]
    let total: Double
    var id: String { key }
}

enum MoneyMonths {
    private static func formatter(_ pattern: String, locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale)
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let monthParse = formatter("yyyy-MM", locale: "en_US_POSIX")
    private static let monthName = formatter("MMMM yyyy", locale: "en_GB")

    /// Karachi's day of an ISO instant, "" when it has none.
    static func day(_ iso: String) -> String {
        ERPDate.parse(iso).map { ERPDate.karachiDay($0) } ?? ""
    }

    /// "2026-10" as "October 2026".
    static func title(forKey key: String) -> String {
        guard let d = monthParse.date(from: key) else { return "No date" }
        return monthName.string(from: d)
    }

    /// Rows already newest first, kept in that order, month by month.
    static func group<Item: Identifiable>(
        _ lines: [MoneyLine<Item>],
        now: Date = Date(),
        amount: (Item) -> Double
    ) -> [MoneyMonth<Item>] where Item.ID == String {
        let thisMonth = String(ERPDate.karachiDay(now).prefix(7))
        var order: [String] = []
        var members: [String: [MoneyLine<Item>]] = [:]
        var totals: [String: Double] = [:]
        for line in lines {
            let key = line.day.isEmpty ? "undated" : String(line.day.prefix(7))
            if members[key] == nil { order.append(key) }
            members[key, default: []].append(line)
            totals[key, default: 0] += amount(line.item)
        }
        var out: [MoneyMonth<Item>] = []
        for key in order {
            out.append(MoneyMonth(
                key: key,
                title: key == "undated" ? "No date" : title(forKey: key),
                hint: key == thisMonth ? "This month" : "",
                rows: members[key] ?? [],
                total: totals[key] ?? 0
            ))
        }
        return out
    }
}

// MARK: Expense periods, groups and figures

/// Karachi's calendar: days as "yyyy-MM-dd" strings, weeks from Monday (lib/date-grouping.ts reads
/// them with date-fns, `weekStartsOn: 1`). Karachi has no daylight saving, so a day is 86,400 seconds.
enum MoneyCalendar {
    static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        return c
    }()

    private static func formatter(_ pattern: String, locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale)
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let dayParse = formatter("yyyy-MM-dd", locale: "en_US_POSIX")
    private static let longDay = formatter("EEEE d MMM", locale: "en_GB")
    private static let shortDay = formatter("d MMM", locale: "en_GB")
    private static let fullDay = formatter("d MMM yyyy", locale: "en_GB")

    /// Karachi's midnight at the start of a "yyyy-MM-dd" day.
    static func date(ofDay day: String) -> Date? { dayParse.date(from: day) }

    /// The day the person picked on the phone's own calendar ("6 Oct" is the 6th wherever the phone
    /// is), as a day string; a picker's time of day does not matter.
    static func pickedDay(_ picked: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: picked)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 1, c.day ?? 1)
    }

    /// The Monday of the day's week, as a day string.
    static func weekStart(ofDay day: String) -> String? {
        guard let d = date(ofDay: day), let start = karachi.dateInterval(of: .weekOfYear, for: d)?.start else { return nil }
        return ERPDate.karachiDay(start)
    }

    static func say(day: String, long: Bool = false) -> String {
        guard let d = date(ofDay: day) else { return day }
        return long ? longDay.string(from: d) : shortDay.string(from: d)
    }

    static func sayFull(day: String) -> String {
        guard let d = date(ofDay: day) else { return day }
        return fullDay.string(from: d)
    }
}

/// An inclusive span of Karachi days; a missing end is no bound at all.
struct MoneyDayRange: Equatable {
    var from: String?
    var to: String?

    var isOpen: Bool { from == nil && to == nil }

    /// A day outside the span, or a row with no readable date inside a bounded one, is out.
    func contains(_ day: String) -> Bool {
        if isOpen { return true }
        if day.isEmpty { return false }
        if let f = from, day < f { return false }
        if let t = to, day > t { return false }
        return true
    }

    /// "1 Oct – 8 Oct 2026", as the page's subtitle says it; nil for no bound.
    var caption: String? {
        guard let f = from, let t = to else { return nil }
        return "\(MoneyCalendar.say(day: f)) – \(MoneyCalendar.sayFull(day: t))"
    }
}

/// How far back Expenses looks (lib/date-grouping.ts PERIODS, in its order, with `periodRange`).
enum ExpensePeriod: String, CaseIterable, Identifiable {
    case thisMonth, lastMonth, last30, thisYear, all, custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .thisMonth: return "This month"
        case .lastMonth: return "Last month"
        case .last30: return "Last 30 days"
        case .thisYear: return "This year"
        case .all: return "All time"
        case .custom: return "Custom range"
        }
    }

    /// The span in Karachi days. Every span but Last month ends at the end of today, and a custom
    /// one ends at the end of its last day: `endOfDay(to || now)`. A custom span with no start is no
    /// bound at all, as in the web. `customFrom`/`customTo` are day strings.
    func range(customFrom: String? = nil, customTo: String? = nil, now: Date = Date()) -> MoneyDayRange {
        let today = ERPDate.karachiDay(now)
        switch self {
        case .all:
            return MoneyDayRange(from: nil, to: nil)
        case .thisMonth:
            return MoneyDayRange(from: String(today.prefix(7)) + "-01", to: today)
        case .lastMonth:
            let first = String(today.prefix(7)) + "-01"
            let startOfThisMonth = MoneyCalendar.date(ofDay: first) ?? now
            return MoneyDayRange(from: Self.previousMonth(of: today) + "-01", to: ERPDate.karachiDay(startOfThisMonth.addingTimeInterval(-1)))
        case .last30:
            return MoneyDayRange(from: ERPDate.karachiDay(now.addingTimeInterval(-29 * 86_400)), to: today)
        case .thisYear:
            return MoneyDayRange(from: String(today.prefix(4)) + "-01-01", to: today)
        case .custom:
            guard let from = customFrom, !from.isEmpty else { return MoneyDayRange(from: nil, to: nil) }
            let to = (customTo ?? "").isEmpty ? today : (customTo ?? today)
            return MoneyDayRange(from: from, to: to)
        }
    }

    /// "2026-10-08" gives "2026-09"; "2026-01-05" gives "2025-12".
    static func previousMonth(of today: String) -> String {
        let year = Int(today.prefix(4)) ?? 0
        let month = Int(today.dropFirst(5).prefix(2)) ?? 1
        return month > 1 ? String(format: "%04d-%02d", year, month - 1) : String(format: "%04d-12", year - 1)
    }
}

/// How coarsely the rows are bucketed (GRADUATIONS); the subtotal is per bucket.
enum ExpenseGrouping: String, CaseIterable, Identifiable {
    case day, week, month

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        }
    }
}

struct MoneyBucket: Equatable {
    let key: String
    let label: String
    let sub: String
}

/// One bucket of a list with what it came to.
struct MoneyGroup<Item: Identifiable>: Identifiable where Item.ID == String {
    let key: String
    let label: String
    let sub: String
    let rows: [MoneyLine<Item>]
    let total: Double
    var id: String { key }
}

enum MoneyBuckets {
    /// lib/date-grouping.ts `bucketOf`, on Karachi days. Day: Today, Yesterday or "Monday 6 Oct",
    /// the date (or the year) under it. Week from Monday: "Week of 6 Oct", "This week" or the year of
    /// that Monday. Month: "October 2026", "This month".
    static func bucket(day: String, by grouping: ExpenseGrouping, now: Date = Date()) -> MoneyBucket {
        if day.isEmpty { return MoneyBucket(key: "undated", label: "No date", sub: "") }
        let today = ERPDate.karachiDay(now)
        switch grouping {
        case .month:
            let key = String(day.prefix(7))
            return MoneyBucket(key: "m" + key, label: MoneyMonths.title(forKey: key), sub: key == String(today.prefix(7)) ? "This month" : "")
        case .week:
            let start = MoneyCalendar.weekStart(ofDay: day) ?? day
            let thisWeek = start == (MoneyCalendar.weekStart(ofDay: today) ?? today)
            return MoneyBucket(key: "w" + start, label: "Week of " + MoneyCalendar.say(day: start), sub: thisWeek ? "This week" : String(start.prefix(4)))
        case .day:
            let isToday = day == today
            let isYesterday = day == ERPDate.karachiDay(now.addingTimeInterval(-86_400))
            let label = isToday ? "Today" : (isYesterday ? "Yesterday" : MoneyCalendar.say(day: day, long: true))
            let sub = (isToday || isYesterday) ? MoneyCalendar.sayFull(day: day) : String(day.prefix(4))
            return MoneyBucket(key: "d" + day, label: label, sub: sub)
        }
    }

    /// Rows already newest first, kept in that order, bucket by bucket in the order first met.
    static func group<Item: Identifiable>(
        _ lines: [MoneyLine<Item>],
        by grouping: ExpenseGrouping,
        now: Date = Date(),
        amount: (Item) -> Double
    ) -> [MoneyGroup<Item>] where Item.ID == String {
        var order: [MoneyBucket] = []
        var members: [String: [MoneyLine<Item>]] = [:]
        var totals: [String: Double] = [:]
        for line in lines {
            let b = bucket(day: line.day, by: grouping, now: now)
            if members[b.key] == nil { order.append(b) }
            members[b.key, default: []].append(line)
            totals[b.key, default: 0] += amount(line.item)
        }
        var out: [MoneyGroup<Item>] = []
        for b in order {
            out.append(MoneyGroup(key: b.key, label: b.label, sub: b.sub, rows: members[b.key] ?? [], total: totals[b.key] ?? 0))
        }
        return out
    }
}

/// The page's `summary` (src/app/expenses/page.tsx).
struct ExpenseSummary {
    var total = 0.0
    var count = 0
    var karigarTotal = 0.0
    /// Rounded, a whole percent.
    var karigarShare = 0
    /// The total over the number of buckets (at least 1).
    var perBucket = 0.0
    /// The biggest bucket; the first of equals. "—" and 0 with no rows.
    var biggestLabel = "\u{2014}"
    var biggestTotal = 0.0
}

enum ExpenseFigures {
    // TODO(logic): port the Expenses page's summary (src/app/expenses/page.tsx; page-local in the TypeScript).
    static func summary(_ lines: [MoneyLine<Expense>], groups: [MoneyGroup<Expense>]) -> ExpenseSummary {
        var s = ExpenseSummary()
        for line in lines {
            s.total += line.item.amount
            if !(line.item.karigarId ?? "").isEmpty { s.karigarTotal += line.item.amount }
        }
        s.count = lines.count
        s.karigarShare = s.total > 0 ? Int((s.karigarTotal / s.total * 100).rounded(.toNearestOrAwayFromZero)) : 0
        s.perBucket = s.total / Double(max(groups.count, 1))
        for g in groups where g.total > s.biggestTotal {
            s.biggestTotal = g.total
            s.biggestLabel = g.label
        }
        return s
    }

    /// Every category an expense carries, the most used first (ties by name).
    static func categoriesByUse(_ expenses: [Expense]) -> [String] {
        var counts: [String: Int] = [:]
        for e in expenses where !e.category.isEmpty { counts[e.category, default: 0] += 1 }
        return counts.keys.sorted { a, b in
            let ca = counts[a] ?? 0
            let cb = counts[b] ?? 0
            if ca != cb { return ca > cb }
            return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
        }
    }
}

/// The expense form's number box (components/ui/amount-input.tsx): only digits and the first dot
/// count, two decimals at most, so "PKR 1,25,000" is 125000 and "1 250.50" is 1250.5.
enum MoneyParse {
    static func amount(_ raw: String, maxDecimals: Int = 2) -> Double? {
        var out = ""
        var seenDot = false
        var decimals = 0
        for ch in raw {
            if ch >= "0" && ch <= "9" {
                if seenDot {
                    if decimals >= maxDecimals { continue }
                    decimals += 1
                }
                out.append(ch)
            } else if ch == "." && !seenDot {
                seenDot = true
                out.append(ch)
            }
        }
        if out.isEmpty || out == "." { return nil }
        return Double(out)
    }
}

/// Filing a karigar's payment under one of his hisaabs (expense-form.tsx).
enum ExpenseFiling {
    /// "Deliberately not in a hisaab", apart from "none chosen".
    static let direct = "__direct__"

    static func isOpen(_ b: KarigarBatch) -> Bool { (b.closedDate ?? "").isEmpty }

    /// His hisaabs, an open one first, then the newest start.
    static func batches(for karigarId: String, in all: [KarigarBatch]) -> [KarigarBatch] {
        if karigarId.isEmpty { return [] }
        var keyed: [(batch: KarigarBatch, at: Double)] = []
        for b in all where b.karigarId == karigarId {
            keyed.append((b, ERPDate.parse(b.startDate)?.timeIntervalSince1970 ?? 0))
        }
        keyed.sort { x, y in
            let ox = isOpen(x.batch)
            let oy = isOpen(y.batch)
            if ox != oy { return ox }
            if x.at != y.at { return x.at > y.at }
            return x.batch.id < y.batch.id
        }
        return keyed.map { $0.batch }
    }

    /// What the picker shows until it is touched: his open hisaab, else a direct payment; nothing
    /// for no karigar. (`batches` comes from `batches(for:in:)`, open first.)
    static func defaultChoice(karigarId: String, batches: [KarigarBatch]) -> String {
        if karigarId.isEmpty { return "" }
        if let open = batches.first(where: { isOpen($0) }) { return open.id }
        return direct
    }

    /// The batch id the expense is filed under; nil for a direct payment or no choice.
    static func filedBatchId(_ choice: String) -> String? {
        choice.isEmpty || choice == direct ? nil : choice
    }

    /// "Open", or "Settled 5 Oct 2026".
    static func hint(_ b: KarigarBatch) -> String {
        guard !isOpen(b) else { return "Open" }
        guard let closed = ERPDate.parse(b.closedDate) else { return "Settled" }
        return "Settled " + MoneyCalendar.sayFull(day: ERPDate.karachiDay(closed))
    }
}

// MARK: Hisaab

enum HisaabSide {
    /// The person owes the shop ("You will get").
    case get
    /// The shop owes the person ("You will give").
    case give
}

/// An invoice still owing, as a Hisaab card lists it.
struct HisaabUnpaid: Identifiable {
    let id: String
    let grandTotal: Double
    let amountPaid: Double
    let balanceDue: Double
}

/// One person's balance: debit less credit over their rows (positive: they owe us).
struct HisaabAccount: Identifiable {
    let id: String
    let name: String
    let isCustomer: Bool
    let cash: Double
    let gold: Double
    let unpaid: [HisaabUnpaid]

    /// Walk-in sales left owing sit under one fixed entity, with no account page (lib/walk-in.ts).
    var isWalkIn: Bool { id == WALK_IN_ENTITY }

    var hasCash: Bool { abs(cash) > 0.001 }

    /// Which way the cash runs; a balance held only in metal goes by the metal.
    var side: HisaabSide {
        if cash > 0.001 { return .get }
        if cash < -0.001 { return .give }
        return gold >= 0 ? .get : .give
    }

    /// How big, for ordering: the cash, else the metal.
    var size: Double { hasCash ? abs(cash) : abs(gold) }
}

struct HisaabSummary {
    var accounts: [HisaabAccount] = []
    var receivable = 0.0
    var payable = 0.0
    var receivableGold = 0.0
    var payableGold = 0.0
}

enum HisaabBook {
    // TODO(logic): port the Hisaab page's summary (src/app/hisaab/page.tsx accountSummaries; it is
    // page-local in the TypeScript, not in src/lib) to ERPCore with a test.
    static func summary(entries: [HisaabEntry], invoices: [Invoice], customerIds: Set<String>) -> HisaabSummary {
        struct Sum { var name: String; var type: HisaabEntityType; var cash = 0.0; var gold = 0.0 }
        var order: [String] = []
        var sums: [String: Sum] = [:]
        // Walk-in sales left owing have no customer to hold them, so their entries sit under the
        // entity 'walk-in': one row, or "You will get" would miss them.
        var walkInInvoiceIds = Set<String>()
        for e in entries {
            if e.entityId.isEmpty { continue }
            let walkIn = e.entityId == WALK_IN_ENTITY
            if walkIn, let linked = e.linkedInvoiceId, !linked.isEmpty { walkInInvoiceIds.insert(linked) }
            if sums[e.entityId] == nil {
                order.append(e.entityId)
                sums[e.entityId] = Sum(name: walkIn ? WALK_IN_NAME : e.entityName, type: e.entityType)
            }
            sums[e.entityId]?.cash += e.cashDebit - e.cashCredit
            sums[e.entityId]?.gold += e.goldDebitGrams - e.goldCreditGrams
        }

        var unpaidBy: [String: [HisaabUnpaid]] = [:]
        for inv in invoices {
            guard isOwing(inv), let cid = inv.customerId, !cid.isEmpty, cid != WALK_IN_ENTITY else { continue }
            unpaidBy[cid, default: []].append(HisaabUnpaid(id: inv.id, grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, balanceDue: inv.balanceDue))
        }
        if sums[WALK_IN_ENTITY] != nil {
            var rows: [HisaabUnpaid] = []
            for inv in invoices where walkInInvoiceIds.contains(inv.id) && inv.balanceDue > 0 && inv.status != .refunded {
                rows.append(HisaabUnpaid(id: inv.id, grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, balanceDue: inv.balanceDue))
            }
            unpaidBy[WALK_IN_ENTITY] = rows
        }

        var out = HisaabSummary()
        for id in order {
            guard let s = sums[id] else { continue }
            if abs(s.cash) <= 0.001 && abs(s.gold) <= 0.001 { continue }
            let isCustomer: Bool
            switch s.type {
            case .customer: isCustomer = true
            case .karigar: isCustomer = false
            default: isCustomer = id == WALK_IN_ENTITY || customerIds.contains(id)
            }
            out.accounts.append(HisaabAccount(id: id, name: s.name, isCustomer: isCustomer, cash: s.cash, gold: s.gold, unpaid: unpaidBy[id] ?? []))
            out.receivable += max(0, s.cash)
            out.payable += abs(min(0, s.cash))
            out.receivableGold += max(0, s.gold)
            out.payableGold += abs(min(0, s.gold))
        }
        out.accounts.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return out
    }
}

/// A row of a person's ledger and where the balances stood once it was written.
struct HisaabLedgerLine: Identifiable {
    let entry: HisaabEntry
    let cash: Double
    let gold: Double
    var id: String { entry.id }
}

struct HisaabLedgerPage {
    /// Newest first, as the page shows them.
    var lines: [HisaabLedgerLine] = []
    var cash = 0.0
    var gold = 0.0
    var hasGold = false
}

enum HisaabLedger {
    // TODO(logic): port the person page's running balance (src/app/hisaab/[entityId]/page.tsx;
    // page-local in the TypeScript) to ERPCore with a test.
    /// Oldest first, adding debit less credit as it goes, then turned back newest first.
    static func page(_ rows: [HisaabEntry]) -> HisaabLedgerPage {
        var keyed: [(entry: HisaabEntry, at: Double)] = []
        for r in rows { keyed.append((r, ERPDate.parse(r.date)?.timeIntervalSince1970 ?? 0)) }
        keyed.sort { a, b in
            if a.at != b.at { return a.at < b.at }
            return a.entry.id < b.entry.id
        }
        var page = HisaabLedgerPage()
        var lines: [HisaabLedgerLine] = []
        for k in keyed {
            page.cash += k.entry.cashDebit - k.entry.cashCredit
            page.gold += k.entry.goldDebitGrams - k.entry.goldCreditGrams
            if k.entry.goldDebitGrams > 0 || k.entry.goldCreditGrams > 0 { page.hasGold = true }
            lines.append(HisaabLedgerLine(entry: k.entry, cash: page.cash, gold: page.gold))
        }
        page.lines = Array(lines.reversed())
        return page
    }
}
