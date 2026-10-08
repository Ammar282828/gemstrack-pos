import Foundation
import ERPCore

// The Workshop's rules, as the screens need them. Foundation and ERPCore only (no SwiftUI views).
//
// TODO(logic): port workshop.ts (buildWorkshopJobs, groupByKarigar, groupJobsByOrder,
// formatJobListForShare, mergeInstructions) and karigar-position.ts (karigarPosition) into
// ERPCore with their tests. They are ported line for line below so the board, the karigars list
// and the karigar's page agree with the web to the piece; none of them decides money.

/// One piece of bench work, whether it came off an order, an invoice (a Shopify sale, or a sold
/// piece sent back) or a standalone stock job (src/lib/workshop.ts `WorkshopJob`).
struct WorkshopJob: Identifiable {
    enum Source { case order, manual, invoice }
    enum Status { case pending, inProgress, completed }
    enum Urgency { case ok, warning, critical }

    let id: String
    let source: Source
    /// `WorkshopLogic.unassigned` when nobody is on it.
    let karigarId: String
    let karigarName: String
    let description: String
    let status: Status
    /// ISO; when the work was written up.
    let assignedDate: String
    let ageDays: Int
    let urgency: Urgency
    let sortTime: Double

    var orderId: String?
    var invoiceId: String?
    /// Who took the order or wrote the invoice this piece came off.
    var takenBy: String?
    var isOnline = false
    var itemIndex: Int?
    var customerName: String?
    var category: String?
    var metalType: String?
    var karat: String?
    var weightG: Double?
    var quantity: Double = 1
    var size: String?
    var referenceSku: String?
    /// When the piece physically went to the karigar. Unset until it did.
    var givenAt: String?
    var plating: String?
    /// The order item's estimate, or the agreed cost on a stock job.
    var value: Double = 0
    /// The merged instructions (stones, diamonds, the owner's note).
    var notes: String?

    init(id: String, source: Source, karigarId: String, karigarName: String, description: String, status: Status, assignedDate: String) {
        self.id = id
        self.source = source
        self.karigarId = karigarId
        self.karigarName = karigarName
        self.description = description
        self.status = status
        self.assignedDate = assignedDate
        let age = WorkshopLogic.daysSince(assignedDate)
        self.ageDays = age
        self.urgency = WorkshopLogic.urgency(status, age)
        self.sortTime = ERPDate.parse(assignedDate)?.timeIntervalSince1970 ?? 0
    }

    var isUnassigned: Bool { karigarId == WorkshopLogic.unassigned }
    var isDone: Bool { status == .completed }
    var hasGiven: Bool { !(givenAt ?? "").isEmpty }
}

/// One karigar's whole bench (`KarigarWorkload`): the counts the board and the list show.
struct WorkshopLoad: Identifiable {
    let karigarId: String
    let karigarName: String
    let jobs: [WorkshopJob]
    let active: Int
    let inProgress: Int
    let completed: Int
    /// Active jobs 7 days old or more.
    let overdue: Int
    /// Active jobs 14 days old or more.
    let critical: Int
    let oldestActiveDays: Int
    let totalValue: Double
    let totalWeightG: Double

    var id: String { karigarId }
    var isUnassigned: Bool { karigarId == WorkshopLogic.unassigned }
    /// Late but not yet critical.
    var late: Int { overdue - critical }

    init(karigarId: String, jobs list: [WorkshopJob]) {
        let activeJobs = list.filter { $0.status != .completed }
        self.karigarId = karigarId
        self.karigarName = list.first?.karigarName ?? "Unknown"
        self.jobs = list
        self.active = activeJobs.count
        self.inProgress = list.filter { $0.status == .inProgress }.count
        self.completed = list.filter { $0.status == .completed }.count
        self.overdue = activeJobs.filter { $0.urgency != .ok }.count
        self.critical = activeJobs.filter { $0.urgency == .critical }.count
        self.oldestActiveDays = activeJobs.reduce(0) { max($0, $1.ageDays) }
        self.totalValue = activeJobs.reduce(0) { $0 + $1.value }
        self.totalWeightG = activeJobs.reduce(0) { $0 + ($1.weightG ?? 0) }
    }
}

