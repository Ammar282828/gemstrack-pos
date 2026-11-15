#if os(macOS)
import SwiftUI
import ERPCore

// The Orders list (docs/features/mac-design.md, "Orders"): the iPhone's hub at a pointer's scale. Grouped by stage as the
// hub groups (STAGE_ORDER, newest first inside each, Done and Cancelled folded), every row the hub card's head: a monogram,
// the customer over "ORD-12 · Ring +2 more", the four-bar StageTrack and the promise, what is owed at the right. Another
// sort (Filter menu) lays the same rows flat. Multi-select; Return or a double-click opens the order in its own window;
// the right-click menu is the Order menu's.

/// How the list is ordered: Stage is the iPhone's (grouped), the rest are flat.
enum MacOrdersSort: String, CaseIterable, Identifiable {
    case stage, newest, promised, customer, owed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .stage: return "Stage"
        case .newest: return "Newest"
        case .promised: return "Promised"
        case .customer: return "Customer"
        case .owed: return "Owed"
        }
    }
}

/// One group of the list: a stage and its rows.
struct MacOrdersGroup: Identifiable {
    let id: String
    let title: String
    let hint: String
    let folds: Bool
    let rows: [MacOrdersListRow]
    let worth: Double
}

struct MacOrdersListView<RowMenu: View>: View {
    let rows: [MacOrdersListRow]
    /// Staff see each order's amount, never a stage's sum (docs/decisions.md#staff-see-no-money).
    @Environment(Session.self) private var session
    /// What the rows were made from: a new value makes the groups again.
    let version: [Int]
    let sort: MacOrdersSort
    /// A search is on: the folded groups open so its hits are not hidden.
    let searching: Bool
    /// The saved list's title (Late, Not Started), nil on the whole place: a group of that very name is not said twice.
    var listTitle: String?
    /// Tiles in a column, or cards in a grid (the toolbar's List and Cards).
    var layout: MacRecordLayout = .list
    @Binding var selection: Set<String>
    let open: (Set<String>) -> Void
    @ViewBuilder let menu: (Set<String>) -> RowMenu

    @State private var made = Memo<[MacOrdersGroup]>()

    var body: some View {
        let groups = made(version + [sort.hashValue]) { Self.groups(rows, sort: sort) }
        let grouped = sort == .stage
        let owner = session.isOwner
        let sections = groups.map { (g: MacOrdersGroup) -> MacRecordSection<MacOrdersListRow> in
            // The window's title already names this group ("Not Started"): no heading is said again, and it never folds.
            let named = namedByTitle(g)
            return MacRecordSection(id: g.id, title: named ? "" : g.title, count: g.rows.count,
                                    trailing: owner && g.worth >= 1 ? "worth " + Money.pkrLac(g.worth, digits: 1) : nil,
                                    hint: named ? "" : g.hint, folds: g.folds && !named, items: g.rows)
        }
        MacRecordCollection(layout: layout, sections: sections, searching: searching, selection: $selection, open: open,
                            lines: { (ids: Set<String>) -> [String] in rows.filter { ids.contains($0.id) }.map(Self.line) },
                            dragText: { (r: MacOrdersListRow) -> String in Self.line(r) }) { (r: MacOrdersListRow) in
            if layout == .cards {
                MacOrderCard(row: r)
            } else {
                MacOrdersRow(row: r, showsStage: !grouped)
            }
        } menu: { (ids: Set<String>) in
            menu(ids)
        }
    }

    /// One order as a line of text, for ⌘C and a drag out of the list.
    static func line(_ r: MacOrdersListRow) -> String {
        [r.id, r.customer, r.what, r.stageWords].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    // MARK: Groups

    /// The hub's grouping: the stages in STAGE_ORDER, newest first inside each. Any other sort is one flat group.
    static func groups(_ rows: [MacOrdersListRow], sort: MacOrdersSort) -> [MacOrdersGroup] {
        if sort == .stage {
            var byStage: [OrderStage: [MacOrdersListRow]] = [:]
            for r in rows.sorted(by: { $0.createdAt > $1.createdAt }) { byStage[r.stage, default: []].append(r) }
            return STAGE_ORDER.compactMap { (st: OrderStage) -> MacOrdersGroup? in
                guard let inStage = byStage[st], !inStage.isEmpty else { return nil }
                let info = STAGES[st]
                return MacOrdersGroup(id: st.rawValue, title: info?.title ?? st.rawValue, hint: info?.hint ?? "",
                                      folds: st == .done || st == .closed, rows: inStage,
                                      worth: st == .closed ? 0 : inStage.reduce(0) { $0 + $1.worth })
            }
        }
        let ordered: [MacOrdersListRow]
        switch sort {
        case .newest: ordered = rows.sorted { $0.createdAt > $1.createdAt }
        case .promised: ordered = rows.sorted { $0.promisedKey == $1.promisedKey ? $0.createdAt > $1.createdAt : $0.promisedKey < $1.promisedKey }
        case .customer: ordered = rows.sorted { $0.customer.localizedCaseInsensitiveCompare($1.customer) == .orderedAscending }
        case .owed: ordered = rows.sorted { $0.owed > $1.owed }
        case .stage: ordered = rows
        }
        if ordered.isEmpty { return [] }
        return [MacOrdersGroup(id: "all", title: "", hint: "", folds: false, rows: ordered, worth: 0)]
    }

    /// The window's title already names this group ("Not Started" over a group "Not started"): no heading is said again.
    private func namedByTitle(_ g: MacOrdersGroup) -> Bool {
        guard let listTitle else { return false }
        return g.title.caseInsensitiveCompare(listTitle) == .orderedSame
    }

}

/// An order's row: the hub card's head at a pointer's scale.
struct MacOrdersRow: View {
    let row: MacOrdersListRow
    /// The list is flat: the row says its stage (a grouped list has it in the heading).
    let showsStage: Bool

