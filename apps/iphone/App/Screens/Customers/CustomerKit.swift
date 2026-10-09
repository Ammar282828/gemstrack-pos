import SwiftUI
import ERPCore

/// What the three customer screens share: paths, words, the phone's links, and the customer
/// list's own figures. The money rules are ERPCore's (`owedToYou`, `ledgerBalances`,
/// `balanceLine`); what is here is only what customers/page.tsx works out for itself.
enum CustomerKit {

    // MARK: Paths

    /// "/customers/CUST-1" is the customer "CUST-1". Nil for the list, for "add", for a deeper page
    /// (".../edit" is `editId`'s), and for a path that asks for the ERP's page with "?web=1"
    /// (ScreenRoute.bare drops a query, so the screen has to look).
    static func id(fromPath path: String) -> String? {
        if asksForWeb(path) { return nil }
        let prefix = "/customers/"
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix(prefix) else { return nil }
        let rest = String(bare.dropFirst(prefix.count))
        guard !rest.isEmpty, !rest.contains("/"), rest != "add" else { return nil }
        return rest.removingPercentEncoding ?? rest
    }

    /// "/customers/CUST-1/edit" is the edit form of the customer "CUST-1". Nil for any other path, and for one
    /// that asks for the ERP's page with "?web=1".
    static func editId(fromPath path: String) -> String? {
        if asksForWeb(path) { return nil }
        let prefix = "/customers/"
        let suffix = "/edit"
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix(prefix), bare.hasSuffix(suffix) else { return nil }
        let rest = String(bare.dropFirst(prefix.count).dropLast(suffix.count))
        guard !rest.isEmpty, !rest.contains("/") else { return nil }
        return rest.removingPercentEncoding ?? rest
    }

    static func isList(_ path: String) -> Bool {
        !asksForWeb(path) && ScreenRoute.bare(path) == "/customers"
    }

    static func asksForWeb(_ path: String) -> Bool {
        guard let query = path.split(separator: "?", maxSplits: 1).dropFirst().first else { return false }
        return query.split(separator: "&").contains("web=1")
    }

    /// An id as one path piece ("CUST-1", or a Shopify name with a "#" in it).
    static func piece(_ id: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~"))
        return id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
    }

    /// The customer's page, or a page beneath it ("/edit"), or the ERP's own with "?web=1".
    static func path(_ id: String, suffix: String = "") -> String { "/customers/" + piece(id) + suffix }

    static func route(_ id: String) -> Route { Route(path: path(id)) }

    /// A place by prefix and id: "/invoices/" + "INV-000123".
    static func place(_ prefix: String, _ id: String) -> Route { Route(path: prefix + piece(id)) }

    static func hisaabPath(_ id: String) -> String { "/hisaab/" + piece(id) + "?type=customer" }

    // MARK: Words

    /// The ERP's `CUSTOMER_SOURCES`, in its order.
    static let sources: [CustomerSource] = [.taheriSpillover, .referral, .walkin, .socialMedia, .website, .other]

    /// `CUSTOMER_SOURCE_LABELS` (store.ts).
    static func sourceLabel(_ source: CustomerSource) -> String {
        switch source {
        case .taheriSpillover: return "Taheri Spillover"
        case .referral: return "Referral"
        case .walkin: return "Walk-in"
        case .socialMedia: return "Social media"
        case .website: return "Website"
        case .other: return "Other"
        case .unknown(let raw): return raw
        }
    }

    static func shown(_ customer: Customer) -> String {
        trim(customer.name).isEmpty ? "Unnamed customer" : customer.name
    }

