#if os(macOS)
import SwiftUI
import ERPCore

// The few plain parts the reports (Today's cash, Analytics) share: a section's header, a block of label and value rows, and
// the sort-ready numeric cell. Nothing here reads or writes the books.

/// A report's figures as cards (the iPhone's figure tiles at a pointer's scale): a grid that uses the width, each figure a
/// card with its label, the value large, and the line under it (a change against the period compared, a count). Reports
/// build the kit's `MacFigure`s and hand them here, so the initializer is named once.
@ViewBuilder
func macReportsFigures(_ figures: [MacFigure]) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 360), spacing: 12)], spacing: 12) {
        ForEach(figures) { (f: MacFigure) in
            MacReportsFigureCard(figure: f)
        }
    }
}

/// One figure as a card: a click opens its place when it has one.
struct MacReportsFigureCard: View {
    let figure: MacFigure
    @State private var hovering = false

    var body: some View {
        if let open = figure.open {
            Button(action: open) { card }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .help("Open \(figure.label)")
        } else {
            card
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(figure.label).font(.callout.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
            Text(figure.value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(figure.tone?.color ?? Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(figure.detail ?? " ")
                .font(.caption)
                .foregroundStyle(figure.detailTone?.color ?? Color.secondary)
                .lineLimit(2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
        .modifier(MacDashSurface(hovering: hovering && figure.open != nil))
    }
}

/// A report's card: what is inside (a chart, a block of rows, a table) on the card colour with the house's hairline and
/// lift. A table inside is clipped to the card's corners.
struct MacReportsCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .modifier(MacDashSurface())
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
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