    var body: some View {
        let r = row
        HStack(spacing: 12) {
            Monogram(name: r.customer, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.customer)
                    .font(.house(.body))
                    .foregroundStyle(r.stage == .done ? Color.secondary : Color.primary)
                    .lineLimit(1)
                Text(secondLine)
                    .font(.house(.callout))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            state
            money
        }
        .padding(.vertical, 3)
        .help(r.promisedHelp)
    }

    private var secondLine: String {
        row.what.isEmpty ? row.id : row.id + " \u{00B7} " + row.what
    }

    /// Where it stands: the four bars and the promise (late red, today amber, else a quiet date), or the stage's word.
    @ViewBuilder
    private var state: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if row.stage != .closed {
                StageTrack(stage: row.stage).frame(width: 64)
            }
            if showsStage || row.stage == .closed {
                Pill(row.stageWords, tone: row.stageTone)
            } else if row.stage != .done, !row.promisedDay.isEmpty {
                let urgent = !row.promisedWords.isEmpty
                Text(urgent ? row.promisedWords : "Due " + row.promisedDay)
                    .font(.house(.caption).weight(urgent ? .semibold : .regular))
                    .foregroundStyle(urgent ? row.promisedTone.color : Color.secondary)
                    .lineLimit(1)
            }
        }
        .frame(minWidth: 96, alignment: .trailing)
    }

    /// What is still owed (amber), what is in credit (teal), or Paid in a pill once nothing is.
    @ViewBuilder
    private var money: some View {
        Group {
            if row.stage == .closed {
                Color.clear.frame(width: 1, height: 1)
            } else if abs(row.owed) >= 1 {
                VStack(alignment: .trailing, spacing: 1) {
                    RowAmount(amount: abs(row.owed), tone: row.owed < 0 ? Tone.credit.color : Tone.owed.color)
                    Text(row.owed < 0 ? "In credit" : "Owed").font(.house(.caption2)).foregroundStyle(.secondary)
                }
            } else {
                Pill("Paid", tone: .settled)
            }
        }
        .frame(minWidth: 96, alignment: .trailing)
    }
}

/// An order as a card (the place's Cards): the piece's photo, who and which order with where it stands, the piece, the
/// four steps, then the promise and what is owed. The iPad's `RecordCard` anatomy at a pointer's scale, on the
/// collection's opaque card; the photo is what the List does not have, so a ring is found by sight.
struct MacOrderCard: View {
    let row: MacOrdersListRow

    var body: some View {
        let r = row
        VStack(alignment: .leading, spacing: 10) {
            MacCardPhoto(source: r.photo)
            HStack(alignment: .top, spacing: 10) {
                Monogram(name: r.customer, size: Monogram.Size.row)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.customer)
                        .font(.house(.headline))
                        .foregroundStyle(r.stage == .done ? Color.secondary : Color.primary)
                        .lineLimit(1)
                    Text(r.id).font(.house(.caption)).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
                }
                Spacer(minLength: 6)
                Pill(r.stageWords, tone: r.stageTone)
            }
            if !r.what.isEmpty {
                Text(r.what).font(.house(.callout)).foregroundStyle(.secondary).lineLimit(2)
            }
            if r.stage != .closed {
                StageTrack(stage: r.stage).frame(maxWidth: .infinity)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                promise
                Spacer(minLength: 6)
                money
            }
        }
        .help(r.promisedHelp)
    }

    /// Late in red, today in amber, else a quiet date; nothing once it is done or closed.
    @ViewBuilder
    private var promise: some View {
        if row.stage != .done, row.stage != .closed, !row.promisedDay.isEmpty {
            let urgent = !row.promisedWords.isEmpty
            Text(urgent ? row.promisedWords : "Due " + row.promisedDay)
                .font(.house(.caption).weight(urgent ? .semibold : .regular))
                .foregroundStyle(urgent ? row.promisedTone.color : Color.secondary)
                .lineLimit(1)
        }
    }

    /// What is still owed (amber), in credit (teal), or Paid once nothing is.
    @ViewBuilder
    private var money: some View {
        if row.stage == .closed {
            EmptyView()
        } else if abs(row.owed) >= 1 {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(row.owed < 0 ? "In credit" : "Owed").font(.house(.caption)).foregroundStyle(.secondary)
                RowAmount(amount: abs(row.owed), tone: row.owed < 0 ? Tone.credit.color : Tone.owed.color)
            }
        } else {
            Pill("Paid", tone: .settled)
        }
    }
}
#endif