/// Pieces of one order together (`JobOrderGroup`): a karigar receives work by order.
struct WorkshopOrderGroup: Identifiable {
    let key: String
    let jobs: [WorkshopJob]
    let ageDays: Int
    var id: String { key }
}

/// What the whole bench comes to (the board's one-line summary).
struct WorkshopStats {
    let active: Int
    let inProgress: Int
    let overdue: Int
    let critical: Int
    let unassigned: Int
    let workers: Int

    init(_ all: [WorkshopJob]) {
        let act = all.filter { $0.status != .completed }
        active = act.count
        inProgress = act.filter { $0.status == .inProgress }.count
        overdue = act.filter { $0.urgency != .ok }.count
        critical = act.filter { $0.urgency == .critical }.count
        unassigned = act.filter { $0.isUnassigned }.count
        workers = Set(act.filter { !$0.isUnassigned }.map { $0.karigarId }).count
    }
}

// MARK: The board's choices

/// What the board is looking at (the web's `focus`).
enum WorkshopFocus: String, CaseIterable, Identifiable {
    case all, unassigned, attention, notGiven
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "All work"
        case .unassigned: return "Unassigned"
        case .attention: return "Requires attention"
        case .notGiven: return "Not yet given"
        }
    }
}

/// How the pieces are laid out (the web's view and board mode, folded into one choice for a phone). The list
/// is where the web opens (workshop/page.tsx `view`).
enum WorkshopGrouping: String, CaseIterable, Identifiable {
    case list, karigar, stage
    var id: String { rawValue }
    var title: String {
        switch self {
        case .list: return "List"
        case .karigar: return "By karigar"
        case .stage: return "By stage"
        }
    }
}

enum WorkshopStatusFilter: String, CaseIterable, Identifiable {
    case active, all, pending, inProgress, completed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .active: return "Active only"
        case .all: return "All"
        case .pending: return "Pending"
        case .inProgress: return "In Progress"
        case .completed: return "Completed"
        }
    }
    /// The one status this filter asks for, if it names one.
    var exact: WorkshopJob.Status? {
        switch self {
        case .pending: return .pending
        case .inProgress: return .inProgress
        case .completed: return .completed
        case .active, .all: return nil
        }
    }
}

enum WorkshopTypeFilter: String, CaseIterable, Identifiable {
    case all, order, stock
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "All work"
        case .order: return "Customer orders"
        case .stock: return "Stock / inventory"
        }
    }
}

struct WorkshopFilter {
    var query = ""
    var status: WorkshopStatusFilter = .active
    var type: WorkshopTypeFilter = .all
    /// "" is Anyone.
    var takenBy = ""
    /// "" is Everyone.
    var karigarId = ""

    /// While anything narrows the list, an idle karigar means "no match", not "empty bench".
    var narrowed: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || type != .all || status != .active || !takenBy.isEmpty
    }

    /// The filters behind the toolbar's menu (the search has its own box).
    var menuCount: Int {
        (status != .active ? 1 : 0) + (type != .all ? 1 : 0) + (takenBy.isEmpty ? 0 : 1) + (karigarId.isEmpty ? 0 : 1)
    }
}

/// Everything the board shows, worked out once from the books and the filters
/// (src/app/workshop/page.tsx: benchJobs, filtered, attention, unassignedJobs, notGiven).
struct WorkshopSnapshot {
    let all: [WorkshopJob]
    /// Everything but the karigar filter: the at-a-glance numbers keep showing the whole bench.
    let bench: [WorkshopJob]
    let filtered: [WorkshopJob]
    let attention: [WorkshopJob]
    let unassignedJobs: [WorkshopJob]
    let notGiven: [WorkshopJob]
    let stats: WorkshopStats

