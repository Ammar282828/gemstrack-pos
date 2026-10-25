#if os(macOS)
import SwiftUI
import ERPCore

// New order, the centre (docs/features/mac-design.md, "New order"): the pieces as a table, a small button bar under it, and
// the order's running figures. Picking a piece shows its editor in the right panel; nothing here changes what is saved.

/// One piece as a row of the table.
struct MacNewOrderRow: Identifiable {
    let id: UUID
    let number: Int
    let title: String
    let metal: String
    let weight: String
    let size: String
    let karigar: String
    let price: Double

    init(piece: NewOrderPieceDraft, number: Int, price: Double, karigar: String) {
        id = piece.id
        self.number = number
        title = NewOrderFormat.trim(piece.description)
        metal = describeMetal(piece.metal, piece.karat)
        if piece.manual {
            weight = "Fixed price"
        } else {
            let w = NewOrderFormat.num(piece.weight)
            weight = w > 0 ? NewOrderFormat.trimmed(w) + " g" : ""
        }
        size = NewOrderFormat.trim(piece.size)
        self.karigar = karigar
        self.price = price
    }
}

struct MacNewOrderPieces: View {
    let rows: [MacNewOrderRow]
    @Binding var selection: Set<UUID>
    let totals: NewOrderMath.Totals
    let add: () -> Void
    let addFromStock: () -> Void
    let remove: (Set<UUID>) -> Void
    let duplicate: (Set<UUID>) -> Void
    /// Double-click or Return on a piece: its editor.
    let open: (Set<UUID>) -> Void

    var body: some View {
        VStack(spacing: 0) {
            table
            Divider()
            bar
            MacNewOrderTotals(totals: totals, pieces: rows.count)
        }
    }

    private var table: some View {
        Table(rows, selection: $selection) {
            TableColumn("#") { (r: MacNewOrderRow) in
                Text("\(r.number)").monospacedDigit().foregroundStyle(.secondary)
            }
            .width(28)
            TableColumn("Piece") { (r: MacNewOrderRow) in
                Text(r.title.isEmpty ? "Untitled piece" : r.title)
                    .foregroundStyle(r.title.isEmpty ? Color.secondary : Color.primary)
                    .lineLimit(1)
            }
            TableColumn("Metal") { (r: MacNewOrderRow) in
                Text(r.metal).lineLimit(1)
            }
            .width(min: 80, ideal: 110)
            TableColumn("Weight") { (r: MacNewOrderRow) in
                Text(r.weight).monospacedDigit().lineLimit(1)
            }
            .width(min: 60, ideal: 80)
            TableColumn("Size") { (r: MacNewOrderRow) in
                Text(r.size).monospacedDigit().lineLimit(1)
            }
            .width(min: 40, ideal: 70)
            TableColumn("Karigar") { (r: MacNewOrderRow) in
                Text(r.karigar).lineLimit(1)
            }
            .width(min: 60, ideal: 90)
            TableColumn("Price") { (r: MacNewOrderRow) in
                Text(r.price > 0 ? Money.pkr(r.price) : "")
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: UUID.self) { ids in
            if !ids.isEmpty {
                Button { duplicate(ids) } label: { Label("Duplicate Piece", systemImage: "plus.square.on.square") }
                Button(role: .destructive) { remove(ids) } label: { Label("Remove Piece", systemImage: "minus.circle") }
            }
        } primaryAction: { ids in
            open(ids)
        }
        .onDeleteCommand { remove(selection) }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView("No Pieces Yet", systemImage: "diamond",
                                       description: Text("Add a piece to see the price."))
            }
        }
    }

    /// + Add a Piece, + From Stock..., - Remove: a small bar, as Finder's and Mail's lists have under them.
    private var bar: some View {
        HStack(spacing: 14) {
            Button(action: add) { Label("Add a Piece", systemImage: "plus") }
            Button(action: addFromStock) { Label("From Stock\u{2026}", systemImage: "plus") }
            Button { remove(selection) } label: { Label("Remove", systemImage: "minus") }
                .disabled(selection.isEmpty)
            Spacer(minLength: 0)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .frame(height: 30)
    }
}

/// The order's figures under the table: what the pieces come to, what comes off, what is left. Nothing at zero but the
/// estimate and the balance.
struct MacNewOrderTotals: View {
    let totals: NewOrderMath.Totals
    let pieces: Int

    private var balanceTone: Tone {
        if totals.balance <= -1 { return .credit }
        return totals.balance >= 1 ? .owed : .settled
    }

    var body: some View {
        VStack(spacing: 3) {
            line("Estimate \u{00B7} " + NewOrderFormat.pieces(pieces), Money.pkr(totals.subtotal))
            if totals.discount > 0 { line("Discount", "\u{2212}" + Money.pkr(totals.discount)) }
            if totals.advance > 0 { line("Advance paid", "\u{2212}" + Money.pkr(totals.advance)) }
            if totals.exchange > 0 { line("Taken in exchange", "\u{2212}" + Money.pkr(totals.exchange)) }
            line(totals.balance <= -1 ? "Credit to customer" : "Balance due", Money.pkr(abs(totals.balance)), tone: balanceTone, bold: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .background(.bar)
    }

    private func line(_ label: String, _ value: String, tone: Tone? = nil, bold: Bool = false) -> some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)
            Text(label).foregroundStyle(.secondary)
            Text(value)
                .monospacedDigit()
                .fontWeight(bold ? .semibold : .regular)
                .foregroundStyle(tone?.color ?? Color.primary)
                .frame(minWidth: 110, alignment: .trailing)
        }
        .font(.callout)
    }
}
#endif
