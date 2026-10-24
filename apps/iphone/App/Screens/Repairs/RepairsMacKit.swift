#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Repairs desk (docs/features/mac-app.md): every ticket as a sortable table, filtered by where it stands, with
// the right-click actions the iPhone has as swipes. The ticket itself opens beside it (RepairsScreen's inspector).

/// Which tickets the table shows.
enum RepairsMacFilter: String, CaseIterable, Identifiable {
    case active, inShop, ready, collected, cancelled, all
    var id: String { rawValue }

    var title: String {
        switch self {
        case .active: return "Active"
        case .inShop: return "In the shop"
        case .ready: return "Ready"
        case .collected: return "Collected"
        case .cancelled: return "Cancelled"
        case .all: return "All"
        }
    }

    func keeps(_ s: RepairStatus) -> Bool {
        switch self {
        case .all: return true
        case .active: return s == .received || s == .ready
        case .inShop: return s == .received
        case .ready: return s == .ready
        case .collected: return s == .collected
        case .cancelled: return s == .cancelled
        }
    }
}

/// One ticket as a table row, with the status the desk shows (a step just taken is shown at once).
struct RepairsMacRow: Identifiable {
    let repair: Repair
    let status: RepairStatus
    var id: String { repair.id }
    var number: String { repair.id }
    var customer: String { RepairsKit.customer(repair) }
    var summary: String { RepairsKit.repairSummary(repair) }
    var statusLabel: String { RepairsKit.label(status) }
    var received: String { repair.receivedAt }
    /// Sorts undated last.
    var promised: String { RepairsKit.filled(repair.promisedDate) ?? "9999" }
    var owed: Double { status == .cancelled ? 0 : RepairsKit.repairBalance(repair) }
    var karigar: String { RepairsKit.filled(repair.karigarName) ?? "" }
}

/// "/repairs?id=REP-000012": a ticket's own address.
func repairsTicketPath(_ id: String) -> String {
    "/repairs?id=" + (id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+#"))) ?? id)
}

struct RepairsMacDesk: View {
    let desk: RepairsDesk
    let query: String
    @Binding var selection: Set<String>
    @Binding var creating: Bool

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var filter: RepairsMacFilter = .active
    @State private var sort = [KeyPathComparator(\RepairsMacRow.promised)]

    private var rows: [RepairsMacRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return book.repairs.items
            .filter { q.isEmpty || RepairsKit.matches($0, q) }
            .map { RepairsMacRow(repair: $0, status: desk.status($0)) }
            .filter { filter.keeps($0.status) }
            .sorted(using: sort)
    }

    var body: some View {
        let shown = rows
        Table(shown, selection: $selection, sortOrder: $sort) {
            TableColumn("Repair", value: \.number) { (r: RepairsMacRow) in
                Text(r.number).monospacedDigit()
            }
            .width(min: 90, ideal: 110)
            TableColumn("Piece", value: \.summary) { (r: RepairsMacRow) in
                Text(r.summary).foregroundStyle(r.status == .collected || r.status == .cancelled ? Color.secondary : Color.primary)
            }
            TableColumn("Customer", value: \.customer)
            TableColumn("Status", value: \.statusLabel) { (r: RepairsMacRow) in
                Pill(r.statusLabel, tone: RepairsKit.tone(r.status))
            }
            .width(min: 90, ideal: 110)
            TableColumn("In", value: \.received) { (r: RepairsMacRow) in
                Text(ShopDate.say(r.received))
            }
            .width(min: 80, ideal: 100)
            TableColumn("Ready by", value: \.promised) { (r: RepairsMacRow) in
                RepairsPromiseText(repair: r.repair, now: Date(), font: .body)
            }
            .width(min: 110, ideal: 150)
            TableColumn("Due", value: \.owed) { (r: RepairsMacRow) in
                if r.owed >= 1 { Text(Money.pkr(r.owed)).monospacedDigit() }
            }
            .width(min: 90, ideal: 110)
            TableColumn("Karigar", value: \.karigar)
                .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            menu(ids)
        } primaryAction: { ids in
            for id in ids.prefix(5) { openPlace?(Route(path: repairsTicketPath(id))) }
        }
        .overlay { if shown.isEmpty { empty } }
        .safeAreaInset(edge: .bottom, spacing: 0) { statusBar(shown) }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $filter) {
                    ForEach(RepairsMacFilter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.menu)
                .help("Which tickets to list")
            }
        }
    }

    @ViewBuilder
    private var empty: some View {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            ContentUnavailableView.search(text: typed)
        } else if book.repairs.items.isEmpty {
            if session.isOwner {
                EmptyState("No repairs yet", symbol: "wrench.and.screwdriver",
                           message: "When a customer leaves pieces to be mended, they are written up here.",
                           action: (title: "New repair", run: { creating = true }))
            } else {
                EmptyState("No repairs yet", symbol: "wrench.and.screwdriver", message: "Repairs the shop takes in will show here.")
            }
        } else {
            EmptyState("Nothing here", symbol: "wrench.and.screwdriver", message: "No ticket is \(filter.title.lowercased()).",
                       action: (title: "Show all", run: { filter = .all }))
        }
    }

    private func statusBar(_ shown: [RepairsMacRow]) -> some View {
        let owing = shown.reduce(0.0) { (sum: Double, r: RepairsMacRow) -> Double in sum + r.owed }
        return VStack(spacing: 0) {
            Divider()
            HStack {
                Text("\(shown.count) repair\(shown.count == 1 ? "" : "s")")
                Spacer()
                if owing >= 1 { Text("\(Money.pkr(owing)) due").monospacedDigit() }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }

    // MARK: Right-click (the iPhone's swipes and long press)

    @ViewBuilder
    private func menu(_ ids: Set<String>) -> some View {
        if let id = ids.first, let r = book.repairs.item(id) {
            let status = desk.status(r)
            Button { openPlace?(Route(path: repairsTicketPath(id))) } label: { Label("Open in New Window", systemImage: "macwindow.badge.plus") }
            Button { MacPrint.print(Route(path: repairsTicketPath(id))) } label: { Label("Print Receipt", systemImage: "printer") }
            if session.isOwner && status == .received {
                Button { desk.markReady(r) } label: { Label("Mark Ready", systemImage: "checkmark.circle") }
            }
            if session.isOwner && status == .ready {
                Button { desk.collect(r) } label: { Label("Collected", systemImage: "shippingbox") }
            }
            if status == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
                Button { openURL(url) } label: { Label("Tell Them It's Ready", systemImage: "message") }
            }
            if session.isOwner && status != .cancelled && RepairsKit.repairBalance(r) > 0 {
                Button { desk.taking = r } label: { Label("Take Payment", systemImage: "banknote") }
            }
            if session.isOwner && (status == .received || status == .ready) {
                Divider()
                Button(role: .destructive) { desk.askCancel(r) } label: { Label("Cancel Repair", systemImage: "xmark.circle") }
            }
        }
    }
}
#endif
