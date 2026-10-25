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
        .background(.bar)
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
    var id: String { label }

    init(_ label: String, _ value: String, detail: String? = nil, tone: Tone? = nil, detailTone: Tone? = nil, open: (() -> Void)? = nil) {
        self.label = label
        self.value = value
        self.detail = detail
        self.tone = tone
        self.detailTone = detailTone
        self.open = open
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
                    .inspectorColumnWidth(min: 260, ideal: 300, max: 420)
                    // Declared inside the inspector, the toggle sits above it at the window's trailing edge, as
                    // Xcode's and Keynote's do; declared on the list it lands among the list's own buttons.
                    .toolbar {
                        ToolbarSpacer(.flexible)
                        ToolbarItem(placement: .primaryAction) { toggle }
                    }
            }
            .toolbar {
                // Hidden, the inspector draws nothing, so the list carries the toggle until it is shown again.
                if !shown {
                    ToolbarItem(placement: .primaryAction) { toggle }
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

/// The inspector with nothing picked, or several.
struct MacInspectorEmpty: View {
    let title: String
    var detail: String?

    var body: some View {
        ContentUnavailableView {
            Text(title)
        } description: {
            if let detail { Text(detail) }
        }
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
