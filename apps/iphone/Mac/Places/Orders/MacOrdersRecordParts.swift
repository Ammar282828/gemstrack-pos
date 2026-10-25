#if os(macOS)
import SwiftUI
import ERPCore

// The parts of an order's record window (docs/features/mac-design.md, "Orders": "the order document"): the pieces and
// the advances as tables drawn at their own height (the window has one scroll, so no table scrolls inside it), the
// picked piece in full, and the plain rows the money and the details are set in. They arrange what the order page hands
// them; its state and its writes stay in OrderScreen.

// MARK: A table drawn in the page

/// A column of a page table: its title, and how wide (nil takes a share of what is left).
private struct MacOrdersColumnSpec {
    let title: String
    let width: CGFloat?
    let trailing: Bool
}

private func macOrdersHeaderRow(_ columns: [MacOrdersColumnSpec]) -> some View {
    HStack(spacing: 12) {
        ForEach(Array(columns.enumerated()), id: \.offset) { pair in
            Text(pair.element.title)
                .frame(minWidth: pair.element.width, maxWidth: pair.element.width ?? .infinity,
                       alignment: pair.element.trailing ? .trailing : .leading)
        }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
}

// MARK: The pieces of an order

/// One piece as the table reads it.
struct OrderPieceTableRow: Identifiable {
    /// The piece's place on the order, which is what every write takes.
    let id: Int
    let item: OrderItem
    let done: Bool
    let karigar: String?
}

/// An order's pieces: the done tick, what it is, what the order captured, who has it and its price. Click picks a piece
/// (its details are the page's right column); right-click gives the piece's moves.
struct MacOrdersPiecesGrid: View {
    let rows: [OrderPieceTableRow]
    @Binding var picked: Int?
    let canTick: Bool
    let canRemove: Bool
    /// The shop's karigars when the person may give pieces out here; empty shows the name only.
    let karigars: [Karigar]
    /// The karigar's id now on a piece ("none" when nobody).
    let karigarId: (Int) -> String
    let tick: (Int, Bool) -> Void
    let assign: (Int, String) -> Void
    let remove: (Int) -> Void

    private static let columns = [
        MacOrdersColumnSpec(title: "", width: 20, trailing: false),
        MacOrdersColumnSpec(title: "Piece", width: nil, trailing: false),
        MacOrdersColumnSpec(title: "What it is", width: nil, trailing: false),
        MacOrdersColumnSpec(title: "Karigar", width: 150, trailing: false),
        MacOrdersColumnSpec(title: "Price", width: 96, trailing: true),
    ]

    var body: some View {
        VStack(spacing: 0) {
            macOrdersHeaderRow(Self.columns)
            Divider()
            ForEach(rows) { (r: OrderPieceTableRow) in
                row(r)
                Divider()
            }
        }
    }

    private func row(_ r: OrderPieceTableRow) -> some View {
        let isPicked = picked == r.id
        return HStack(spacing: 12) {
            doneCell(r).frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(r.item.description.isEmpty ? "Piece \(r.id + 1)" : r.item.description)
                    .foregroundStyle(r.done ? Color.secondary : Color.primary)
                    .lineLimit(1)
                if let category = OrdersLogic.categorySingular(r.item.itemCategory) {
                    Text(category).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(OrderPieceRow.facts(r.item).joined(separator: " \u{00B7} "))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            karigarCell(r).frame(width: 150, alignment: .leading)
            Text(r.item.totalEstimate.map { Money.pkr($0) } ?? "")
                .monospacedDigit()
                .frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(isPicked ? Color.accentColor.opacity(0.18) : Color.clear, in: .rect(cornerRadius: 6, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { picked = r.id }
        .contextMenu { menu(r) }
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
                ForEach(karigars) { (k: Karigar) in Text(k.name).tag(k.id) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        } else if let name = r.karigar {
            Text(name).lineLimit(1)
        } else {
            Text(r.done ? "" : "Not given out").foregroundStyle(Tone.owed.color)
        }
    }

    @ViewBuilder
    private func menu(_ r: OrderPieceTableRow) -> some View {
        if canTick {
            Button(r.done ? "Mark Not Done" : "Mark Done") { tick(r.id, !r.done) }
        }
        if !karigars.isEmpty {
            Menu("Give To") {
                ForEach(karigars) { (k: Karigar) in
                    Button(k.name) { assign(r.id, k.id) }
                }
                Divider()
                Button("Unassigned") { assign(r.id, "none") }
            }
        }
        if canRemove {
            Divider()
            Button("Remove This Piece\u{2026}", role: .destructive) { remove(r.id) }
        }
    }
}

/// The picked piece in full: its photograph, what the order captured, the price broken down (owners), the notes for the
/// bench. The right column of the page.
struct MacOrdersPieceDetail: View {
    let index: Int
    let item: OrderItem
    /// The price broken into metal, wastage, making, diamonds and stones: owners only.
    let showBreakdown: Bool

    /// The sample photo kept in its own document, once read (OrderPiecePhoto.stored).
    @State private var storedPhoto: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(item.description.isEmpty ? "Piece \(index + 1)" : item.description)
                .font(.headline)
                .textSelection(.enabled)
            if let uri = OrderPiecePhoto.inline(item) ?? storedPhoto {
                StockImage(imageUrl: uri, name: item.description, key: item.samplePhotoId ?? uri, decodeDataURI: true)
                    .frame(width: 132, height: 132)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    .accessibilityLabel("Sample photo")
            }
            let facts = OrderPieceRow.facts(item)
            if !facts.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(facts.enumerated()), id: \.offset) { pair in
                        Text(pair.element).foregroundStyle(.secondary)
                    }
                }
            }
            notes
            breakdown
        }
        .task(id: item.samplePhotoId) { storedPhoto = await OrderPiecePhoto.stored(item) }
    }

    @ViewBuilder
    private var notes: some View {
        if let d = clean(item.diamondDetails) { note("Diamonds", d) }
        if let s = clean(item.stoneDetails) { note("Stones", s) }
        // Owners only: the staff's copy of the order comes without it (roles.ts).
        if let a = clean(item.adminNote) { note("Instructions for the karigar (never printed)", a) }
    }

    private func note(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(text).textSelection(.enabled)
        }
    }

    private func clean(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    @ViewBuilder
    private var breakdown: some View {
        if let total = item.totalEstimate {
            VStack(spacing: 3) {
                if showBreakdown && !item.isManualPrice {
                    line("Metal", item.metalCost ?? 0, always: true)
                    line("Wastage", item.wastageCost ?? 0)
                    line("Making", item.makingCharges)
                    line("Diamonds", item.diamondCharges)
                    line("Stones", item.stoneCharges)
                    Divider()
                }
                HStack {
                    Text("Item total").fontWeight(.semibold)
                    Spacer(minLength: 8)
                    Text(Money.pkr(total)).fontWeight(.semibold).monospacedDigit()
                }
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func line(_ label: String, _ amount: Double, always: Bool = false) -> some View {
        if always || amount > 0 {
            HStack {
                Text(label).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(Money.pkr(amount)).monospacedDigit()
            }
        }
    }
}

// MARK: The advances of an order

/// The advances taken on an order, each with its day, how it was paid and its note. Right-click deletes one, behind the
/// delete code, for an owner.
struct MacOrdersAdvancesGrid: View {
    let lines: [OrdersLogic.AdvanceLine]
    let canDelete: Bool
    let delete: (OrdersLogic.AdvanceLine) -> Void

    private static let columns = [
        MacOrdersColumnSpec(title: "Day", width: 96, trailing: false),
        MacOrdersColumnSpec(title: "How it was paid", width: 120, trailing: false),
        MacOrdersColumnSpec(title: "Note", width: nil, trailing: false),
        MacOrdersColumnSpec(title: "Amount", width: 96, trailing: true),
    ]

    var body: some View {
        VStack(spacing: 0) {
            macOrdersHeaderRow(Self.columns)
            Divider()
            ForEach(lines) { (l: OrdersLogic.AdvanceLine) in
                row(l)
                Divider()
            }
        }
    }

    private func row(_ l: OrdersLogic.AdvanceLine) -> some View {
        HStack(spacing: 12) {
            Text(ShopDate.say(l.date)).frame(width: 96, alignment: .leading)
            Text(l.method).frame(width: 120, alignment: .leading)
            Text([l.note, l.gold].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(l.amount > 0 || l.gold.isEmpty ? Money.pkr(l.amount) : "")
                .monospacedDigit()
                .frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .contextMenu {
            if canDelete {
                Button("Delete This Advance\u{2026}", role: .destructive) { delete(l) }
            }
        }
    }
}

// MARK: Plain rows

/// A label and its figure, as an invoice's totals are set: the figure in monospaced digits at the right.
struct MacOrdersMoneyRow: View {
    let label: String
    let value: String
    var strong = false
    var tone: Tone = .quiet
    var small = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(strong ? Color.primary : Color.secondary)
            Spacer(minLength: 12)
            Text(value)
                .monospacedDigit()
                .fontWeight(strong ? .semibold : .regular)
                .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
        }
        .font(small ? .callout : .body)
    }
}

/// A fact of the details column: its name small above, its words under.
struct MacOrdersFact<Value: View>: View {
    let label: String
    @ViewBuilder let value: () -> Value

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            value()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif
