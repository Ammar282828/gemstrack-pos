// Ported from src/app/my-work/page.tsx, src/app/api/karigar/me/route.ts and `groupJobsByOrder` in
// src/lib/workshop.ts (tests: KarigarPortalTests): what a karigar sees of their own work.
//
// The server hand-picks the fields (no customer names, phone numbers, prices or totals ever reach a
// karigar), so everything here is read from that answer and nothing else. It is not a Firestore
// document: the app asks /api/karigar/me, the same route the portal page asks.

import Foundation

/// The whole answer of /api/karigar/me.
public struct KarigarPortal: Decodable {
    /// "karigar", "owner" or "none".
    public let role: String
    /// An owner looking at a karigar's portal (?karigarId=…): read only.
    public let preview: Bool
    /// Nil when the account is no karigar's ("No work account found").
    public let karigar: KarigarPortalPerson?
    public let summary: KarigarPortalSummary
    public let jobs: [KarigarPortalJob]
    public let account: KarigarPortalAccount

    private enum K: String, CodingKey { case role, preview, karigar, summary, jobs, account }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        role = c.string(.role, default: "")
        preview = c.bool(.preview, default: false)
        karigar = c.object(.karigar)
        summary = c.object(.summary) ?? KarigarPortalSummary()
        jobs = c.list(.jobs)
        account = c.object(.account) ?? KarigarPortalAccount()
    }
}

public struct KarigarPortalPerson: Decodable, Hashable {
    public let id: String
    public let name: String

    private enum K: String, CodingKey { case id, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
    }
}

/// The three figures at the top: to do, late (7 days or more), urgent (14 or more).
public struct KarigarPortalSummary: Decodable, Hashable {
    public let active: Int
    public let inProgress: Int
    public let late: Int
    public let critical: Int
    public let oldestDays: Int

    private enum K: String, CodingKey { case active, inProgress, late, critical, oldestDays }

    public init() {
        active = 0
        inProgress = 0
        late = 0
        critical = 0
        oldestDays = 0
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        active = c.int(.active) ?? 0
        inProgress = c.int(.inProgress) ?? 0
        late = c.int(.late) ?? 0
        critical = c.int(.critical) ?? 0
        oldestDays = c.int(.oldestDays) ?? 0
    }
}

/// One piece of the karigar's work: off an order, or a stock job.
public struct KarigarPortalJob: Decodable, Identifiable, Hashable {
    /// "order:<orderId>:<index>" or "job:<id>": what the server is told to mark done.
    public let id: String
    /// "order" or "manual".
    public let source: String
    public let description: String
    public let category: String?
    public let metalType: String?
    public let karat: String?
    public let weightG: Double?
    public let quantity: Double?
    public let size: String?
    public let referenceSku: String?
    public let sampleGiven: Bool
    /// A picture as a data address ("data:image/jpeg;base64,…").
    public let sampleImage: String?
    public let plating: String?
    public let orderId: String?
    /// "pending", "in-progress" or "completed".
    public let status: String
    public let assignedDate: String
    public let ageDays: Int
    /// "ok", "warning" (7 days) or "critical" (14).
    public let urgency: String
    /// The making instructions, merged.
    public let notes: String?

    private enum K: String, CodingKey {
        case id, source, description, category, metalType, karat, weightG, quantity, size, referenceSku
        case sampleGiven, sampleImage, plating, orderId, status, assignedDate, ageDays, urgency, notes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        source = c.string(.source, default: "")
        description = c.string(.description, default: "")
        category = c.string(.category)
        metalType = c.string(.metalType)
        karat = c.string(.karat)
        weightG = c.double(.weightG)
        quantity = c.double(.quantity)
        size = c.string(.size)
        referenceSku = c.string(.referenceSku)
        sampleGiven = c.bool(.sampleGiven, default: false)
        sampleImage = c.string(.sampleImage)
        plating = c.string(.plating)
        orderId = c.string(.orderId)
        status = c.string(.status, default: "pending")
        assignedDate = c.string(.assignedDate, default: "")
        ageDays = c.int(.ageDays) ?? 0
        urgency = c.string(.urgency, default: "ok")
        notes = c.string(.notes)
    }

    public var isDone: Bool { status == "completed" }
}

/// Their own account: the gold they were given and gave back, and what they were paid.
public struct KarigarPortalAccount: Decodable {
    public let goldGiven: Double
    public let goldReceived: Double
    /// Still with them.
    public let goldNet: Double
    public let totalPaid: Double
    public let ledger: [KarigarPortalGoldLine]
    public let payments: [KarigarPortalPayment]

    private enum K: String, CodingKey { case goldGiven, goldReceived, goldNet, totalPaid, ledger, payments }

    public init() {
        goldGiven = 0
        goldReceived = 0
        goldNet = 0
        totalPaid = 0
        ledger = []
        payments = []
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        goldGiven = c.double(.goldGiven, default: 0)
        goldReceived = c.double(.goldReceived, default: 0)
        goldNet = c.double(.goldNet, default: 0)
        totalPaid = c.double(.totalPaid, default: 0)
        ledger = c.list(.ledger)
        payments = c.list(.payments)
    }
}

public struct KarigarPortalGoldLine: Decodable, Hashable {
    public let date: String
    public let description: String
    public let goldOut: Double
    public let goldIn: Double

    private enum K: String, CodingKey { case date, description, goldOut, goldIn }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        description = c.string(.description, default: "")
        goldOut = c.double(.goldOut, default: 0)
        goldIn = c.double(.goldIn, default: 0)
    }
}

public struct KarigarPortalPayment: Decodable, Hashable {
    public let date: String
    public let amount: Double
    public let description: String

