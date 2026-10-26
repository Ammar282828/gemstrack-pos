#if os(macOS)
import SwiftUI
import AppKit
import ERPCore

// The parts every Mac place is built from (docs/features/mac-design.md, "The kit"): a list's summary bar, a status dot,
// a report's row of figures, the inspector and its head, a record window's head, a combo box. Plain system styling:
// no cards, no serif, the house only in the accent.

// MARK: Status

/// A status as a dot in its tone and a word: "Owed", "With karigars", "Paid".
struct MacStatus: View {
    let text: String
    var tone: Tone = .quiet

    init(_ text: String, tone: Tone = .quiet) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(tone.color).frame(width: 7, height: 7)
            Text(text).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: The list's summary bar

/// The one line under a list: what it holds, or what is picked ("214 invoices · PKR 32.4 lac billed · PKR 1.2 lac owed").
struct MacSummaryBar: View {
    let parts: [String]

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 0) {
                Text(parts.filter { !$0.isEmpty }.joined(separator: "  ·  "))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .monospacedDigit()
                Spacer(minLength: 0)
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .frame(height: 26)
        }
        // Opaque, on the page's ground: a translucent bar showed the list's last rows through the words (owner's
        // snapshots, 2026-10-27).
        .background(Theme.ground)
    }
}

extension View {
    /// The list's summary bar at its foot.
    func macSummaryBar(_ parts: [String]) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) { MacSummaryBar(parts: parts) }
    }
}

// MARK: A sum in a table

/// A sum in a table's cell: the digits only, grouped as the ERP groups them and right-aligned ("123,000"), as Numbers sets a
/// column of money. The column's header names what it is, the summary bar carries "PKR": a "PKR " in every cell only
/// widens the column. Blank for nil.
struct MacAmount: View {
    let amount: Double?
    var tone: Tone = .quiet

    init(_ amount: Double?, tone: Tone = .quiet) {
        self.amount = amount
        self.tone = tone
    }

