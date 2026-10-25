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

    var body: some View {
        GeometryReader { geo in
            let columns = closedShown ? working + closed : working
            let width = columnWidth(geo.size.width, count: columns.count + 1)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(columns) { (c: MacOrdersBoardColumn) in
                        column(c)
                            .frame(width: width)
                        Divider()
                    }
                    foldColumn
                        .frame(width: width)
                }
                .frame(height: geo.size.height, alignment: .top)
            }
        }
    }

    private func columnWidth(_ total: CGFloat, count: Int) -> CGFloat {
        let fit = total / CGFloat(max(count, 1))
        return min(max(fit, 250), 380)
    }

    // MARK: A column

    private func column(_ c: MacOrdersBoardColumn) -> some View {
        let accepts = c.stage == .ready || c.stage == .karigar
        return VStack(alignment: .leading, spacing: 0) {
            header(c)
            Divider()
            ScrollView {
                LazyVStack(spacing: 2) {
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
                .padding(6)
            }
        }
        .background(accepts && targeted == c.stage ? Color.accentColor.opacity(0.08) : Color.clear)
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            drop(ids, c.stage)
        } isTargeted: { (over: Bool) in
            if over { targeted = c.stage } else if targeted == c.stage { targeted = nil }
        }
    }

    private func header(_ c: MacOrdersBoardColumn) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(c.title).font(.headline).lineLimit(1)
            Text("\(c.rows.count)").foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 4)
            if c.worth > 0 {
                Text(Money.pkrLac(c.worth)).font(.callout).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: A row: customer · number, then what · promised

    private func row(_ r: MacOrdersListRow) -> some View {
        let picked = selection.contains(r.id)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(r.customer).fontWeight(.medium).lineLimit(1)
                Text("\u{00B7} " + r.id).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).layoutPriority(1)
            }
            HStack(spacing: 4) {
                Text(r.what).foregroundStyle(.secondary).lineLimit(1)
                if !r.promisedWords.isEmpty {
                    Text("\u{00B7}").foregroundStyle(.secondary)
                    Text(r.promisedWords)
                        .foregroundStyle(r.promisedTone == .quiet ? Color.secondary : r.promisedTone.color)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
            }
            .font(.callout)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(picked ? Color.accentColor.opacity(0.22) : Color.clear, in: .rect(cornerRadius: 6, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open(r.id) }
        .onTapGesture { pick(r.id) }
        .draggable(r.id)
        .contextMenu {
            menu(r.id)
        }
        .help(r.promisedHelp)
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

    private var foldColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !searching && (closedCount > 0 || showClosed) {
                Button {
                    showClosed.toggle()
                } label: {
                    Text(showClosed ? "Hide Done and Cancelled" : "Show Done and Cancelled (\(closedCount))")
                }
                .buttonStyle(.link)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
#endif
