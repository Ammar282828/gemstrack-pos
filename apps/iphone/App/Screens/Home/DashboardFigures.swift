import Foundation
import ERPCore

// What the dashboard says, worked out once from the shelves (src/app/page.tsx `stats` and `tasks`).
// No view in this file. Every money and timing rule is ERPCore's (owedToYou, invoiceSaleValue,
// bookedAsSale, orderTiming, timingLabel, awaitingTransfer, isActiveOrder); what is here is only the
// page's own gathering of them, and the few helpers the page uses that ERPCore does not hold yet
// (each marked TODO(logic)).
//
// Every type here is prefixed Dash so it cannot meet another screen group's type of the same name.

// MARK: Dates

/// Karachi's days and the web's date-fns formats. "Today" and "this month" are the shop's, wherever the phone is.
enum DashDate {
    static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    private static let karachiOffset: TimeInterval = 5 * 3600

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let zoneless: [DateFormatter] = [
        formatter("yyyy-MM-dd'T'HH:mm:ss.SSS"),
        formatter("yyyy-MM-dd'T'HH:mm:ss"),
        formatter("yyyy-MM-dd'T'HH:mm"),
    ]
    private static let dayMonthFormat = formatter("d MMM")
    private static let weekdayDayMonthFormat = formatter("EEE d MMM")
    private static let longDayFormat = formatter("EEEE, d MMMM yyyy")
    private static let weekdayMonthFormat = formatter("EEEE d MMMM")
    private static let monthNameFormat = formatter("MMMM")
    private static let clockFormat: DateFormatter = {
        let f = formatter("h:mm a")
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f
    }()

    /// `new Date(iso)`: an instant, a bare day (UTC midnight) or a date-time with no zone (Karachi's clock).
    static func newDate(_ s: String?) -> Date? {
        guard let t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        if let d = ERPDate.parse(t) { return d }
        for f in zoneless {
            if let d = f.date(from: t) { return d }
        }
        return nil
    }

    /// date-fns `parseISO`: as `newDate`, except that a bare day is the local (here Karachi's) midnight.
    static func parseISO(_ s: String?) -> Date? {
        guard let t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        if t.count == 10, let d = ERPDate.parse(t) { return d.addingTimeInterval(-karachiOffset) }
        return newDate(t)
    }

    static func startOfDay(_ d: Date) -> Date { karachi.startOfDay(for: d) }

    static func startOfMonth(_ d: Date) -> Date {
        karachi.dateInterval(of: .month, for: d)?.start ?? karachi.startOfDay(for: d)
    }

    static func adding(days: Int, to d: Date) -> Date { karachi.date(byAdding: .day, value: days, to: d) ?? d }

    static func adding(months: Int, to d: Date) -> Date { karachi.date(byAdding: .month, value: months, to: d) ?? d }

    /// date-fns `differenceInCalendarDays(later, earlier)`.
    static func calendarDays(_ later: Date, since earlier: Date) -> Int {
        let from = karachi.startOfDay(for: earlier)
        let to = karachi.startOfDay(for: later)
        return karachi.dateComponents([.day], from: from, to: to).day ?? 0
    }

    /// "8 Oct".
    static func dayMonth(_ d: Date) -> String { dayMonthFormat.string(from: d) }

    static func dayMonth(iso: String?) -> String { newDate(iso).map { dayMonthFormat.string(from: $0) } ?? "" }

    /// "Thu 8 Oct".
    static func weekdayDayMonth(_ d: Date) -> String { weekdayDayMonthFormat.string(from: d) }

    /// "Thursday, 8 October 2026".
    static func longDay(_ d: Date) -> String { longDayFormat.string(from: d) }

    /// "Thursday 8 October".
    static func dayLabel(_ d: Date) -> String { weekdayMonthFormat.string(from: d) }

    /// "October".
    static func monthName(_ d: Date) -> String { monthNameFormat.string(from: d) }

    /// "2:30 pm", as ShopDate says a time.
    static func clock(iso: String?) -> String { newDate(iso).map { clockFormat.string(from: $0) } ?? "" }
}

// MARK: Small shared helpers

enum DashSort {
    static func cmp(_ a: Double, _ b: Double) -> Int { a < b ? -1 : (a > b ? 1 : 0) }

