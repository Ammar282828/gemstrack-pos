#if os(macOS)
import SwiftUI
import ERPCore

// The few plain parts the reports (Today's cash, Analytics) share: a section's header, a block of label and value rows, and
// the sort-ready numeric cell. Nothing here reads or writes the books.

/// A report's row of figures. Reports build the kit's `MacFigures` here and nowhere else, so its initializer is named once.
/// Each figure needs about 150 points; a row too narrow for them all (five or more on a small window) breaks into two rows
/// of plain figures rather than cutting every value short.
@ViewBuilder
func macReportsFigures(_ figures: [MacFigure]) -> some View {
    if figures.count <= 4 {
        MacFigures(figures: figures)
    } else {
        MacReportsWidth(CGFloat(figures.count) * 150) {
            MacFigures(figures: figures)
        } narrow: {
            VStack(spacing: 0) {
                MacFigures(figures: Array(figures.prefix((figures.count + 1) / 2)))
                Divider()
                MacFigures(figures: Array(figures.dropFirst((figures.count + 1) / 2)))
            }
        }
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
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
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
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
            }
        }
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
