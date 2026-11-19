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
    /// Tiles in a column, or cards in a grid (the toolbar's List and Cards).
    var layout: MacRecordLayout = .list
    @Binding var selection: Set<String>
    let open: (Set<String>) -> Void
    @ViewBuilder let menu: (Set<String>) -> RowMenu

    /// Kept outside the view (MacMemos), by the saved list it shows, so coming back to it finds the groups made.
    private var made: Memo<[MacRepairsGroup]> { MacMemos.memo("repairs.list", listTitle ?? "") }

    var body: some View {
        let groups = made(version + [sort.hashValue]) { Self.groups(rows, sort: sort) }
        let grouped = sort == .status
        let sections = groups.map { (g: MacRepairsGroup) -> MacRecordSection<MacRepairsRow> in
            let named = namedByTitle(g)
            return MacRecordSection(id: g.id, title: named ? "" : g.title, count: g.rows.count,
                                    trailing: g.owed >= 1 ? Money.pkrLac(g.owed, digits: 1) + " owed" : nil,
                                    folds: g.folds && !named, items: g.rows)
        }
        MacRecordCollection(layout: layout, sections: sections, searching: searching, selection: $selection,
                            staggerKey: "repairs|" + (listTitle ?? ""), open: open,
                            lines: { (ids: Set<String>) -> [String] in rows.filter { ids.contains($0.id) }.map(Self.line) },
                            dragText: { (r: MacRepairsRow) -> String in Self.line(r) }) { (r: MacRepairsRow) in
            if layout == .cards {
                MacRepairCard(row: r)
            } else {
                MacRepairsRowView(row: r, showsStatus: !grouped)
            }
        } menu: { (ids: Set<String>) in
            menu(ids)
        }
    }

    /// One ticket as a line of text, for ⌘C and a drag out of the list.
    static func line(_ r: MacRepairsRow) -> String {
        [r.number, r.customer, r.summary, r.statusLabel].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
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
                    .font(.house(.body))
                    .foregroundStyle(greyed ? Color.secondary : Color.primary)
                    .lineLimit(1)
                Text(secondLine)
                    .font(.house(.callout))
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
                    .font(.house(.caption).weight(row.readyByTone == .quiet ? .regular : .semibold))
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
                    Text("Owed").font(.house(.caption2)).foregroundStyle(.secondary)
                }
            } else {
                Color.clear.frame(width: 1, height: 1)
            }
        }
        .frame(minWidth: 96, alignment: .trailing)
    }
}

/// A repair ticket as a card (the place's Cards): who and which ticket with its status, what is being done, then when it is
/// promised and what is owed.
struct MacRepairCard: View {
    let row: MacRepairsRow

    var body: some View {
        let r = row
        let greyed = r.status == .collected || r.status == .cancelled
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Monogram(name: r.customer, size: Monogram.Size.row)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.customer).font(.house(.headline)).foregroundStyle(greyed ? Color.secondary : Color.primary).lineLimit(1)
                    Text(r.number).font(.house(.caption)).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
                }
                Spacer(minLength: 6)
                Pill(r.statusLabel, tone: r.statusTone)
            }
            if !r.summary.isEmpty {
                Text(r.summary).font(.house(.callout)).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if r.status == .received && !r.readyBy.isEmpty {
                    Text("Ready by " + r.readyBy)
                        .font(.house(.caption).weight(r.readyByTone == .quiet ? .regular : .semibold))
                        .foregroundStyle(r.readyByTone == .quiet ? Color.secondary : r.readyByTone.color)
                        .lineLimit(1)
                } else if !r.received.isEmpty {
                    Text("Taken in " + ShopDate.say(r.received, withTime: false))
                        .font(.house(.caption)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                if r.owed >= 1 {
                    Text("Owed").font(.house(.caption)).foregroundStyle(.secondary)
                    RowAmount(amount: r.owed, tone: Tone.owed.color)
                }
            }
        }
    }
}
#endif
