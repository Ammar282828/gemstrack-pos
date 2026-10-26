#if os(macOS)
import SwiftUI
import ERPCore

// The Repairs list (docs/features/mac-design.md, "Repairs"): the iPhone's repairs list at a pointer's scale. Grouped by
// status as the phone groups (In the shop, Ready, Collected, Cancelled; the last two folded), every row a monogram, the piece
// over "customer · REP-12 · with Ustad", when it is promised and what it still owes at the right. Another sort (the Filter
// menu) lays the same rows flat with their status said in a pill. Multi-select; Return or a double-click opens the ticket in
// a window of its own; the right-click menu is the Repair menu's.

/// How the list is ordered: Status is the phone's (grouped), the rest are flat.
enum MacRepairsSort: String, CaseIterable, Identifiable {
    case status, readyBy, newest, customer, owed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .status: return "Status"
        case .readyBy: return "Ready By"
        case .newest: return "Newest"
        case .customer: return "Customer"
        case .owed: return "Owed"
        }
    }

    /// The rows in this order (Status: in the shop soonest-promised first, the rest newest first).
    func ordered(_ rows: [MacRepairsRow]) -> [MacRepairsRow] {
        switch self {
        case .status, .readyBy:
            return rows.sorted { $0.promised == $1.promised ? $0.received > $1.received : $0.promised < $1.promised }
        case .newest: return rows.sorted { $0.received > $1.received }
        case .customer: return rows.sorted { $0.customer.localizedCaseInsensitiveCompare($1.customer) == .orderedAscending }
        case .owed: return rows.sorted { $0.owed > $1.owed }
        }
    }
}

/// One group of the list: a status and its tickets.
struct MacRepairsGroup: Identifiable {
    let id: String
    let title: String
    let folds: Bool
    let rows: [MacRepairsRow]
    let owed: Double
}

struct MacRepairsListView<RowMenu: View>: View {
    let rows: [MacRepairsRow]
    /// What the rows were made from: a new value makes the groups again.
    let version: [Int]
    let sort: MacRepairsSort
    /// A search is on: the folded groups open so its hits are not hidden.
    let searching: Bool
    /// The saved list's title (In the Shop, Collected), nil on the whole place: a group of that very name is not said twice.
    var listTitle: String?
    @Binding var selection: Set<String>
    let open: (Set<String>) -> Void
    @ViewBuilder let menu: (Set<String>) -> RowMenu

    @State private var made = Memo<[MacRepairsGroup]>()
    @State private var unfolded = Set<String>()

