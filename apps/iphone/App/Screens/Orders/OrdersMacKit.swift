#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's pieces for the Orders screens (apps/iphone/Mac/MAC-CONVENTIONS.md): a record window's two columns, the
// pieces and the advances as tables, the stage board, and the sheets a form opens in. The screens keep their own state
// and writes; nothing here decides anything, it only arranges what they hand it.

extension View {
    /// A Mac sheet at the size its content reads at (rule: forms 520-720 wide).
    func ordersMacSheet(width: CGFloat = 560, height: CGFloat = 440) -> some View {
        frame(minWidth: width, idealWidth: width, minHeight: height, idealHeight: height)
    }
}

// MARK: A record window: the summary on the left, the lines on the right

/// A record page on a Mac: from `wideFrom` wide, the summary in a left column (its own List) and the lines on the
/// right in a page of their own; narrower (a hub's side pane) it is one List, summary then lines, as the phone's.
struct MacRecordSplit<Top: View, Rest: View, Lines: View, Wide: View>: View {
    var leftWidth: CGFloat = 360
    var wideFrom: CGFloat = 900
    /// Who and where it stands (always first, on the left).
    @ViewBuilder let top: () -> Top
    /// The money and the quieter facts: under `top` on the left when wide, after the lines when narrow.
    @ViewBuilder let rest: () -> Rest
    /// The lines as List sections (the narrow page).
    @ViewBuilder let lines: () -> Lines
    /// The lines as the wide page's own content (tables).
    @ViewBuilder let wide: () -> Wide

    @State private var width: CGFloat = 0

