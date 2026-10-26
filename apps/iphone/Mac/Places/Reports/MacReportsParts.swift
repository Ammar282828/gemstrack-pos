#if os(macOS)
import SwiftUI
import ERPCore

// The few plain parts the reports (Today's cash, Analytics) share: a section's header, a block of label and value rows, and
// the sort-ready numeric cell. Nothing here reads or writes the books.

/// A report's figures as cards (the iPhone's figure tiles at a pointer's scale): a grid that uses the width, each figure a
/// card with its label, the value large, and the line under it (a change against the period compared, a count). Reports
/// build the kit's `MacFigure`s and hand them here, so the initializer is named once.
func macReportsFigures(_ figures: [MacFigure]) -> some View {
    MacFigureGrid(figures, minimum: 170)
}

/// One figure as a card (the kit's `MacFigureCard`: the one look of a figure on the Mac).
struct MacReportsFigureCard: View {
    let figure: MacFigure

    var body: some View { MacFigureCard(figure: figure) }
}

/// A report's card: what is inside (a chart, a block of rows, a table) on the card colour with the house's hairline and
/// lift. A table inside is clipped to the card's corners. The card fills the height it is given, its surface included
/// (`maxHeight` is before the background), so cards side by side in a row stand level (owner's snapshots, 2026-10-27:
/// three cards of one row stood at three heights).
struct MacReportsCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .modifier(MacDashSurface())
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

/// How tall a `Table` is inside a card: a row is the house's 44 points (`HouseGround`) and the header 36. A table given
/// less than its rows cut the last one in half and one given more left an empty band under them (owner's snapshots,
/// 2026-10-27), so a short table is `.macReportsTable(rows:)`: the row height set here and the frame worked out from it.
enum MacReportsTable {
    static let row: CGFloat = 44
    static let header: CGFloat = 36

    /// The height of `rows` rows under the header; `cap` rows at most (a longer table scrolls inside its card).
    static func height(rows: Int, cap: Int? = nil) -> CGFloat {
        let shown = min(max(rows, 1), cap ?? Int.max)
        return header + row * CGFloat(shown)
    }
}

extension View {
    /// A table sized to its rows (see `MacReportsTable`).
    func macReportsTable(rows: Int, cap: Int? = nil) -> some View {
        environment(\.defaultMinListRowHeight, MacReportsTable.row)
            .frame(height: MacReportsTable.height(rows: rows, cap: cap))
    }
}

/// One row of a `MacReportsGrid`: its cells as words, the tone of any cell that has one (by column), and, for a row that
/// opens something, what its first cell does when it is clicked (it is then a link in the house's accent).
struct MacReportsGridRow: Identifiable {
    let id: String
    let cells: [String]
    var tones: [Int: Tone] = [:]
    var open: (() -> Void)?
    var hint: String = ""

    init(_ id: String, _ cells: [String], tones: [Int: Tone] = [:], hint: String = "", open: (() -> Void)? = nil) {
        self.id = id
        self.cells = cells
        self.tones = tones
        self.hint = hint
        self.open = open
    }
}

/// A short table drawn as rows, a header and a hairline between rows: the first column takes the room, the others are as
/// wide as their digits. Nothing in it can be cut off at the card's edge or leave a row half drawn, which a `Table` sized by
/// hand did (the gold sold by karat, the yearly performance; owner's snapshots, 2026-10-27).
struct MacReportsGrid: View {
    let headers: [String]
    let rows: [MacReportsGridRow]

    var body: some View {
        Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(headers.enumerated()), id: \.offset) { (i: Int, h: String) in
                    cell(h, column: i)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(rows) { (r: MacReportsGridRow) in
                Divider()
                GridRow {
                    ForEach(Array(r.cells.enumerated()), id: \.offset) { (i: Int, text: String) in
                        if i == 0, let open = r.open {
                            Button(action: open) { cell(text, column: i) }
                                .buttonStyle(.plain)
                                .foregroundStyle(Theme.accent)
                                .pointerHover()
                                .help(r.hint)
                        } else {
                            cell(text, column: i)
                                .foregroundStyle(r.tones[i]?.color ?? Color.primary)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func cell(_ text: String, column: Int) -> some View {
        let room: CGFloat? = column == 0 ? CGFloat.infinity : nil
        return Text(text)
            .monospacedDigit()
            .lineLimit(1)
            .padding(.vertical, 7)
            .frame(maxWidth: room, alignment: column == 0 ? .leading : .trailing)
    }
}

/// Lays one arrangement out when the room is `breakpoint` points wide or more, another below it: a report's side-by-side
/// columns on a wide window, one under another on a narrow one (a list must still work at 600 points). Only the choice is
/// state, so the page is redrawn when the width crosses the breakpoint and not while it is dragged.
struct MacReportsWidth<Wide: View, Narrow: View>: View {
    let breakpoint: CGFloat
    let wide: () -> Wide
    let narrow: () -> Narrow
    @State private var isWide = true

    init(_ breakpoint: CGFloat, @ViewBuilder _ wide: @escaping () -> Wide, @ViewBuilder narrow: @escaping () -> Narrow) {
        self.breakpoint = breakpoint
        self.wide = wide
        self.narrow = narrow
    }

    var body: some View {
        Group {
            if isWide { wide() } else { narrow() }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: Bool.self) { (g: GeometryProxy) -> Bool in g.size.width >= breakpoint } action: { (now: Bool) in
            if isWide != now { isWide = now }
        }
    }
}

/// A table's or block's header: plain bold words, a count or note beside them at the right.
struct MacReportsHeader: View {
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.headline)
            Spacer(minLength: 8)
            if let detail, !detail.isEmpty {
                Text(detail).font(.callout).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }
}

/// A money or count cell, right-aligned in steady digits.
struct MacReportsNumber: View {
    let text: String
    var tone: Tone?

    init(_ text: String, tone: Tone? = nil) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .monospacedDigit()
            .foregroundStyle(tone?.color ?? Color.primary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// A few label and value rows (a small breakdown that is not a list): the label at the left, the value at the right.
struct MacReportsFacts: View {
    let title: String
    var detail: String?
    let rows: [MacReportsFact]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: title, detail: detail)
            ForEach(rows) { (r: MacReportsFact) in
                HStack(alignment: .firstTextBaseline) {
                    Text(r.label).foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(r.value).monospacedDigit().foregroundStyle(r.tone?.color ?? Color.primary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 5)
            }
        }
        .padding(.bottom, 8)
    }
}

struct MacReportsFact: Identifiable {
    let label: String
    let value: String
    var tone: Tone?
    var id: String { label }

    init(_ label: String, _ value: String, tone: Tone? = nil) {
        self.label = label
        self.value = value
        self.tone = tone
    }
}
#endif