    /// JavaScript's `sort`: stable, `order` negative puts `a` first.
    static func stable<T>(_ list: [T], _ order: (T, T) -> Int) -> [T] {
        let indexed = Array(list.enumerated())
        let sorted = indexed.sorted { (l: (offset: Int, element: T), r: (offset: Int, element: T)) -> Bool in
            let c = order(l.element, r.element)
            return c != 0 ? c < 0 : l.offset < r.offset
        }
        return sorted.map { $0.element }
    }
}

enum DashText {
    /// `customerName || 'Walk-in'`.
    static func name(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "Walk-in" }
        return s
    }

    static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s
    }

    static func plural(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? one : many }
}

/// Where a row opens (ERP paths; a path with no native screen opens the ERP's own page).
enum DashPath {
    private static let safe: CharacterSet = {
        var s = CharacterSet.alphanumerics
        s.insert(charactersIn: "-_.~")
        return s
    }()

    private static func item(_ prefix: String, _ id: String) -> String {
        prefix + (id.addingPercentEncoding(withAllowedCharacters: safe) ?? id)
    }

    static func order(_ id: String) -> String { item("/orders/", id) }
    static func invoice(_ id: String) -> String { item("/invoices/", id) }
    // The ERP opens a repair on its list page (/repairs?id=); there is no /repairs/<id>.
    static func repair(_ id: String) -> String { item("/repairs?id=", id) }
    static func customer(_ id: String) -> String { item("/customers/", id) }
    static func karigar(_ id: String) -> String { item("/karigars/", id) }
}

// MARK: Rules the page uses that ERPCore does not hold yet

enum DashRules {
    // TODO(logic): port getInvoiceRevenueDate (store.ts)
    /// A sale counts on its order's day when it came from one.
    static func revenueDate(of inv: Invoice, orders: [String: Order]) -> String {
        if let source = inv.sourceOrderId, !source.isEmpty, let o = orders[source], !o.createdAt.isEmpty {
            return o.createdAt
        }
        return inv.createdAt
    }

    // TODO(logic): port repairTotal (store.ts)
    static func repairTotal(_ r: Repair) -> Double {
        var sum = 0.0
        for p in r.pieces {
            let price = p.price ?? 0
            sum += price.isNaN ? 0 : price
        }
        return sum
    }

    // TODO(logic): port isBusinessCost (partnership.ts)
    /// A partner's drawing is not a cost of earning.
    static func isBusinessCost(_ e: Expense) -> Bool { e.category != "Partner Drawings" }
}

// MARK: The workshop

// TODO(logic): port buildWorkshopJobs, WorkshopJob and urgencyOf (workshop.ts); only what the dashboard reads is here.

struct DashBenchJob {
    let karigarId: String
    let karigarName: String
    let ageDays: Int
    /// The piece or job is finished (the web's status 'completed').
    let done: Bool
    /// When it was handed over, in milliseconds; NaN when the date does not read.
    let assignedAt: Double

    var isCritical: Bool { !done && ageDays >= DashBench.criticalDays }
    var isUnassigned: Bool { karigarId == DashBench.unassignedId }
}

enum DashBench {
    static let unassignedId = "__unassigned__"
    /// Sitting this long on the bench is critical (workshop.ts CRITICAL_DAYS).
    static let criticalDays = 14

    /// `Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000))`.
    static func daysSince(_ iso: String?, _ now: Date) -> Int {
        guard let t = DashDate.newDate(iso) else { return 0 }
        return max(0, Int((now.timeIntervalSince(t) / 86_400).rounded(.down)))
    }

    private static func millis(_ iso: String?) -> Double {
        guard let t = DashDate.newDate(iso) else { return .nan }
        return t.timeIntervalSince1970 * 1000
    }

    private static func realKarigar(_ id: String?) -> String {
        guard let id, !id.isEmpty, id != "none" else { return "" }
        return id
    }