    private enum K: String, CodingKey { case date, amount, description }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        amount = c.double(.amount, default: 0)
        description = c.string(.description, default: "")
    }
}

/// The pieces of one order together: a karigar receives work by order (`JobOrderGroup`).
public struct KarigarPortalGroup: Identifiable, Hashable {
    public let key: String
    /// The order's number; nil for a stock piece.
    public let orderId: String?
    public let isStock: Bool
    public let jobs: [KarigarPortalJob]
    /// The oldest piece's age.
    public let ageDays: Int
    public let assignedDate: String

    public var id: String { key }

    /// The card's own urgency: finished is never urgent; otherwise 14 days critical, 7 a warning.
    public var urgency: String {
        if jobs.allSatisfy({ $0.isDone }) { return "ok" }
        return ageDays >= 14 ? "critical" : (ageDays >= 7 ? "warning" : "ok")
    }
}

/// How the page lays the work out: Urgent, Late, In hand, and the finished.
public struct KarigarPortalSections {
    public let active: [KarigarPortalJob]
    public let critical: [KarigarPortalJob]
    public let late: [KarigarPortalJob]
    public let onTrack: [KarigarPortalJob]
    public let done: [KarigarPortalJob]
}

public enum KarigarPortalRules {
    /// By order number, then the oldest first (`byOrderThenAge`); a stock piece, with no order, sorts last.
    private static func byOrderThenAge(_ a: KarigarPortalJob, _ b: KarigarPortalJob) -> Double {
        func word(_ j: KarigarPortalJob) -> String {
            let id = j.orderId ?? ""
            return id.isEmpty ? "zzz" : id
        }
        let order = JS.localeCompare(word(a), word(b))
        if order != 0 { return Double(order) }
        return Double(b.ageDays - a.ageDays)
    }

    public static func sections(_ jobs: [KarigarPortalJob]) -> KarigarPortalSections {
        let active = jobs.filter { !$0.isDone }
        return KarigarPortalSections(
            active: active,
            critical: active.filter { $0.urgency == "critical" }.jsSorted(by: byOrderThenAge),
            late: active.filter { $0.urgency == "warning" }.jsSorted(by: byOrderThenAge),
            onTrack: active.filter { $0.urgency == "ok" }.jsSorted(by: byOrderThenAge),
            done: jobs.filter { $0.isDone }
        )
    }

    /// Pieces under the order they belong to, the oldest group first (`groupJobsByOrder`). A stock piece stands alone.
    public static func groups(_ jobs: [KarigarPortalJob]) -> [KarigarPortalGroup] {
        struct Open {
            var key: String
            var orderId: String?
            var isStock: Bool
            var jobs: [KarigarPortalJob]
            var ageDays: Int
            var assignedDate: String
        }
        var order: [String] = []
        var open: [String: Open] = [:]
        for j in jobs {
            let orderId = j.source == "order" && !(j.orderId ?? "").isEmpty ? j.orderId : nil
            let key = orderId.map { "order:" + $0 } ?? "job:" + j.id
            if var existing = open[key] {
                existing.jobs.append(j)
                existing.ageDays = max(existing.ageDays, j.ageDays)
                open[key] = existing
            } else {
                order.append(key)
                open[key] = Open(key: key, orderId: orderId, isStock: j.source == "manual", jobs: [j], ageDays: j.ageDays, assignedDate: j.assignedDate)
            }
        }
        let all = order.compactMap { open[$0] }.map {
            KarigarPortalGroup(key: $0.key, orderId: $0.orderId, isStock: $0.isStock, jobs: $0.jobs, ageDays: $0.ageDays, assignedDate: $0.assignedDate)
        }
        return all.jsSorted { Double($1.ageDays - $0.ageDays) }
    }

    /// One facet of a piece's spec grid.
    public struct Spec: Hashable {
        public let label: String
        public let value: String
        /// Size and finish are what the bench must get right: drawn apart.
        public let accent: Bool
    }

    /// The spec boxes under a piece, in the page's order: Size, Weight, Finish, Type, Karat, Ref, Qty.
    public static func specs(_ job: KarigarPortalJob) -> [Spec] {
        var out: [Spec] = []
        if let size = job.size, !size.isEmpty { out.append(Spec(label: "Size", value: size, accent: true)) }
        if let w = job.weightG, w != 0 { out.append(Spec(label: "Weight", value: JS.number(w) + "g", accent: false)) }
        if let plating = job.plating, !plating.isEmpty { out.append(Spec(label: "Finish", value: plating, accent: true)) }
        if let category = job.category, !category.isEmpty { out.append(Spec(label: "Type", value: category, accent: false)) }
        if let karat = job.karat, !karat.isEmpty { out.append(Spec(label: "Karat", value: karat.uppercased(), accent: false)) }
        if let ref = job.referenceSku, !ref.isEmpty { out.append(Spec(label: "Ref", value: ref, accent: false)) }
        if let q = job.quantity, q > 1 { out.append(Spec(label: "Qty", value: JS.number(q), accent: false)) }
        return out
    }

    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// date-fns' `dd MMM yyyy` ("05 Oct 2026", or `dd MMM yy` when `shortYear`) on Karachi's day; empty when it does not read.
    public static func date(_ iso: String, shortYear: Bool = false) -> String {
        guard let d = JS.parseISO(iso) else { return "" }
        let parts = ERPDate.karachiDay(d).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return "" }
        let year = shortYear ? String(format: "%02d", parts[0] % 100) : String(parts[0])
        return String(format: "%02d", parts[2]) + " " + months[parts[1] - 1] + " " + year
    }

    /// Grams the way the page prints them: `toFixed(3)` and a g.
    public static func grams(_ g: Double) -> String { JS.toFixed(g, 3) + "g" }
}