    var body: some View {
        Text(amount.map { Money.grouped($0) } ?? "")
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: A report's figures

/// One figure of a report's row: a label, the value, a line under it (a change against the period compared, a count),
/// and where a click takes it.
struct MacFigure: Identifiable {
    let label: String
    let value: String
    var detail: String?
    var tone: Tone?
    var detailTone: Tone?
    var open: (() -> Void)?
    /// The symbol in a tinted square beside the label, as Today's cards have it (optional).
    var symbol: String?
    var symbolTint: Color = Theme.accent
    /// The figure's own colour where a page sets one by colour rather than tone (the shared `FigureTile`'s tint).
    var valueTint: Color?
    var id: String { label }

    init(_ label: String, _ value: String, detail: String? = nil, tone: Tone? = nil, detailTone: Tone? = nil,
         open: (() -> Void)? = nil, symbol: String? = nil, symbolTint: Color = Theme.accent) {
        self.label = label
        self.value = value
        self.detail = detail
        self.tone = tone
        self.detailTone = detailTone
        self.open = open
        self.symbol = symbol
        self.symbolTint = symbolTint
    }
}

// MARK: Figure cards (the one figure card of every page)

/// The one look of a figure on the Mac (owner, 2026-10-27: "fix all ui inconsistencies"): a card with the label (and a
/// tinted symbol), the figure large in the house's serif as the iPhone's `FigureTile` sets it, and a line under it. Today,
/// Today's cash, Analytics, the Calendar, Visitors, Ads, Expenses and Overheads all draw their figures with it, in a
/// `MacFigureGrid`, so every row of figures is the same height, the same type and fills the width.
struct MacFigureCard<Extra: View>: View {
    let figure: MacFigure
    /// Room under the line for a chart or a bar; the same in every card of a row, so they stand level.
    let extraHeight: CGFloat
    let extra: () -> Extra
    @State private var hovering = false

    init(figure: MacFigure, extraHeight: CGFloat, @ViewBuilder extra: @escaping () -> Extra) {
        self.figure = figure
        self.extraHeight = extraHeight
        self.extra = extra
    }

    var body: some View {
        if let open = figure.open {
            Button(action: open) { card }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .animation(.easeOut(duration: 0.15), value: hovering)
                .help("Open \(figure.label)")
        } else {
            card
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let symbol = figure.symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(figure.symbolTint)
                        .frame(width: 26, height: 26)
                        .background(figure.symbolTint.opacity(0.15), in: .rect(cornerRadius: 7, style: .continuous))
                }
                Text(figure.label).font(.callout.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if figure.open != nil {
                    Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        .opacity(hovering ? 1 : 0)
                }
            }
            Text(figure.value)
                .font(MacType.figure)
                .monospacedDigit()
                .foregroundStyle(figure.valueTint ?? figure.tone?.color ?? Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(figure.detail ?? " ")
                .font(.callout)
                .foregroundStyle(figure.detailTone?.color ?? Color.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if extraHeight > 0 {
                // A ZStack, never a frame on the view itself: a frame on an EmptyView takes no room, and a card with
                // nothing under its line stood shorter than its neighbours (Today, 2026-10-27).
                ZStack(alignment: .bottomLeading) {
                    Color.clear
                    extra()
                }
                .frame(height: extraHeight)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
        .modifier(MacCardSurface(hovering: hovering && figure.open != nil))
    }
}

extension MacFigureCard where Extra == EmptyView {
    init(figure: MacFigure) {
        self.init(figure: figure, extraHeight: 0) { EmptyView() }
    }
}

/// The type every Mac page sets its figures in: the house's serif, as the iPhone's figure tiles and hero amounts.
enum MacType {
    static let figure = Font.system(size: 24, weight: .semibold, design: .serif)
    static let hero = Font.system(size: 30, weight: .semibold, design: .serif)
}

/// A card's surface: the house's card colour with its hairline and soft lift, lifted more under the pointer.
struct MacCardSurface: ViewModifier {
    var hovering = false

    func body(content: Content) -> some View {
        content
            .background(Theme.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.5))
            .shadow(color: .black.opacity(hovering ? 0.14 : 0.06), radius: hovering ? 14 : 6, y: hovering ? 6 : 2)
    }
}

/// Cards laid in even columns across the width: as many as fit at `minimum` points, balanced over the rows (six figures
/// on a wide window are three and three, never four and two), every card in a row as tall as the tallest and the row
/// filling the width. Before it, figure cards sat in adaptive grids capped at 400 points: four cards on a wide window
/// filled two thirds of it and stood at four heights (owner's snapshots, 2026-10-27). A card fills its cell when it
/// says `.frame(maxHeight: .infinity)` (the kit's cards do).
struct MacEvenLayout: Layout {
    var minimum: CGFloat = 190
    var spacing: CGFloat = 12

    private func columns(_ count: Int, _ width: CGFloat) -> Int {
        Self.columns(count: count, width: width, minimum: minimum, spacing: spacing)
    }

    /// How many columns `count` cards take in `width`: as many as fit at `minimum`, then balanced over the rows.
    static func columns(count: Int, width: CGFloat, minimum: CGFloat, spacing: CGFloat) -> Int {
        guard count > 0, width.isFinite else { return max(1, count) }
        let fit = max(1, Int((width + spacing) / (minimum + spacing)))
        let rows = Int((Double(count) / Double(min(fit, count))).rounded(.up))
        return max(1, Int((Double(count) / Double(rows)).rounded(.up)))
    }

    private func columnWidth(_ columns: Int, _ width: CGFloat) -> CGFloat {
        max(0, (width - spacing * CGFloat(columns - 1)) / CGFloat(columns))
    }

    private func rowHeights(_ width: CGFloat, _ subviews: Subviews) -> [CGFloat] {
        let cols = columns(subviews.count, width)
        let w = columnWidth(cols, width)
        var out: [CGFloat] = []
        var i = 0
        while i < subviews.count {
            let end = min(i + cols, subviews.count)
            var h: CGFloat = 0
            for j in i..<end { h = max(h, subviews[j].sizeThatFits(ProposedViewSize(width: w, height: nil)).height) }
            out.append(h)
            i = end
        }
        return out
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let n = CGFloat(subviews.count)
        var width = proposal.width ?? (minimum * n + spacing * max(0, n - 1))
        if !width.isFinite { width = minimum * n + spacing * max(0, n - 1) }
        let heights = rowHeights(width, subviews)
        return CGSize(width: width, height: heights.reduce(0, +) + spacing * CGFloat(max(0, heights.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let cols = columns(subviews.count, bounds.width)
        let w = columnWidth(cols, bounds.width)
        var y = bounds.minY
        for (r, h) in rowHeights(bounds.width, subviews).enumerated() {
            for c in 0..<cols {
                let i = r * cols + c
                guard i < subviews.count else { break }
                subviews[i].place(at: CGPoint(x: bounds.minX + CGFloat(c) * (w + spacing), y: y), anchor: .topLeading,
                                  proposal: ProposedViewSize(width: w, height: h))
            }
            y += h + spacing
        }
    }
}

/// `MacEvenLayout` over cells made by index.
struct MacEvenGrid<Cell: View>: View {
    let count: Int
    let minimum: CGFloat
    let spacing: CGFloat
    let cell: (Int) -> Cell

    init(count: Int, minimum: CGFloat = 190, spacing: CGFloat = 12, @ViewBuilder cell: @escaping (Int) -> Cell) {
        self.count = count
        self.minimum = minimum
        self.spacing = spacing
        self.cell = cell
    }

    var body: some View {
        MacEvenLayout(minimum: minimum, spacing: spacing) {
            ForEach(0..<count, id: \.self) { (i: Int) in cell(i) }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// A row of figures as cards: the figures of every report, dashboard and page head on the Mac.
struct MacFigureGrid: View {
    let figures: [MacFigure]
    var minimum: CGFloat = 190

    init(_ figures: [MacFigure], minimum: CGFloat = 190) {
        self.figures = figures
        self.minimum = minimum
    }

    var body: some View {
        MacEvenGrid(count: figures.count, minimum: minimum) { (i: Int) in
            MacFigureCard(figure: figures[i])
        }
    }
}

/// A report's figures in one row, divided by hairlines, as Stocks and Activity Monitor set theirs: plain, no cards.
struct MacFigures: View {
    let figures: [MacFigure]

    init(_ figures: [MacFigure]) { self.figures = figures }
    init(figures: [MacFigure]) { self.figures = figures }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(figures.enumerated()), id: \.element.id) { i, f in
                if i > 0 { Divider().frame(height: 40) }
                cell(f)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
            }
        }
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func cell(_ f: MacFigure) -> some View {
        let words = VStack(alignment: .leading, spacing: 2) {
            Text(f.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(f.value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(f.tone?.color ?? Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let detail = f.detail, !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(f.detailTone?.color ?? Color.secondary).lineLimit(1)
            }
        }
        if let open = f.open {
            Button(action: open) { words.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .help("Open \(f.label)")
        } else {
            words
        }
    }
}

// MARK: Headers

/// The one figure a record's head shows at its right: "Owed PKR 86,000".
struct MacHeadline {
    let label: String
    let value: String
    var tone: Tone = .quiet

    init(_ label: String, _ value: String, tone: Tone = .quiet) {
        self.label = label
        self.value = value
        self.tone = tone
    }
}

/// The head of the inspector: what is picked, its line, its status and the figure that matters, then its main actions.
struct MacInspectorHeader: View {
    let title: String
    var subtitle: String?
    var status: MacStatus?
    var headline: MacHeadline?
    var actions: [MacAction] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.weight(.semibold)).lineLimit(2).textSelection(.enabled)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if status != nil || headline != nil {
                HStack(alignment: .firstTextBaseline) {
                    if let status { status.font(.callout) }
                    Spacer(minLength: 8)
                    if let headline {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(headline.label).font(.caption).foregroundStyle(.secondary)
                            Text(headline.value).font(.title3.weight(.semibold)).monospacedDigit()
                                .foregroundStyle(headline.tone == .quiet ? Color.primary : headline.tone.color)
                        }
                    }
                }
            }
            if !actions.isEmpty { MacActionButtons(actions: actions) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The head of a record window: the same as the inspector's, at a window's size.
struct MacDocumentHeader: View {
    let title: String
    var subtitle: String?
    var status: MacStatus?
    var headline: MacHeadline?

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.title2.weight(.semibold)).lineLimit(2).textSelection(.enabled)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).foregroundStyle(.secondary).textSelection(.enabled)
                }
                if let status { status.padding(.top, 2) }
            }
            Spacer(minLength: 16)
            if let headline {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(headline.label).font(.callout).foregroundStyle(.secondary)
                    Text(headline.value).font(.title.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(headline.tone == .quiet ? Color.primary : headline.tone.color)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
}

// MARK: The inspector

enum MacInspector {
    /// Whether lists show the inspector (View › Show Inspector, ⌥⌘I), shared by every window.
    static let key = "mac.inspector.shown"
}

private struct MacInspectorModifier<Panel: View>: ViewModifier {
    @AppStorage(MacInspector.key) private var shown = true
    let panel: () -> Panel

    func body(content: Content) -> some View {
        content
            .inspector(isPresented: $shown) {
                panel()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // Every inspector on the page's ground: some panels drew it, some showed the window's grey, so two
                    // places side by side looked like two apps (owner's snapshots, 2026-10-27).
                    .background(Theme.ground)
                    .inspectorColumnWidth(min: 260, ideal: 300, max: 420)
                    // Declared inside the inspector, the toggle sits above it at the window's trailing edge, as
                    // Xcode's and Keynote's do; declared on the list it lands among the list's own buttons.
                    .toolbar {
                        ToolbarSpacer(.flexible)
                        ToolbarItem(placement: .automatic) { toggle }
                    }
            }
            .toolbar {
                // Hidden, the inspector draws nothing, so the list carries the toggle until it is shown again.
                if !shown {
                    ToolbarItem(placement: .automatic) { toggle }
                }
            }
    }

    private var toggle: some View {
        Button { shown.toggle() } label: { Label(shown ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.trailing") }
            .help(shown ? "Hide the inspector (⌥⌘I)" : "Show the inspector (⌥⌘I)")
    }
}

extension View {
    /// The inspector at the right of a list: what is picked (`panel` shows the empty state itself).
    func macInspector<Panel: View>(@ViewBuilder _ panel: @escaping () -> Panel) -> some View {
        modifier(MacInspectorModifier(panel: panel))
    }
}

/// The inspector with nothing picked, or several: "No Order Selected" and what picking one shows, the same words, type
/// and place in every inspector.
struct MacInspectorEmpty: View {
    let title: String
    var detail: String?

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "sidebar.trailing")
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 4)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: A combo box

/// The Mac's combo box (NSComboBox): type, and it completes from the list; its arrow drops the list. For a customer or a
/// karigar by name, where the iPhone shows suggestion rows in the form.
struct MacComboBox: NSViewRepresentable {
    let placeholder: String
    @Binding var text: String
    /// What the list offers, in order ("Sana Demo · 0300 1234567").
    let items: [String]
    /// The person picked one of `items` (by its index).
    var pick: (Int) -> Void

    func makeNSView(context: Context) -> NSComboBox {
        let box = NSComboBox()
        box.placeholderString = placeholder
        box.completes = true
        box.numberOfVisibleItems = 12
        box.usesDataSource = false
        box.delegate = context.coordinator
        box.addItems(withObjectValues: items)
        box.stringValue = text
        return box
    }

    func updateNSView(_ box: NSComboBox, context: Context) {
        context.coordinator.parent = self
        if box.stringValue != text, box.currentEditor() == nil { box.stringValue = text }
        let shown = box.objectValues.compactMap { $0 as? String }
        if shown != items {
            box.removeAllItems()
            box.addItems(withObjectValues: items)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, NSComboBoxDelegate {
        var parent: MacComboBox
        init(_ parent: MacComboBox) { self.parent = parent }

        func controlTextDidChange(_ note: Notification) {
            guard let box = note.object as? NSComboBox else { return }
            parent.text = box.stringValue
        }

        func comboBoxSelectionDidChange(_ note: Notification) {
            guard let box = note.object as? NSComboBox else { return }
            let i = box.indexOfSelectedItem
            if i >= 0 { parent.pick(i) }
        }
    }
}
#endif