    /// Orders' pieces, karigar jobs, and sold pieces still needing bench work, newest first, finished last.
    static func jobs(orders: [Order], karigarJobs: [KarigarJob], karigars: [Karigar], invoices: [Invoice], now: Date) -> [DashBenchJob] {
        var names: [String: String] = [:]
        for k in karigars { names[k.id] = k.name }
        var out: [DashBenchJob] = []
        out.append(contentsOf: fromOrders(orders, names, now))
        out.append(contentsOf: fromJobs(karigarJobs, names, now))
        out.append(contentsOf: fromInvoices(invoices, names, now))
        return DashSort.stable(out) { (a: DashBenchJob, b: DashBenchJob) -> Int in
            if a.done != b.done { return a.done ? 1 : -1 }
            let d = b.assignedAt - a.assignedAt
            return d.isNaN ? 0 : DashSort.cmp(d, 0)
        }
    }

    private static func fromOrders(_ orders: [Order], _ names: [String: String], _ now: Date) -> [DashBenchJob] {
        var out: [DashBenchJob] = []
        for o in orders {
            if o.status == .cancelled || o.status == .refunded { continue }
            if !(o.invoiceId ?? "").isEmpty { continue }
            // An online order whose transfer is not in is not work yet.
            if awaitingTransfer(o) { continue }
            let age = daysSince(o.createdAt, now)
            let assigned = millis(o.createdAt)
            for item in o.items {
                let raw = realKarigar(item.karigarId)
                let name = raw.isEmpty ? "Unassigned" : (DashText.nonEmpty(names[raw]) ?? "Unknown karigar")
                // An order marked Completed means the work is done, ticked piece by piece or not.
                let done = item.isCompleted || o.status == .completed
                out.append(DashBenchJob(karigarId: raw.isEmpty ? unassignedId : raw, karigarName: name, ageDays: age, done: done, assignedAt: assigned))
            }
        }
        return out
    }

    private static func fromJobs(_ jobs: [KarigarJob], _ names: [String: String], _ now: Date) -> [DashBenchJob] {
        var out: [DashBenchJob] = []
        for j in jobs {
            let raw = j.karigarId
            let name = raw.isEmpty ? "Unassigned" : (DashText.nonEmpty(names[raw]) ?? DashText.nonEmpty(j.karigarName) ?? "Unknown karigar")
            out.append(DashBenchJob(karigarId: raw.isEmpty ? unassignedId : raw, karigarName: name,
                                    ageDays: daysSince(j.assignedDate, now), done: j.status == .completed, assignedAt: millis(j.assignedDate)))
        }
        return out
    }

    private static func fromInvoices(_ invoices: [Invoice], _ names: [String: String], _ now: Date) -> [DashBenchJob] {
        var out: [DashBenchJob] = []
        for inv in invoices {
            if inv.status == .refunded { continue }
            // An online sale needs bench work only while it is unfulfilled; a piece already handed to a karigar always shows.
            let fulfilment = (inv.shopifyFulfillment ?? "").lowercased()
            let fromShopify = (inv.source ?? "").hasPrefix("shopify") && (inv.shopifyCancelledAt ?? "").isEmpty
            let unfulfilledNote = (inv.notes ?? "").range(of: "unfulfilled", options: .caseInsensitive) != nil
            let isOnline = fromShopify && (fulfilment.isEmpty ? unfulfilledNote : fulfilment != "fulfilled")
            let age = daysSince(inv.createdAt, now)
            let assignedAt = millis(inv.createdAt)
            for item in inv.items {
                let assigned = realKarigar(item.karigarId)
                if !isOnline && assigned.isEmpty { continue }
                if item.isCompleted { continue }
                let name = assigned.isEmpty ? "Unassigned" : (DashText.nonEmpty(names[assigned]) ?? "Unknown karigar")
                out.append(DashBenchJob(karigarId: assigned.isEmpty ? unassignedId : assigned, karigarName: name, ageDays: age, done: false, assignedAt: assignedAt))
            }
        }
        return out
    }
}

// MARK: Birthdays and anniversaries

// TODO(logic): port upcomingOccasions, daysUntilAnniversaryOf and occasionWhen (occasions.ts)

struct DashOccasion {
    let customerId: String
    let customerName: String
    let isBirthday: Bool
    /// Days from today; negative means it has just passed.
    let inDays: Int

    var when: String {
        if inDays == 0 { return "today" }
        if inDays == 1 { return "tomorrow" }
        if inDays < 0 {
            let n = abs(inDays)
            return "\(n) day\(n == 1 ? "" : "s") ago"
        }
        return "in \(inDays) days"
    }
}