    var body: some View {
        Group {
            if width >= wideFrom {
                HStack(spacing: 0) {
                    List {
                        top()
                        rest()
                    }
                    .listStyle(.insetGrouped)
                    .modifier(HouseGround())
                    .frame(width: leftWidth)
                    Divider()
                    ScrollView {
                        wide()
                            .padding(20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .background(Theme.ground)
                }
            } else {
                List {
                    top()
                    lines()
                    rest()
                }
                .listStyle(.insetGrouped)
                .modifier(HouseGround())
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

// MARK: The pieces of an order, as a table

/// One piece as the table reads it.
struct OrderPieceTableRow: Identifiable {
    /// The piece's place on the order, which is what every write takes.
    let id: Int
    let item: OrderItem
    let done: Bool
    let karigar: String?
}

/// An order's pieces: the done tick, what it is, what the order captured, who has it and its price, with the picked
/// piece in full beneath (photo, price breakdown, instructions). Right-click gives the piece's moves.
struct OrderPiecesTable<Detail: View>: View {
    let rows: [OrderPieceTableRow]
    let canTick: Bool
    let canRemove: Bool
    /// The shop's karigars when the person may give pieces out here; empty shows the name only.
    let karigars: [Karigar]
    /// The karigar's id now on a piece ("none" when nobody).
    let karigarId: (Int) -> String
    let tick: (Int, Bool) -> Void
    let assign: (Int, String) -> Void
    let remove: (Int) -> Void
    @ViewBuilder let detail: (Int) -> Detail

    @State private var selection: Int?

    private var tableHeight: CGFloat { min(max(CGFloat(rows.count) * 30 + 40, 130), 330) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Table(rows, selection: $selection) {
                TableColumn("") { (r: OrderPieceTableRow) in doneCell(r) }
                    .width(28)
                TableColumn("Piece") { (r: OrderPieceTableRow) in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.item.description.isEmpty ? "Piece \(r.id + 1)" : r.item.description)
                            .foregroundStyle(r.done ? Color.secondary : Color.primary)
                            .lineLimit(1)
                        if let category = OrdersLogic.categorySingular(r.item.itemCategory) {
                            Text(category).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .width(min: 140, ideal: 200)
                TableColumn("What it is") { (r: OrderPieceTableRow) in
                    Text(OrderPieceRow.facts(r.item).joined(separator: " \u{00B7} "))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .width(min: 140, ideal: 260)
                TableColumn("Karigar") { (r: OrderPieceTableRow) in karigarCell(r) }
                    .width(min: 120, ideal: 150)
                TableColumn("Price") { (r: OrderPieceTableRow) in
                    Text(r.item.totalEstimate.map { Money.pkr($0) } ?? "")
                        .monospacedDigit()
                }
                .width(min: 90, ideal: 110)
            }
            .frame(height: tableHeight)
            .contextMenu(forSelectionType: Int.self) { ids in menu(ids) }
            .onDeleteCommand { if canRemove, let i = selection { remove(i) } }
            if let i = selection, rows.contains(where: { $0.id == i }) {
                detail(i)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
            } else if !rows.isEmpty {
                Text("Click a piece to see it in full.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func doneCell(_ r: OrderPieceTableRow) -> some View {
        if canTick {
            Button { tick(r.id, !r.done) } label: {
                Image(systemName: r.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(r.done ? Tone.settled.color : Color.secondary)
            }
            .buttonStyle(.borderless)
            .help(r.done ? "Done: click to mark not done" : "Mark as complete")
        } else if r.done {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Tone.settled.color)
        }
    }

    @ViewBuilder
    private func karigarCell(_ r: OrderPieceTableRow) -> some View {
        if !karigars.isEmpty {
            Picker("Karigar", selection: Binding(get: { karigarId(r.id) }, set: { assign(r.id, $0) })) {
                Text("Unassigned").tag("none")
                ForEach(karigars) { k in Text(k.name).tag(k.id) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        } else if let name = r.karigar {
            Text(name)
        } else {
            Text(r.done ? "" : "Not given out").foregroundStyle(Tone.owed.color)
        }
    }

    @ViewBuilder
    private func menu(_ ids: Set<Int>) -> some View {
        if let i = ids.first, let r = rows.first(where: { $0.id == i }) {
            if canTick {
                Button(r.done ? "Mark not done" : "Mark done") { tick(i, !r.done) }
            }
            if !karigars.isEmpty {
                Menu("Give to") {
                    ForEach(karigars) { k in
                        Button(k.name) { assign(i, k.id) }
                    }
                    Divider()
                    Button("Unassigned") { assign(i, "none") }
                }
            }
            if canRemove {
                Divider()
                Button("Remove this piece", role: .destructive) { remove(i) }
            }
        }
    }
}

// MARK: The advances of an order, as a table

/// The advances taken on an order, each with its day, how it was paid and its note. Right-click (or the Delete key)
/// deletes one, behind the delete code, for an owner.
struct OrderAdvancesTable: View {
    let lines: [OrdersLogic.AdvanceLine]
    let canDelete: Bool
    let delete: (OrdersLogic.AdvanceLine) -> Void

    @State private var selection: Int?

    var body: some View {
        Table(lines, selection: $selection) {
            TableColumn("Day") { (l: OrdersLogic.AdvanceLine) in Text(ShopDate.say(l.date)) }
                .width(min: 90, ideal: 110)
            TableColumn("How it was paid") { (l: OrdersLogic.AdvanceLine) in Text(l.method) }
                .width(min: 100, ideal: 130)
            TableColumn("Note") { (l: OrdersLogic.AdvanceLine) in
                Text([l.note, l.gold].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            TableColumn("Amount") { (l: OrdersLogic.AdvanceLine) in
                Text(l.amount > 0 || l.gold.isEmpty ? Money.pkr(l.amount) : "").monospacedDigit()
            }
            .width(min: 90, ideal: 110)
        }
        .frame(height: min(max(CGFloat(lines.count) * 30 + 40, 100), 230))
        .contextMenu(forSelectionType: Int.self) { ids in
            if canDelete, let id = ids.first, let l = lines.first(where: { $0.id == id }) {
                Button("Delete this advance", role: .destructive) { delete(l) }
            }
        }
        .onDeleteCommand {
            if canDelete, let id = selection, let l = lines.first(where: { $0.id == id }) { delete(l) }
        }
    }
}

// MARK: The hub's board

/// One column of the board: a stage, with its orders.
struct OrdersBoardColumn: Identifiable {
    let id: String
    let title: String
    let hint: String
    let tone: Tone
    let folds: Bool
    let orders: [Order]
}

/// The Orders hub by stage on a Mac: a column for each stage side by side, each scrolling by itself, using the
/// window's width (and scrolling sideways when there are more columns than fit). Done and Closed fold away until
/// asked for, or until a search needs them.
struct OrdersStageBoard<Card: View>: View {
    let columns: [OrdersBoardColumn]
    @Binding var opened: Set<String>
    let forceOpen: Bool
    @ViewBuilder let card: (Order) -> Card

    var body: some View {
        GeometryReader { geometry in
            let count = max(columns.count, 1)
            let fit = (geometry.size.width - 40 - CGFloat(count - 1) * 16) / CGFloat(count)
            let columnWidth = min(max(fit, 290), 440)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(columns) { column in
                        VStack(alignment: .leading, spacing: 10) {
                            OrdersSectionHeader(
                                title: column.title,
                                hint: column.hint,
                                count: column.orders.count,
                                value: column.orders.reduce(0) { $0 + $1.subtotal },
                                tone: column.tone
                            )
                            if column.folds && !forceOpen && !opened.contains(column.id) {
                                Button("Show \(column.orders.count) order\(column.orders.count == 1 ? "" : "s")") {
                                    opened.insert(column.id)
                                }
                                .buttonStyle(.bordered)
                            } else {
                                ScrollView {
                                    LazyVStack(spacing: 14) {
                                        ForEach(column.orders) { order in card(order) }
                                    }
                                    .padding(.bottom, 20)
                                }
                                .scrollIndicators(.hidden)
                                if column.folds && !forceOpen {
                                    Button("Fold away") { opened.remove(column.id) }
                                        .buttonStyle(.borderless)
                                        .font(.footnote)
                                }
                            }
                        }
                        .frame(width: columnWidth)
                    }
                }
                .padding(20)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
#endif
