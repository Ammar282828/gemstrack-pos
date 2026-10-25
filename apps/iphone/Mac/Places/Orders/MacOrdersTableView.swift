#if os(macOS)
import SwiftUI
import ERPCore

// The Orders table (docs/features/mac-design.md, "Orders"): Number, Customer, Stage, Promised, Pieces, Karigars, Total,
// Advance, Owed. Sortable on every column, multi-select; Return or a double-click opens the order in its own window; the
// right-click menu is the Order menu's. The rows are made once per change of the books in the place and handed in; the
// sorted copy is kept here until the rows or the sort change.

struct MacOrdersTableView<RowMenu: View>: View {
    let rows: [MacOrdersListRow]
    /// What the rows were made from: a new value makes the sorted copy again.
    let version: [Int]
    @Binding var selection: Set<String>
    let open: (Set<String>) -> Void
    @ViewBuilder let menu: (Set<String>) -> RowMenu

    @State private var sort = [KeyPathComparator(\MacOrdersListRow.createdAt, order: .reverse)]
    @State private var ordered = Memo<[MacOrdersListRow]>()

    var body: some View {
        let sorted = ordered(version + [sort.hashValue]) { rows.sorted(using: sort) }
        Table(sorted, selection: $selection, sortOrder: $sort) {
            TableColumn("Number", value: \.id) { (r: MacOrdersListRow) in
                Text(r.id).monospacedDigit()
            }
            .width(min: 78, ideal: 92)
            TableColumn("Customer", value: \.customer) { (r: MacOrdersListRow) in
                Text(r.customer).lineLimit(1)
            }
            .width(min: 100, ideal: 150)
            TableColumn("Stage", value: \.stageRank) { (r: MacOrdersListRow) in
                MacStatus(r.stageWords, tone: r.stageTone)
            }
            .width(min: 120, ideal: 150)
            TableColumn("Promised", value: \.promisedKey) { (r: MacOrdersListRow) in
                promised(r)
            }
            .width(min: 84, ideal: 98)
            TableColumn("Pieces", value: \.pieces) { (r: MacOrdersListRow) in
                Text("\(r.pieces)").monospacedDigit()
            }
            .width(min: 40, ideal: 50)
            TableColumn("Karigars", value: \.karigars) { (r: MacOrdersListRow) in
                Text(r.karigars).lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 70, ideal: 120)
            TableColumn("Total", value: \.worth) { (r: MacOrdersListRow) in
                money(r.worth)
            }
            .width(min: 80, ideal: 100)
            TableColumn("Advance", value: \.advance) { (r: MacOrdersListRow) in
                money(r.advance > 0 ? r.advance : nil)
            }
            .width(min: 80, ideal: 100)
            TableColumn("Owed", value: \.owed) { (r: MacOrdersListRow) in
                money(r.owed >= 1 ? r.owed : nil, tone: .owed)
            }
            .width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            menu(ids)
        } primaryAction: { (ids: Set<String>) in
            open(ids)
        }
    }

    /// The promised day, red once late and amber when it is due today or inside the bench week.
    private func promised(_ r: MacOrdersListRow) -> some View {
        Text(r.promisedDay)
            .foregroundStyle(r.promisedTone == .quiet ? Color.primary : r.promisedTone.color)
            .help(r.promisedHelp)
    }

    private func money(_ amount: Double?, tone: Tone = .quiet) -> some View {
        Text(amount.map { Money.pkr($0) } ?? "")
            .monospacedDigit()
            .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
#endif