enum DashOccasions {
    /// A fortnight ahead, two days behind: a date noticed the morning after is still worth a message.
    static let daysAhead = 14
    static let daysBehind = 2

    private static func isDigits(_ s: Substring) -> Bool { s.allSatisfy { $0.isASCII && $0.isNumber } }

    private static func date(year: Int, month: Int, day: Int) -> Date {
        let cal = DashDate.karachi
        var c = DateComponents()
        c.year = year
        c.month = 1
        c.day = 1
        let january = cal.date(from: c) ?? Date()
        let first = cal.date(byAdding: .month, value: month - 1, to: january) ?? january
        return cal.date(byAdding: .day, value: day - 1, to: first) ?? first
    }

    /// Days until this month-and-day next comes round; the stored year is ignored, a date just gone stays visible.
    static func daysUntil(_ iso: String, today: Date) -> Int? {
        let parts = String(iso.suffix(5)).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2, isDigits(parts[0]), isDigits(parts[1]),
              let month = Int(parts[0]), let day = Int(parts[1]) else { return nil }
        let cal = DashDate.karachi
        let midnight = cal.startOfDay(for: today)
        let year = cal.component(.year, from: today)
        let thisYear = date(year: year, month: month, day: day)
        let diff = Int((thisYear.timeIntervalSince(midnight) / 86_400).rounded())
        if diff >= -daysBehind { return diff }
        let nextYear = date(year: year + 1, month: month, day: day)
        return Int((nextYear.timeIntervalSince(midnight) / 86_400).rounded())
    }

    static func upcoming(_ customers: [Customer], today: Date) -> [DashOccasion] {
        var found: [DashOccasion] = []
        for c in customers where (c.deletedAt ?? "").isEmpty {
            let dates: [(isBirthday: Bool, iso: String?)] = [(true, c.birthday), (false, c.anniversary)]
            for d in dates {
                guard let iso = d.iso, !iso.isEmpty, let inDays = daysUntil(iso, today: today) else { continue }
                if inDays > daysAhead || inDays < -daysBehind { continue }
                found.append(DashOccasion(customerId: c.id, customerName: c.name, isBirthday: d.isBirthday, inDays: inDays))
            }
        }
        return DashSort.stable(found) { (a: DashOccasion, b: DashOccasion) -> Int in a.inDays - b.inDays }
    }
}

// MARK: Rows

/// A promise to a customer: an order or a repair, by when it is due.
struct DashDue: Identifiable {
    let id: String
    let path: String
    let isRepair: Bool
    /// ORD-… or REP-….
    let ref: String
    let customer: String
    let amount: Double
    let timing: OrderTiming
    let promisedDate: String?

    var isLate: Bool { timing.state == .late }

    var refLine: String { isRepair ? "Repair · \(ref)" : ref }

    /// "3 days late", "due today", "Fri 9 Oct", "no date".
    var whenText: String {
        let t = timing
        if let due = t.due {
            if t.state == .late || t.state == .today { return timingLabel(t) }
            let said = ShopDate.say(promisedDate)
            return said.isEmpty ? DashDate.weekdayDayMonth(due) : said
        }
        return t.state == .late ? timingLabel(t) : "no date"
    }

    /// Late first, then today, then soonest, then the undated by age.
    static func before(_ a: DashDue, _ b: DashDue) -> Int {
        func rank(_ t: OrderTiming) -> Int { t.state == .late ? 0 : (t.state == .today ? 1 : (t.due != nil ? 2 : 3)) }
        let r = rank(a.timing) - rank(b.timing)
        if r != 0 { return r }
        if let x = a.timing.due, let y = b.timing.due {
            let c = DashSort.cmp(x.timeIntervalSince1970, y.timeIntervalSince1970)
            if c != 0 { return c }
        }
        return b.timing.daysLate - a.timing.daysLate
    }
}

/// A row in "Needs you": one thing waiting on a decision.
struct DashNeed: Identifiable {
    enum Tone { case danger, warn, plain }

    let id: String
    let path: String
    let tone: Tone
    let title: String
    let detail: String
    var amount: Double?
}

struct DashDay: Identifiable {
    let day: Date
    let amount: Double
    var id: Date { day }
}

/// taheri.shop's selling is on but paused for an old rate (the server says: /api/website/online?count=1).
struct DashRatePause {
    let ratesUpdatedAt: String?
}