    init(all: [WorkshopJob], filter f: WorkshopFilter) {
        let bench = WorkshopLogic.bench(all, f)
        let filtered = f.karigarId.isEmpty ? bench : bench.filter { $0.karigarId == f.karigarId }
        self.all = all
        self.bench = bench
        self.filtered = filtered
        self.attention = filtered.filter { $0.status != .completed && ($0.urgency != .ok || $0.isUnassigned) }
        // Deliberately ignores the karigar filter: "work with nobody on it" would always come up empty.
        self.unassignedJobs = bench
            .filter { $0.status != .completed && $0.isUnassigned }
            .sorted { $0.ageDays > $1.ageDays }
        // Assigned to somebody, not done, and not yet handed over: still in the safe.
        self.notGiven = filtered.filter { $0.status != .completed && !$0.isUnassigned && !$0.hasGiven }
        self.stats = WorkshopStats(all)
    }

    func focused(_ focus: WorkshopFocus) -> [WorkshopJob] {
        switch focus {
        case .all: return filtered
        case .unassigned: return unassignedJobs
        case .attention: return attention
        case .notGiven: return notGiven
        }
    }

    func count(_ focus: WorkshopFocus) -> Int {
        switch focus {
        case .all: return filtered.filter { $0.status != .completed }.count
        case .unassigned: return unassignedJobs.count
        case .attention: return attention.count
        case .notGiven: return notGiven.count
        }
    }
}

// MARK: The rules

enum WorkshopLogic {
    static let warnDays = 7
    static let criticalDays = 14
    static let unassigned = "__unassigned__"

    // MARK: Age

    /// Whole days since an instant; 0 for a missing or future one (`daysSince`).
    static func daysSince(_ iso: String?) -> Int {
        guard let d = ERPDate.parse(iso) else { return 0 }
        let days = (Date().timeIntervalSince(d) / 86400).rounded(.down)
        return days > 0 ? Int(days) : 0
    }

    static func urgency(_ status: WorkshopJob.Status, _ ageDays: Int) -> WorkshopJob.Urgency {
        if status == .completed { return .ok }
        if ageDays >= criticalDays { return .critical }
        if ageDays >= warnDays { return .warning }
        return .ok
    }

    // MARK: Words from categories.ts

    private static let categoryTitles: [String: String] = [
        "cat001": "Rings", "cat002": "Tops", "cat003": "Balis", "cat004": "Lockets", "cat005": "Bracelets",
        "cat006": "Bracelet and Ring Set", "cat007": "Bangles", "cat008": "Chains", "cat009": "Bands",
        "cat010": "Locket Sets without Bangle", "cat011": "Locket Set with Bangle", "cat012": "String Sets",
        "cat013": "Stone Necklace Sets without Bracelets", "cat014": "Stone Necklace Sets with Bracelets",
        "cat015": "Gold Necklace Sets with Bracelets", "cat016": "Gold Necklace Sets without Bracelets",
        "cat017": "Gold Coins", "cat018": "Men's Rings", "cat019": "Loose Bracelet", "cat020": "Men's Buttons",
    ]

    /// A category id as its list name; nil when unknown.
    static func categoryTitle(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return categoryTitles[id]
    }

    /// Karat only means something for gold (`displayKarat`): silver and platinum carry a leftover default.
    static func displayKarat(_ metal: MetalType?, _ karat: KaratValue?) -> String? {
        guard let karat, metal == MetalType.gold else { return nil }
        return karat.rawValue
    }

    // MARK: Instructions