    var body: some View {
        let groups = made(version + [sort.hashValue]) { Self.groups(rows, sort: sort) }
        List(selection: $selection) {
            ForEach(groups) { (g: MacRepairsGroup) in
                section(g)
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            menu(ids)
        } primaryAction: { (ids: Set<String>) in
            open(ids)
        }
    }

    // MARK: Groups

    /// The phone's grouping (RepairsKit.groups): In the shop and Ready are work, Collected and Cancelled are history.
    static func groups(_ rows: [MacRepairsRow], sort: MacRepairsSort) -> [MacRepairsGroup] {
        let ordered = sort.ordered(rows)
        if sort != .status {
            if ordered.isEmpty { return [] }
            return [MacRepairsGroup(id: "all", title: "", folds: false, rows: ordered, owed: 0)]
        }
        let parts: [(String, String, Bool, (RepairStatus) -> Bool)] = [
            ("received", "In the shop", false, { $0 == .received }),
            ("ready", "Ready", false, { $0 == .ready }),
            ("collected", "Collected", true, { $0 == .collected }),
            ("cancelled", "Cancelled", true, { $0 == .cancelled }),
            ("other", "Other", true, { $0 != .received && $0 != .ready && $0 != .collected && $0 != .cancelled }),
        ]
        var out: [MacRepairsGroup] = []
        for (id, title, folds, match) in parts {
            var inGroup = ordered.filter { match($0.status) }
            // History reads newest first, as the phone's does.
            if folds || id == "ready" { inGroup.sort { $0.received > $1.received } }
            if inGroup.isEmpty { continue }
            let owed = folds ? 0 : inGroup.reduce(0.0) { (sum: Double, r: MacRepairsRow) -> Double in sum + r.owed }
            out.append(MacRepairsGroup(id: id, title: title, folds: folds, rows: inGroup, owed: owed))
        }
        return out
    }

    /// The window's title already names this group ("Collected" over a group "Collected"): no heading is said again, and a
    /// folded one is open (the list is nothing else).
    private func namedByTitle(_ g: MacRepairsGroup) -> Bool {
        guard let listTitle else { return false }
        return g.title.caseInsensitiveCompare(listTitle) == .orderedSame
    }

    private func isOpen(_ g: MacRepairsGroup) -> Bool {
        !g.folds || searching || namedByTitle(g) || unfolded.contains(g.id)
    }

    @ViewBuilder
    private func section(_ g: MacRepairsGroup) -> some View {
        if g.title.isEmpty {
            Section {
                ForEach(g.rows) { (r: MacRepairsRow) in MacRepairsRowView(row: r, showsStatus: true) }
            }
            .houseRows()
        } else if namedByTitle(g) {
            Section {
                ForEach(g.rows) { (r: MacRepairsRow) in MacRepairsRowView(row: r, showsStatus: false) }
            }
            .houseRows()
        } else {
            Section {
                if isOpen(g) {
                    ForEach(g.rows) { (r: MacRepairsRow) in MacRepairsRowView(row: r, showsStatus: false) }
                }
            } header: {
                header(g)
            }
            .houseRows()
        }
    }

    private func header(_ g: MacRepairsGroup) -> some View {
        Button {
            guard g.folds, !searching else { return }
            if unfolded.contains(g.id) { unfolded.remove(g.id) } else { unfolded.insert(g.id) }
        } label: {
            HStack(alignment: .top, spacing: 6) {
                if g.folds && !searching {
                    Image(systemName: isOpen(g) ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 12).padding(.top, 3)
                }
                LedgerHeading(title: g.title, count: g.rows.count, trailing: g.owed >= 1 ? Money.pkrLac(g.owed, digits: 1) + " owed" : nil)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 6)
    }
}

/// A ticket's row: the phone's, at a pointer's scale.
struct MacRepairsRowView: View {
    let row: MacRepairsRow
    /// The list is flat: the row says its status (a grouped list has it in the heading).
    let showsStatus: Bool

    private var greyed: Bool { row.status == .collected || row.status == .cancelled }

    var body: some View {
        HStack(spacing: 12) {
            Monogram(name: row.customer, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.summary)
                    .font(.body)
                    .foregroundStyle(greyed ? Color.secondary : Color.primary)
                    .lineLimit(1)
                Text(secondLine)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            when
            money
        }
        .padding(.vertical, 3)
    }

    /// "Sana Demo · REP-000012 · with Ustad".
    private var secondLine: String {
        var parts = [row.customer, row.number]
        if !row.karigar.isEmpty { parts.append("with " + row.karigar) }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// The status in a pill when the list is flat; else the promise (late red, today amber), for a ticket still in the shop.
    @ViewBuilder
    private var when: some View {
        VStack(alignment: .trailing, spacing: 3) {
            if showsStatus {
                Pill(row.statusLabel, tone: row.statusTone)
            }
            if row.status == .received && !row.readyBy.isEmpty {
                Text("Ready by " + row.readyBy)
                    .font(.caption.weight(row.readyByTone == .quiet ? .regular : .semibold))
                    .foregroundStyle(row.readyByTone == .quiet ? Color.secondary : row.readyByTone.color)
                    .lineLimit(1)
            }
        }
        .frame(minWidth: 110, alignment: .trailing)
    }

    @ViewBuilder
    private var money: some View {
        Group {
            if row.owed >= 1 {
                VStack(alignment: .trailing, spacing: 1) {
                    RowAmount(amount: row.owed, tone: Tone.owed.color)
                    Text("Owed").font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Color.clear.frame(width: 1, height: 1)
            }
        }
        .frame(minWidth: 96, alignment: .trailing)
    }
}
#endif