// MARK: The figures

struct DashFigures {
    let now: Date

    // The four headline figures.
    private(set) var todayRevenue = 0.0
    private(set) var todayInvoiceCount = 0
    private(set) var monthRevenue = 0.0
    private(set) var lastMonthRevenue = 0.0
    /// Invoices owing, largest balance first.
    private(set) var unpaid: [Invoice] = []
    private(set) var totalOutstanding = 0.0
    /// The part of `totalOutstanding` the hisaab holds by hand.
    private(set) var owedInHisaab = 0.0
    private(set) var activeJobs = 0
    private(set) var criticalJobs: [DashBenchJob] = []
    private(set) var unassignedJobs: [DashBenchJob] = []

    // The lists.
    private(set) var due: [DashDue] = []
    private(set) var readyWaiting: [Repair] = []
    private(set) var recentInvoices: [Invoice] = []
    private(set) var occasions: [DashOccasion] = []
    private var karigarIds: Set<String> = []

    // The 30-day line.
    private(set) var revenue30 = 0.0
    private(set) var expenses30 = 0.0
    private(set) var days: [DashDay] = []

    var net30: Double { revenue30 - expenses30 }
    var lateDue: [DashDue] { due.filter { $0.isLate } }

    private struct Event {
        let at: Date
        let amount: Double
    }

    init(orders: [Order], invoices: [Invoice], revenues: [AdditionalRevenue], expenses: [Expense],
         karigars: [Karigar], karigarJobs: [KarigarJob], repairs: [Repair], customers: [Customer],
         hisaab: [HisaabEntry], now: Date) {
        self.now = now
        let liveKarigars = karigars.filter { ($0.deletedAt ?? "").isEmpty }
        karigarIds = Set(liveKarigars.map { $0.id })
        gatherRevenue(orders: orders, invoices: invoices, revenues: revenues, expenses: expenses)
        gatherOwed(invoices: invoices, hisaab: hisaab)
        gatherBench(orders: orders, karigarJobs: karigarJobs, karigars: liveKarigars, invoices: invoices)
        gatherDue(orders: orders, repairs: repairs)
        occasions = DashOccasions.upcoming(customers, today: now)
        recentInvoices = Array(invoices.prefix(12))
    }

    // MARK: gathering

    private static func total(_ events: [Event], from: Date, before: Date? = nil) -> Double {
        var sum = 0.0
        for e in events where e.at >= from {
            if let before, e.at >= before { continue }
            sum += e.amount
        }
        return sum
    }

    private mutating func gatherRevenue(orders: [Order], invoices: [Invoice], revenues: [AdditionalRevenue], expenses: [Expense]) {
        let todayStart = DashDate.startOfDay(now)
        let monthStart = DashDate.startOfMonth(now)
        let lastMonthStart = DashDate.startOfMonth(DashDate.adding(months: -1, to: now))
        // "Last 30 days" is today plus the 29 before, as Analytics has it.
        let last30Start = DashDate.startOfDay(DashDate.adding(days: -29, to: now))

        var ordersById: [String: Order] = [:]
        for o in orders { ordersById[o.id] = o }

        // Revenue is recognised on the source order's date, and counts an exchange as payment (invoiceSaleValue).
        var events: [Event] = []
        var invoicesToday = 0
        for inv in invoices where inv.status != .refunded {
            guard let at = DashDate.parseISO(DashRules.revenueDate(of: inv, orders: ordersById)) else { continue }
            events.append(Event(at: at, amount: invoiceSaleValue(inv)))
            if at >= todayStart { invoicesToday += 1 }
        }
        // A counter order not yet invoiced is a sale once taken (bookedAsSale); an online one waits for its transfer.
        for o in orders where bookedAsSale(o) {
            guard let at = DashDate.parseISO(o.createdAt) else { continue }
            events.append(Event(at: at, amount: o.subtotal.isNaN ? 0 : o.subtotal))
        }
        for r in revenues {
            guard let at = DashDate.parseISO(r.date) else { continue }
            events.append(Event(at: at, amount: r.amount.isNaN ? 0 : r.amount))
        }

        todayInvoiceCount = invoicesToday
        todayRevenue = Self.total(events, from: todayStart)
        monthRevenue = Self.total(events, from: monthStart)
        lastMonthRevenue = Self.total(events, from: lastMonthStart, before: monthStart)
        revenue30 = Self.total(events, from: last30Start)

        var perDay = [Double](repeating: 0, count: 30)
        for e in events where e.at >= last30Start {
            let index = Int(e.at.timeIntervalSince(last30Start) / 86_400)
            if index >= 0 && index < 30 { perDay[index] += e.amount }
        }
        days = (0..<30).map { (i: Int) -> DashDay in
            DashDay(day: DashDate.adding(days: i, to: last30Start), amount: perDay[i])
        }

        // The 30-day profit line leaves partner drawings out.
        var spent = 0.0
        for e in expenses where DashRules.isBusinessCost(e) {
            guard let at = DashDate.parseISO(e.date), at >= last30Start else { continue }
            spent += e.amount.isNaN ? 0 : e.amount
        }
        expenses30 = spent
    }

    private mutating func gatherOwed(invoices: [Invoice], hisaab: [HisaabEntry]) {
        // The one selector the customer list, Invoices and Hisaab read too (lib/owed.ts), with the hisaab's hand-written balances added.
        let owed = owedToYou(invoices, currentName: nil, ledgerRows: hisaab)
        unpaid = DashSort.stable(owed.invoices) { (a: Invoice, b: Invoice) -> Int in DashSort.cmp(b.balanceDue, a.balanceDue) }
        totalOutstanding = owed.total
        owedInHisaab = owed.ledger
    }

    private mutating func gatherBench(orders: [Order], karigarJobs: [KarigarJob], karigars: [Karigar], invoices: [Invoice]) {
        let jobs = DashBench.jobs(orders: orders, karigarJobs: karigarJobs, karigars: karigars, invoices: invoices, now: now)
        let active = jobs.filter { !$0.done }
        activeJobs = active.count
        criticalJobs = DashSort.stable(active.filter { $0.isCritical }) { (a: DashBenchJob, b: DashBenchJob) -> Int in b.ageDays - a.ageDays }
        unassignedJobs = active.filter { $0.isUnassigned }
    }

    private mutating func gatherDue(orders: [Order], repairs: [Repair]) {
        var list: [DashDue] = []
        // Open orders; an online order waiting for its transfer is owed nothing yet.
        for o in orders where isActiveOrder(o) && !awaitingTransfer(o) {
            list.append(DashDue(id: "o" + o.id, path: DashPath.order(o.id), isRepair: false, ref: o.id,
                                customer: DashText.name(o.customerName), amount: o.grandTotal,
                                timing: orderTiming(o, now: now), promisedDate: o.promisedDate))
        }
        // Repairs still in the shop, timed by the same rule as an order in progress.
        for r in repairs where r.status == .received {
            list.append(DashDue(id: "r" + r.id, path: DashPath.repair(r.id), isRepair: true, ref: r.id,
                                customer: DashText.name(r.customerName), amount: DashRules.repairTotal(r),
                                timing: Self.repairTiming(r, now: now), promisedDate: r.promisedDate))
        }
        due = DashSort.stable(list, DashDue.before)

        // Repairs finished but not collected for a while: the customer needs a call.
        var waiting: [Repair] = []
        for r in repairs where r.status == .ready {
            guard let at = DashDate.parseISO(r.readyAt) else { continue }
            if DashDate.calendarDays(now, since: at) >= 3 { waiting.append(r) }
        }
        readyWaiting = waiting
    }

    // TODO(logic): ERPCore's orderTiming takes an Order; the TS takes any { promisedDate, createdAt, status }, which a repair is passed as.
    /// `orderTiming({ promisedDate, createdAt: receivedAt, status: 'In Progress' })`: an Order is read from the three fields it looks at.
    private static func repairTiming(_ r: Repair, now: Date) -> OrderTiming {
        var fields: [String: Any] = ["createdAt": r.receivedAt, "status": "In Progress"]
        if let promised = r.promisedDate { fields["promisedDate"] = promised }
        if let order = DocJSON.decode(Order.self, id: r.id, data: fields) {
            return orderTiming(order, now: now)
        }
        return OrderTiming(due: nil, daysLate: 0, state: .noPromise, estimated: true)
    }

    // MARK: Needs you

