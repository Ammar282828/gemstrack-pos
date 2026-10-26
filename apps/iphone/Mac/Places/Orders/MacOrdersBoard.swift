#if os(macOS)
import SwiftUI
import AppKit
import ERPCore

// The Orders board (docs/features/mac-design.md, rule 4 and "Orders"): a column to each stage, compact two-line rows,
// selectable (the selection drives the inspector), and a row dragged from With karigars to Ready to hand over marks it
// ready, and back. Done and Cancelled are history: folded behind a button until asked for, or until a search needs them.

struct MacOrdersBoard<RowMenu: View>: View {
    let working: [MacOrdersBoardColumn]
    let closed: [MacOrdersBoardColumn]
    /// A search is on: the folded stages open so its hits are not hidden.
    let searching: Bool
    @Binding var selection: Set<String>
    let open: (String) -> Void
    /// Dropped orders on a stage: whether any of them moved.
    let drop: ([String], OrderStage) -> Bool
    @ViewBuilder let menu: (String) -> RowMenu

    @State private var showClosed = false
    @State private var targeted: OrderStage?

    private var closedShown: Bool { showClosed || searching }
    private var closedCount: Int { closed.reduce(0) { $0 + $1.rows.count } }
    /// The strip above the columns that folds Done and Cancelled in and out (not a column of its own: the columns share
    /// the whole width).
    private var showsFold: Bool { !searching && (closedCount > 0 || showClosed) }
    private static var foldHeight: CGFloat { 29 }

    var body: some View {
        GeometryReader { geo in
            let columns = closedShown ? working + closed : working
            let width = columnWidth(geo.size.width, count: columns.count)
            let height = showsFold ? geo.size.height - Self.foldHeight : geo.size.height
            VStack(spacing: 0) {
                if showsFold { foldBar }
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(columns) { (c: MacOrdersBoardColumn) in
                            column(c)
                                .frame(width: width)
                            Divider()
                        }
                    }
                    .frame(height: max(height, 0), alignment: .top)
                }
            }
        }
        .background(Theme.ground)
    }

    private func columnWidth(_ total: CGFloat, count: Int) -> CGFloat {
        let fit = total / CGFloat(max(count, 1))
        return min(max(fit, 210), 380)
    }

    // MARK: A column

    private func column(_ c: MacOrdersBoardColumn) -> some View {
        let accepts = c.stage == .ready || c.stage == .karigar
        return VStack(alignment: .leading, spacing: 0) {
            header(c)
            Divider()
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(c.rows) { (r: MacOrdersListRow) in
                        row(r)
                    }
                    if c.rows.isEmpty {
                        Text("None")
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    }
                }
                .padding(8)
            }
        }
        .background(accepts && targeted == c.stage ? Theme.accent.opacity(0.08) : Color.clear)
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            drop(ids, c.stage)
        } isTargeted: { (over: Bool) in
            if over { targeted = c.stage } else if targeted == c.stage { targeted = nil }
        }
    }

    private func header(_ c: MacOrdersBoardColumn) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(c.title).font(.headline).lineLimit(1)
            Text("\(c.rows.count)").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 4)
            if c.worth > 0 {
                Text(Money.pkrLac(c.worth)).font(.callout).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: A card: monogram and customer over number and piece, the promise and what is owed

    private func row(_ r: MacOrdersListRow) -> some View {
        let picked = selection.contains(r.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Monogram(name: r.customer, size: Monogram.Size.row)
                VStack(alignment: .leading, spacing: 1) {
                    Text(r.customer).font(.body).lineLimit(1)
                    Text(r.id).font(.caption).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
                }
                Spacer(minLength: 4)
                money(r)
            }
            if !r.what.isEmpty {
                Text(r.what).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            HStack(spacing: 8) {
                StageTrack(stage: r.stage).frame(width: 64)
                Spacer(minLength: 4)
                if !r.promisedDay.isEmpty && r.stage != .done && r.stage != .closed {
                    let urgent = !r.promisedWords.isEmpty
                    Text(urgent ? r.promisedWords : "Due " + r.promisedDay)
                        .font(.caption.weight(urgent ? .semibold : .regular))
                        .foregroundStyle(urgent ? r.promisedTone.color : Color.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(Metrics.cardPadding - 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
        .overlay {
            if picked {
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Theme.accent, lineWidth: 2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open(r.id) }
        .onTapGesture { pick(r.id) }
        .draggable(r.id)
        .contextMenu {
            menu(r.id)
        }
        .help(r.promisedHelp)
    }

    @ViewBuilder
    private func money(_ r: MacOrdersListRow) -> some View {
        if r.stage == .closed {
            EmptyView()
        } else if abs(r.owed) >= 1 {
            RowAmount(amount: abs(r.owed), tone: r.owed < 0 ? Tone.credit.color : Tone.owed.color)
        } else {
            Pill("Paid", tone: .settled)
        }
    }

    /// A click picks the one; a click with Command held adds it to, or takes it from, the picked.
    private func pick(_ id: String) {
        if NSEvent.modifierFlags.contains(.command) {
            if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
        } else {
            selection = [id]
        }
    }

    // MARK: Done and Cancelled

    private var foldBar: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                Button {
                    showClosed.toggle()
                } label: {
                    Text(showClosed ? "Hide Done and Cancelled" : "Show Done and Cancelled (\(closedCount))")
                }
                .buttonStyle(.link)
            }
            .padding(.horizontal, 12)
            .frame(height: Self.foldHeight - 1)
            Divider()
        }
    }
}
#endif