    static func trim(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The text if there is any, else nil.
    static func filled(_ s: String?) -> String? {
        let t = trim(s)
        return t.isEmpty ? nil : t
    }

    /// The web's `z.string().email()`, loosely: something, an @, something with a dot. Blank is fine (the field is optional).
    static func validEmail(_ email: String) -> Bool {
        let e = trim(email)
        if e.isEmpty { return true }
        let parts = e.split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && parts[1].contains(".") && !e.contains(" ")
    }

    /// Removal hides, it does not destroy (store.ts splitRemoved): a customer with a `deletedAt` is out of every list.
    static func isRemoved(_ customer: Customer) -> Bool { !(customer.deletedAt ?? "").isEmpty }

    private static let monthYearFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "MMM yyyy"
        return f
    }()

    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM yyyy"
        return f
    }()

    /// "Oct 2026" (the list's "last sale").
    static func monthYear(_ iso: String?) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        return monthYearFormat.string(from: d)
    }

    /// A birthday or anniversary: "6 Oct 1990", whichever year it is (never "Today"). Unreadable text is shown as written.
    static func day(_ s: String?) -> String {
        guard let d = ERPDate.parse(s) else { return trim(s) }
        return dayFormat.string(from: d)
    }

    static func grams(_ g: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: g)) ?? String(g)
    }

    // MARK: The phone's links

    /// What can be dialled: digits, and a leading "+".
    static func dialable(_ phone: String?) -> String {
        var out = ""
        for ch in trim(phone) {
            if ch == "+" && out.isEmpty { out.append(ch) }
            else if ch >= "0" && ch <= "9" { out.append(ch) }
        }
        return out
    }

    static func callURL(_ phone: String?) -> URL? {
        let d = dialable(phone)
        return d.isEmpty ? nil : URL(string: "tel:" + d)
    }

    static func messageURL(_ phone: String?) -> URL? {
        let d = dialable(phone)
        return d.isEmpty ? nil : URL(string: "sms:" + d)
    }

    static func whatsAppURL(_ phone: String?) -> URL? {
        let n = whatsAppNumber(phone)
        return n.isEmpty ? nil : URL(string: "https://wa.me/" + n)
    }

    // TODO(logic): port toWhatsAppNumber (src/lib/whatsapp.ts). Digits with the country code,
    // Pakistan's when the number is written the Pakistani way: 0300 1234567 -> 923001234567; a
    // number written with its "+" or "00" is international and stays as written.
    static func whatsAppNumber(_ phone: String?) -> String {
        let raw = trim(phone)
        var digits = ""
        for ch in raw where ch >= "0" && ch <= "9" { digits.append(ch) }
        if digits.isEmpty { return "" }
        if raw.hasPrefix("+") { return digits }
        if digits.hasPrefix("00"), digits.count > 2, digits.dropFirst(2).first != "0" { return String(digits.dropFirst(2)) }
        if digits.hasPrefix("92") { return digits }
        if digits.hasPrefix("0") { return "92" + String(digits.drop(while: { $0 == "0" })) }
        // A Pakistani mobile written without its 0: 3xx xxxxxxx.
        if digits.count == 10 && digits.hasPrefix("3") { return "92" + digits }
        // Longer than any Pakistani number without a code: it carries its own.
        if digits.count >= 11 { return digits }
        return "92" + digits
    }

    // MARK: Owed, spent, last sale (customers/page.tsx)

    /// Lifetime spend, what is still owed, and when they last bought (the page's `CustomerStats`).
    struct Stats {
        var spent = 0.0
        var owed = 0.0
        var count = 0
        var lastAt: String?
    }

    /// One "owed" for the whole ERP (lib/owed.ts): invoices not refunded with a balance, walk-ins
    /// and typed names included, and, for an owner, the hisaab's hand-written balances. `ledger` is
    /// nil for staff: they have no hisaab, so the figure is invoices alone, as on their web page.
    /// The name lookup is the live book only (the web's `customers` has had the removed taken out).
    static func owed(invoices: [Invoice], customers: [Customer], ledger: [HisaabEntry]?) -> Owed {
        var names: [String: String] = [:]
        for c in customers where !isRemoved(c) { names[c.id] = c.name }
        let live = names
        return owedToYou(invoices, currentName: { live[$0] }, ledgerRows: ledger)
    }

    // TODO(logic): this is customers/page.tsx's `statsById`, local to that page, not a src/lib rule.
    /// Spend and last sale per customer from invoices (not refunded) and orders still open; what
    /// they owe is `owedToYou`'s, the dashboard's own figure. A customer known only from the
    /// hisaab (the old khata) has no sale here but still owes.
    static func stats(invoices: [Invoice], orders: [Order], owed: Owed) -> [String: Stats] {
        var map: [String: Stats] = [:]
        func bump(_ id: String?, _ total: Double, _ at: String) {
            guard let id, !id.isEmpty else { return }
            var cur = map[id] ?? Stats()
            cur.spent += total
            cur.count += 1
            if !at.isEmpty {
                if let last = cur.lastAt { if at > last { cur.lastAt = at } } else { cur.lastAt = at }
            }
            map[id] = cur
        }
        for inv in invoices where inv.status != .refunded {
            bump(inv.customerId, inv.grandTotal, inv.createdAt)
        }
        for (key, o) in owed.byKey {
            if var cur = map[key] {
                cur.owed = o.amount
                map[key] = cur
            } else if !key.hasPrefix("name:") && key != WALK_IN_ENTITY {
                map[key] = Stats(spent: 0, owed: o.amount, count: 0, lastAt: nil)
            }
        }
        for o in orders {
            if !(o.invoiceId ?? "").isEmpty || o.status == .cancelled || o.status == .refunded { continue }
            bump(o.customerId, o.subtotal, o.createdAt)
        }
        return map
    }

    /// What one customer owes, in the parts the screen says.
    struct Owing {
        var total = 0.0
        var onInvoices = 0.0
        /// The hisaab's hand-written balance, when it is owed to the shop (it is in `total`).
        var inHisaab = 0.0
        /// The hisaab's hand-written balance when the shop owes them; it lowers nothing.
        var shopOwesThem = 0.0
        var invoiceCount = 0
    }

    static func owing(_ id: String, owed: Owed, ledger: [HisaabEntry]?) -> Owing {
        var o = Owing()
        let mine = owed.byKey[id]
        o.total = mine?.amount ?? 0
        o.invoiceCount = mine?.count ?? 0
        if let ledger {
            let hand = ledgerBalances(ledger)[id] ?? 0
            if hand > 0.5 { o.inHisaab = hand }
            else if hand < -0.5 { o.shopOwesThem = -hand }
        }
        o.onInvoices = max(0, o.total - o.inHisaab)
        return o
    }

    // MARK: Who comes first (customers/page.tsx)

    struct Groups {
        var owing: [Customer] = []
        var active: [Customer] = []
        var quiet: [Customer] = []
    }

    static let dormantAfterMonths = 12

    /// Grouped by the reason you would be looking someone up: money outstanding first (most owed
    /// first), then people who bought in the last year (latest first), then everyone else (A to Z).
    static func groups(_ people: [Customer], stats: [String: Stats], now: Date = Date()) -> Groups {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = ERPDate.karachi
        let cutoff = ERPDate.iso(calendar.date(byAdding: .month, value: -dormantAfterMonths, to: now) ?? now)
        var g = Groups()
        for c in people {
            let s = stats[c.id]
            if let s, s.owed > 0 { g.owing.append(c) }
            else if let last = s?.lastAt, last >= cutoff { g.active.append(c) }
            else { g.quiet.append(c) }
        }
        g.owing = stable(g.owing) { a, b in (stats[b.id]?.owed ?? 0) - (stats[a.id]?.owed ?? 0) }
        g.active = stable(g.active) { a, b in
            let la = stats[a.id]?.lastAt ?? ""
            let lb = stats[b.id]?.lastAt ?? ""
            return la == lb ? 0 : (lb < la ? -1 : 1)
        }
        g.quiet = stable(g.quiet) { a, b in Double(a.name.localizedStandardCompare(b.name).rawValue) }
        return g
    }

    /// JavaScript's sort is stable and Swift's is not promised to be: ties keep the book's order.
    private static func stable(_ list: [Customer], _ compare: (Customer, Customer) -> Double) -> [Customer] {
        list.enumerated().sorted { l, r in
            let c = compare(l.element, r.element)
            return c != 0 ? c < 0 : l.offset < r.offset
        }.map { $0.element }
    }

    /// The list's search: name, phone or email (customers/page.tsx `matched`).
    static func matches(_ c: Customer, _ query: String) -> Bool {
        let q = trim(query)
        if q.isEmpty { return true }
        let lower = q.lowercased()
        return c.name.lowercased().contains(lower)
            || (c.phone ?? "").contains(q)
            || (c.email ?? "").lowercased().contains(lower)
    }

    // MARK: Repairs (src/lib/store.ts)

    // TODO(logic): port repairTotal / repairPaid / repairBalance / repairSummary (src/lib/store.ts).
    /// What the customer still owes on the ticket.
    static func repairBalance(_ r: Repair) -> Double {
        var total = 0.0
        for p in r.pieces { total += p.price ?? 0 }
        var paid = 0.0
        for p in r.payments { paid += p.amount }
        return max(0, ((total - paid) * 100).rounded() / 100)
    }

    /// "Gold ring" or "Gold ring + 2 more": a ticket in a line.
    static func repairSummary(_ r: Repair) -> String {
        let named = r.pieces.filter { !$0.item.isEmpty }
        if named.isEmpty { return "Repair" }
        return named.count == 1 ? named[0].item : "\(named[0].item) + \(named.count - 1) more"
    }

    /// The repair's steps in the shop's words: In the shop, Ready, Collected.
    static func repairStatus(_ s: RepairStatus) -> (text: String, color: Color) {
        switch s {
        case .received: return ("In the shop", .orange)
        case .ready: return ("Ready", .green)
        case .collected: return ("Collected", .secondary)
        case .cancelled: return ("Cancelled", .secondary)
        case .unknown(let raw): return (raw.isEmpty ? "No status" : raw, .secondary)
        }
    }
}