    private struct BenchGroup {
        let id: String
        let name: String
        var count: Int
        var oldest: Int
    }

    /// Everything actually waiting on a decision, worst first: grouped, not enumerated (page.tsx `tasks`).
    func needs(onlineWaiting: Int, ratePause: DashRatePause?) -> [DashNeed] {
        var out: [DashNeed] = []
        func add(_ path: String, _ tone: DashNeed.Tone, _ title: String, _ detail: String, amount: Double? = nil) {
            out.append(DashNeed(id: "\(out.count)|\(path)", path: path, tone: tone, title: title, detail: detail, amount: amount))
        }

        // taheri.shop sells only at a rate set in the last 36 hours.
        if let ratePause {
            let last = DashDate.dayMonth(iso: ratePause.ratesUpdatedAt)
            add("/settings?tab=rates", .danger, "Set today's gold rate — online selling is paused",
                last.isEmpty ? "The rate chip at the top" : "Last set \(last) · the rate chip at the top")
        }

        // An online order nobody has looked at: the customer is waiting for the bank details.
        if onlineWaiting > 0 {
            add("/orders", .danger, onlineWaiting == 1 ? "An online order to confirm" : "\(onlineWaiting) online orders to confirm",
                "From taheri.shop · they get the bank details when you confirm")
        }

        let late = lateDue
        if let worst = late.first {
            if late.count == 1 {
                add(worst.path, .danger, "\(worst.customer)’s \(worst.isRepair ? "repair" : "order") is late", timingLabel(worst.timing))
            } else {
                add(worst.path, .danger, "\(late.count) promises past their date", "Longest: \(worst.customer), \(timingLabel(worst.timing))")
            }
        }

        addBenchNeeds(add)

        let shown = unpaid.prefix(3)
        for inv in shown {
            add(DashPath.invoice(inv.id), .warn, DashText.name(inv.customerName), "Unpaid since \(DashDate.dayMonth(iso: inv.createdAt))", amount: inv.balanceDue)
        }
        let rest = unpaid.dropFirst(3)
        if !rest.isEmpty {
            let sum = rest.reduce(0.0) { (acc: Double, inv: Invoice) -> Double in acc + inv.balanceDue }
            add("/invoices", .warn, "\(rest.count) more unpaid", "Smaller balances", amount: sum)
        }

        for r in readyWaiting.prefix(3) {
            add(DashPath.repair(r.id), .warn, "\(DashText.name(r.customerName))’s repair is ready",
                "Waiting to be collected since \(DashDate.dayMonth(iso: r.readyAt))")
        }

        for o in occasions.prefix(4) {
            add(DashPath.customer(o.customerId), o.inDays <= 1 ? .warn : .plain, o.customerName,
                "\(o.isBirthday ? "Birthday" : "Anniversary") \(o.when)")
        }
        return out
    }

    /// One row per karigar with overdue pieces (the four worst), then the work nobody has.
    private func addBenchNeeds(_ add: (String, DashNeed.Tone, String, String, Double?) -> Void) {
        var order: [String] = []
        var groups: [String: BenchGroup] = [:]
        for j in criticalJobs where !j.isUnassigned {
            let key = j.karigarId.isEmpty ? j.karigarName : j.karigarId
            var cur = groups[key] ?? BenchGroup(id: j.karigarId, name: j.karigarName, count: 0, oldest: 0)
            if groups[key] == nil { order.append(key) }
            cur.count += 1
            cur.oldest = max(cur.oldest, j.ageDays)
            groups[key] = cur
        }
        let ranked = DashSort.stable(order.compactMap { groups[$0] }) { (a: BenchGroup, b: BenchGroup) -> Int in b.oldest - a.oldest }
        for g in ranked.prefix(4) {
            let path = karigarIds.contains(g.id) ? DashPath.karigar(g.id) : "/workshop"
            let detail = g.count == 1 ? "1 piece, \(g.oldest) days on the bench" : "\(g.count) pieces overdue · longest \(g.oldest) days"
            add(path, .danger, g.name, detail, nil)
        }
        if !unassignedJobs.isEmpty {
            let n = unassignedJobs.count
            add("/workshop", .danger, "\(n) unassigned piece\(n == 1 ? "" : "s")", "Nobody is making these yet", nil)
        }
    }
}
