#if os(macOS)
import SwiftUI
import ERPCore

// The Orders table (docs/features/mac-design.md, "Orders"): Number, Customer, Stage, Promised, Karigars, Total, Owed
// (the pieces and advances are the inspector's: seven columns fit a 13-inch MacBook beside the sidebar and inspector).
// Sortable on every column, multi-select; Return or a double-click opens the order in its own window; the right-click
// menu is the Order menu's. The rows are made once per change of the books in the place and handed in; the
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
            .width(min: 70, ideal: 96)
            TableColumn("Customer", value: \.customer) { (r: MacOrdersListRow) in
                Text(r.customer).lineLimit(1)
            }
            .width(min: 120, ideal: 180)
            TableColumn("Stage", value: \.stageRank) { (r: MacOrdersListRow) in
                MacStatus(r.stageWords, tone: r.stageTone)
            }
            .width(min: 90, ideal: 130)
            TableColumn("Promised", value: \.promisedKey) { (r: MacOrdersListRow) in
                promised(r)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Karigars", value: \.karigars) { (r: MacOrdersListRow) in
                Text(r.karigars).lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 80, ideal: 120)
            TableColumn("Total", value: \.worth) { (r: MacOrdersListRow) in
                MacAmount(r.worth)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Owed", value: \.owed) { (r: MacOrdersListRow) in
                MacAmount(r.owed >= 1 ? r.owed : nil, tone: .owed)
            }
            .width(min: 70, ideal: 90)
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
}
#endif