    /// One instruction block per item: blank and duplicate lines dropped (`mergeInstructions`).
    static func mergeInstructions(_ raws: [String?]) -> String? {
        var seen = Set<String>()
        var parts: [String] = []
        for raw in raws {
            let v = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if v.isEmpty || seen.contains(v) { continue }
            seen.insert(v)
            parts.append(v)
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    // MARK: Building the list (buildWorkshopJobs)

    private static func realKarigar(_ id: String?) -> String {
        guard let id, !id.isEmpty, id != "none" else { return "" }
        return id
    }

    private static func said(_ name: String?, _ fallback: String) -> String {
        let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? fallback : n
    }

    /// Orders, standalone stock jobs and invoices flattened into one list. Cancelled and refunded orders are
    /// dead work; an order already invoiced is delivered; an online order whose transfer is not in is not work
    /// yet. Pending orders are in: handing out a karigar is what moves them on.
    static func buildJobs(orders: [Order], karigarJobs: [KarigarJob], karigars: [Karigar], invoices: [Invoice]) -> [WorkshopJob] {
        var nameById: [String: String] = [:]
        for k in karigars { nameById[k.id] = k.name }
        var out: [WorkshopJob] = []
        for order in orders { out.append(contentsOf: orderJobs(order, nameById)) }
        for job in karigarJobs { out.append(manualJob(job, nameById)) }
        for inv in invoices { out.append(contentsOf: invoiceJobs(inv, nameById)) }
        return ordered(out)
    }

    private static func orderJobs(_ order: Order, _ nameById: [String: String]) -> [WorkshopJob] {
        if order.status == .cancelled || order.status == .refunded { return [] }
        if !(order.invoiceId ?? "").isEmpty { return [] }
        if awaitingTransfer(order) { return [] }
        var out: [WorkshopJob] = []
        for (idx, item) in order.items.enumerated() {
            let raw = realKarigar(item.karigarId)
            // An order marked Completed means the work is done, even if no piece was ticked one by one.
            let finished = item.isCompleted || order.status == .completed
            let status: WorkshopJob.Status = finished ? .completed : (order.status == .inProgress ? .inProgress : .pending)
            var job = WorkshopJob(
                id: "order:\(order.id):\(idx)",
                source: .order,
                karigarId: raw.isEmpty ? unassigned : raw,
                karigarName: raw.isEmpty ? "Unassigned" : (nameById[raw] ?? "Unknown karigar"),
                description: said(item.description, "Item"),
                status: status,
                assignedDate: order.createdAt
            )
            job.orderId = order.id
            job.takenBy = order.takenBy
            job.itemIndex = idx
            job.customerName = said(order.customerName, "Walk-in")
            job.category = categoryTitle(item.itemCategory)
            job.metalType = item.metalType.rawValue
            job.karat = displayKarat(item.metalType, item.karat)
            job.weightG = item.estimatedWeightG
            job.size = (item.size ?? "").isEmpty ? nil : item.size
            job.referenceSku = (item.referenceSku ?? "").isEmpty ? nil : item.referenceSku
            job.givenAt = (item.givenAt ?? "").isEmpty ? nil : item.givenAt
            job.plating = describePlating(item)
            job.value = item.totalEstimate ?? 0
            job.notes = mergeInstructions([item.stoneDetails, item.diamondDetails, item.adminNote])
            out.append(job)
        }
        return out
    }

    private static func manualJob(_ job: KarigarJob, _ nameById: [String: String]) -> WorkshopJob {
        let raw = job.karigarId
        let status: WorkshopJob.Status
        switch job.status {
        case .completed: status = .completed
        case .inProgress: status = .inProgress
        default: status = .pending
        }
        var out = WorkshopJob(
            id: "job:\(job.id)",
            source: .manual,
            karigarId: raw.isEmpty ? unassigned : raw,
            karigarName: raw.isEmpty ? "Unassigned" : (nameById[raw] ?? said(job.karigarName, "Unknown karigar")),
            description: job.description,
            status: status,
            assignedDate: job.assignedDate
        )
        out.givenAt = (job.givenAt ?? "").isEmpty ? nil : job.givenAt
        out.category = categoryTitle(job.itemCategory) ?? ((job.itemCategory ?? "").isEmpty ? nil : job.itemCategory)
        out.metalType = job.metalType?.rawValue
        out.karat = displayKarat(job.metalType, job.karat)
        out.weightG = job.weightG
        out.quantity = job.quantity ?? 1
        out.size = (job.size ?? "").isEmpty ? nil : job.size
        out.value = job.agreedCost ?? 0
        out.notes = mergeInstructions([job.notes])
        return out
    }

    /// Sold pieces that still need bench work: Shopify sales (which arrive as invoices) while unfulfilled,
    /// and any invoice line someone has deliberately given to a karigar (a resize, a replate, a repair).
    private static func invoiceJobs(_ inv: Invoice, _ nameById: [String: String]) -> [WorkshopJob] {
        if inv.status == .refunded { return [] }
        let fulfilment = (inv.shopifyFulfillment ?? "").lowercased()
        let fromShopify = (inv.source ?? "").hasPrefix("shopify") && (inv.shopifyCancelledAt ?? "").isEmpty
        // The explicit field first; the notes are the legacy path for invoices imported before it existed.
        let unfulfilled = fulfilment.isEmpty ? (inv.notes ?? "").range(of: "unfulfilled", options: .caseInsensitive) != nil : fulfilment != "fulfilled"
        let isOnline = fromShopify && unfulfilled
        var out: [WorkshopJob] = []
        for (idx, item) in inv.items.enumerated() {
            let assigned = realKarigar(item.karigarId)
            // Only online sales come in by themselves; everything else appears once it has been handed to someone.
            if !isOnline && assigned.isEmpty { continue }
            if item.isCompleted { continue }
            var job = WorkshopJob(
                id: "invoice:\(inv.id):\(idx)",
                source: .invoice,
                karigarId: assigned.isEmpty ? unassigned : assigned,
                karigarName: assigned.isEmpty ? "Unassigned" : (nameById[assigned] ?? "Unknown karigar"),
                description: said(item.name, "Item"),
                status: .pending,
                assignedDate: inv.createdAt
            )
            job.givenAt = (item.givenAt ?? "").isEmpty ? nil : item.givenAt
            job.invoiceId = inv.id
            job.takenBy = inv.takenBy
            job.isOnline = isOnline
            job.itemIndex = idx
            job.customerName = said(inv.customerName, "Walk-in")
            job.category = categoryTitle(item.itemCategory)
            job.metalType = item.metalType.rawValue
            job.karat = displayKarat(item.metalType, item.karat)
            job.plating = describePlating(item)
            job.weightG = item.metalWeightG
            job.quantity = item.quantity
            job.size = (item.size ?? "").isEmpty ? nil : item.size
            job.value = item.itemTotal
            job.notes = mergeInstructions([item.stoneDetails, item.diamondDetails, item.adminNote])
            out.append(job)
        }
        return out
    }

    /// Newest-assigned first, but completed work to the bottom. (Ties keep the order they came in.)
    private static func ordered(_ jobs: [WorkshopJob]) -> [WorkshopJob] {
        let indexed = Array(jobs.enumerated())
        let sorted = indexed.sorted { (a, b) -> Bool in
            let aDone = a.element.status == .completed
            let bDone = b.element.status == .completed
            if aDone != bDone { return !aDone }
            if a.element.sortTime != b.element.sortTime { return a.element.sortTime > b.element.sortTime }
            return a.offset < b.offset
        }
        return sorted.map { $0.element }
    }

    // MARK: Filtering

    /// Search, Taken by, status and type, but not the karigar (the board's `benchJobs`).
    static func bench(_ all: [WorkshopJob], _ f: WorkshopFilter) -> [WorkshopJob] {
        let q = f.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return all.filter { (j: WorkshopJob) -> Bool in
            if f.status == .active && j.status == .completed { return false }
            if let want = f.status.exact, j.status != want { return false }
            if !f.takenBy.isEmpty && j.takenBy != f.takenBy { return false }
            if f.type == .order && j.source != .order { return false }
            if f.type == .stock && j.source != .manual { return false }
            if q.isEmpty { return true }
            return matches(j, q)
        }
    }

    private static func matches(_ j: WorkshopJob, _ q: String) -> Bool {
        let fields: [String?] = [j.description, j.karigarName, j.customerName, j.orderId, j.invoiceId, j.category]
        for f in fields {
            if let f, f.lowercased().contains(q) { return true }
        }
        return false
    }

    // MARK: Grouping

    /// Per karigar, the most at-risk first, Unassigned pinned on top (`groupByKarigar`).
    static func groupByKarigar(_ jobs: [WorkshopJob]) -> [WorkshopLoad] {
        var order: [String] = []
        var lists: [String: [WorkshopJob]] = [:]
        for j in jobs {
            if lists[j.karigarId] == nil {
                order.append(j.karigarId)
                lists[j.karigarId] = []
            }
            lists[j.karigarId]?.append(j)
        }
        let loads = order.map { WorkshopLoad(karigarId: $0, jobs: lists[$0] ?? []) }
        let indexed = Array(loads.enumerated())
        let sorted = indexed.sorted { (a, b) -> Bool in
            let x = a.element
            let y = b.element
            if x.isUnassigned != y.isUnassigned { return x.isUnassigned }
            if x.critical != y.critical { return x.critical > y.critical }
            if x.overdue != y.overdue { return x.overdue > y.overdue }
            if x.active != y.active { return x.active > y.active }
            return a.offset < b.offset
        }
        return sorted.map { $0.element }
    }

    /// Pieces under the order they belong to, the oldest group first (`groupJobsByOrder`). Stock work has no
    /// order, so each stock piece stands alone.
    static func groupJobsByOrder(_ jobs: [WorkshopJob]) -> [WorkshopOrderGroup] {
        var keys: [String] = []
        var lists: [String: [WorkshopJob]] = [:]
        var ages: [String: Int] = [:]
        for j in jobs {
            let key: String
            if j.source == .order, let o = j.orderId { key = "order:\(o)" }
            else if j.source == .invoice, let i = j.invoiceId { key = "invoice:\(i)" }
            else { key = "job:\(j.id)" }
            if lists[key] == nil {
                keys.append(key)
                lists[key] = []
            }
            lists[key]?.append(j)
            ages[key] = max(ages[key] ?? 0, j.ageDays)
        }
        let groups = keys.map { WorkshopOrderGroup(key: $0, jobs: lists[$0] ?? [], ageDays: ages[$0] ?? 0) }
        let indexed = Array(groups.enumerated())
        let sorted = indexed.sorted { (a, b) -> Bool in
            if a.element.ageDays != b.element.ageDays { return a.element.ageDays > b.element.ageDays }
            return a.offset < b.offset
        }
        return sorted.map { $0.element }
    }

    /// The pieces ordered so an order's pieces sit together.
    static func byOrder(_ jobs: [WorkshopJob]) -> [WorkshopJob] {
        groupJobsByOrder(jobs).flatMap { $0.jobs }
    }

    // MARK: Pay batches (karigars/page.tsx activeHisaabMap, karigars/[id]/page.tsx openBatch)

    /// Each karigar's open pay batch, by karigar id: a batch with no `closedDate` is still open, and a karigar
    /// normally has one (the newest is taken if he has more).
    static func openBatches(_ batches: [KarigarBatch]) -> [String: KarigarBatch] {
        var out: [String: KarigarBatch] = [:]
        for b in batches where b.isOpen {
            if let have = out[b.karigarId], startTime(have) >= startTime(b) { continue }
            out[b.karigarId] = b
        }
        return out
    }

    private static func startTime(_ b: KarigarBatch) -> Double {
        ERPDate.parse(b.startDate)?.timeIntervalSince1970 ?? 0
    }

    /// What has been paid to him inside one batch: his expenses filed under it.
    static func paidInBatch(_ batch: KarigarBatch, expenses: [Expense]) -> Double {
        expenses.reduce(0) { $0 + ($1.karigarId == batch.karigarId && $1.batchId == batch.id ? $1.amount : 0) }
    }

    // MARK: Words

    /// 3.5, 12, 0.125: no trailing zeros, at most three places.
    static func number(_ x: Double, digits: Int = 3) -> String {
        var s = String(format: "%.\(digits)f", x)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s
    }

    static func grams(_ g: Double) -> String { number(g) + "g" }

    /// The grams to three places, as the karigar's page and the gold khata say them.
    static func grams3(_ g: Double) -> String { String(format: "%.3f", g) + "g" }

    /// "Size 12 · 3.5g · 21K · Ref RG-1": what to know about the piece in one line.
    static func meta(_ j: WorkshopJob) -> String {
        var parts: [String] = []
        if let c = j.category, !c.isEmpty { parts.append(c) }
        if let s = j.size, !s.isEmpty { parts.append("Size \(s)") }
        if let p = j.plating, !p.isEmpty { parts.append(p) }
        if let w = j.weightG, w > 0 { parts.append(grams(w)) }
        if let k = j.karat, !k.isEmpty { parts.append(k.uppercased()) }
        if let r = j.referenceSku, !r.isEmpty { parts.append("Ref \(r)") }
        return parts.joined(separator: " · ")
    }

    /// "5 pieces" / "1 piece".
    static func pieces(_ n: Int) -> String { "\(n) piece\(n == 1 ? "" : "s")" }

    /// The plain-text work list for a karigar, WhatsApp friendly (`formatJobListForShare`).
    static func shareText(_ load: WorkshopLoad, shopName: String) -> String {
        let active = load.jobs.filter { $0.status != .completed }
        var lines: [String] = [
            "*\(shopName) — Work List*",
            "*\(load.karigarName)*",
            "\(active.count) pending item\(active.count == 1 ? "" : "s")",
            "",
        ]
        if active.isEmpty {
            lines.append("No pending work. \u{2705}")
            return lines.joined(separator: "\n")
        }
        let oldestFirst = active.enumerated().sorted { (a, b) -> Bool in
            if a.element.ageDays != b.element.ageDays { return a.element.ageDays > b.element.ageDays }
            return a.offset < b.offset
        }.map { $0.element }
        for (i, j) in oldestFirst.enumerated() {
            let flag = j.urgency == .critical ? " \u{1F534}" : (j.urgency == .warning ? " \u{26A0}\u{FE0F}" : "")
            lines.append("\(i + 1). \(j.description)\(flag)")
            var facts: [String] = []
            if let c = j.category, !c.isEmpty { facts.append(c) }
            if let w = j.weightG, w > 0 { facts.append("\(number(w))g") }
            if let k = j.karat, !k.isEmpty { facts.append(k.uppercased()) }
            if !facts.isEmpty { lines.append("   " + facts.joined(separator: " · ")) }
            if let o = j.orderId {
                let who = (j.customerName ?? "").isEmpty ? "" : " (\(j.customerName ?? ""))"
                lines.append("   Order \(o)\(who)")
            }
            lines.append("   \(j.ageDays) day\(j.ageDays == 1 ? "" : "s") since given")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: Paths

    /// An id as one path piece ("KAR-1", or a name with odd characters in it).
    static func piece(_ id: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~"))
        return id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
    }

    static func karigarPath(_ id: String) -> String { "/karigars/" + piece(id) }

    /// "/karigars/KAR-1" is the karigar "KAR-1". Nil for the list, for "add" (the ERP's own form), for a deeper
    /// page (".../edit" has no native screen) and for a path that asks for the ERP's page with "?web=1".
    static func karigarId(fromPath path: String) -> String? {
        if ScreenRegistry.wantsWeb(path) { return nil }
        let prefix = "/karigars/"
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix(prefix) else { return nil }
        let rest = String(bare.dropFirst(prefix.count))
        guard !rest.isEmpty, !rest.contains("/"), rest != "add" else { return nil }
        return rest.removingPercentEncoding ?? rest
    }

    /// True when `path` is exactly this page, with or without a query, and does not ask for the ERP's own.
    static func isPage(_ path: String, _ page: String) -> Bool {
        ScreenRoute.bare(path) == page && !ScreenRegistry.wantsWeb(path)
    }

    /// One value from a path's query ("/workshop?karigar=KAR-1").
    static func queryValue(_ name: String, in path: String) -> String? {
        URLComponents(string: path)?.queryItems?.first(where: { $0.name == name })?.value
    }

    /// A number to dial: digits and a leading plus, nothing else.
    static func dialable(_ phone: String) -> String { phone.filter { $0.isASCII && ($0.isNumber || $0 == "+") } }
}

// MARK: One karigar's position with the shop (karigar-position.ts)

/// His bench, the metal on it, the gold khata, the given items still out with him and his hisaab cash.
/// Read only. Two measures of metal, never added: what the pieces will weigh (the estimates typed on the
/// jobs) and what was actually handed over and returned (the khata).
struct WorkshopPosition {
    struct Metal: Identifiable {
        let label: String
        let grams: Double
        var id: String { label }
    }

    let bench: [WorkshopJob]
    let metals: [Metal]
    let unweighed: Int
    let khataGiven: Double
    let khataBack: Double
    /// Positive: he holds the shop's money (an advance). Negative: the shop owes him.
    let cashBalance: Double
    let given: [GivenItem]

    var khataNet: Double { khataGiven - khataBack }

    init(karigarId: String, karigarName: String, jobs: [WorkshopJob], givenItems: [GivenItem], hisaab: [HisaabEntry]) {
        let mine = jobs
            .filter { $0.karigarId == karigarId && $0.status != .completed }
            .enumerated()
            .sorted { (a, b) -> Bool in
                if a.element.ageDays != b.element.ageDays { return a.element.ageDays > b.element.ageDays }
                return a.offset < b.offset
            }
            .map { $0.element }
        var labels: [String] = []
        var weights: [String: Double] = [:]
        var none = 0
        for j in mine {
            let w = j.weightG ?? 0
            if w <= 0 {
                none += 1
                continue
            }
            let metal = (j.metalType ?? "").isEmpty ? "metal" : (j.metalType ?? "metal")
            let key = [metal, j.karat ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
            if weights[key] == nil { labels.append(key) }
            weights[key] = (weights[key] ?? 0) + w
        }
        let rows = hisaab.filter { $0.entityType == .karigar && $0.entityId == karigarId }
        self.bench = mine
        self.metals = labels.map { Metal(label: $0, grams: weights[$0] ?? 0) }
        self.unweighed = none
        self.khataGiven = rows.reduce(0) { $0 + $1.goldDebitGrams }
        self.khataBack = rows.reduce(0) { $0 + $1.goldCreditGrams }
        self.cashBalance = rows.reduce(0) { $0 + $1.cashDebit - $1.cashCredit }
        let wanted = WorkshopPosition.norm(karigarName)
        self.given = givenItems.filter { (g: GivenItem) -> Bool in
            if g.status != .out { return false }
            if let rid = g.recipientId, !rid.isEmpty { return rid == karigarId }
            return g.recipientType == .karigar && WorkshopPosition.norm(g.recipientName) == wanted
        }
    }

    /// Names compared the way lib/given.ts does: trimmed, spaces collapsed, case ignored.
    static func norm(_ s: String) -> String {
        s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    }
}
