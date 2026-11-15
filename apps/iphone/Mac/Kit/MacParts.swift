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
/// A floating capsule of Liquid Glass at the foot of the list (2026-11-15, the design audit): a functional element over the
/// content, so glass, the regular variant (text on it; HIG Materials), which blurs what scrolls beneath rather than showing
/// it through the words as the plain translucent bar of 2026-10-27 did. The list's last row comes to rest above it (the
/// inset). Reduce Transparency and Increase Contrast get the system's solid version of the material.
struct MacSummaryBar: View {
    let parts: [String]

    var body: some View {
        let said = parts.filter { !$0.isEmpty }.joined(separator: "  \u{00B7}  ")
        HStack {
            Spacer(minLength: 0)
            if !said.isEmpty {
                Text(said)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .monospacedDigit()
                    .font(.house(.callout))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .frame(height: 30)
                    .glassEffect(.regular, in: .capsule)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
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
                Text(figure.label).font(.house(.callout).weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if figure.open != nil {
                    Image(systemName: "arrow.up.right").font(.house(.caption).weight(.semibold)).foregroundStyle(.tertiary)
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
                .font(.house(.callout))
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
    static let figure = Font.house(size: 24, weight: .semibold)
    static let hero = Font.house(size: 30, weight: .semibold)
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
            Text(f.label).font(.house(.caption)).foregroundStyle(.secondary).lineLimit(1)
            Text(f.value)
                .font(.house(.title3).weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(f.tone?.color ?? Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let detail = f.detail, !detail.isEmpty {
                Text(detail).font(.house(.caption)).foregroundStyle(f.detailTone?.color ?? Color.secondary).lineLimit(1)
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
            Text(title).font(.house(.title3).weight(.semibold)).lineLimit(2).textSelection(.enabled)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.house(.callout)).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if status != nil || headline != nil {
                HStack(alignment: .firstTextBaseline) {
                    if let status { status.font(.house(.callout)) }
                    Spacer(minLength: 8)
                    if let headline {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(headline.label).font(.house(.caption)).foregroundStyle(.secondary)
                            Text(headline.value).font(.house(.title3).weight(.semibold)).monospacedDigit()
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
                Text(title).font(.house(.title2).weight(.semibold)).lineLimit(2).textSelection(.enabled)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).foregroundStyle(.secondary).textSelection(.enabled)
                }
                if let status { status.padding(.top, 2) }
            }
            Spacer(minLength: 16)
            if let headline {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(headline.label).font(.house(.callout)).foregroundStyle(.secondary)
                    Text(headline.value).font(.house(.title).weight(.semibold)).monospacedDigit()
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
                    // The inspector is the window's: Tahoe floats it on Liquid Glass, so nothing paints under its panels
                    // (`macGround` draws nothing in here). It was the page's ground until 2026-11-15, which hid the glass;
                    // every panel is now the same glass, so two places side by side still look like one app.
                    .environment(\.macGrounded, true)
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

// MARK: The page under the glass

/// The Mac's page under its content: the house's ground with its accent's soft wash, drawn on every Mac page so the window's
/// glass (sidebar, toolbar, inspector, the summary capsule) has the house's colour to take up: HIG Branding, "consider
/// moving it into the content layer, where it scrolls beneath the glass and the material picks it up". The same three
/// radial gradients as the iPhone's Liquid Glass ground (`HouseGroundFill`, App/UI/GlassSurface.swift), drawn here whatever
/// the app's glass setting, since a Mac window's glass is the system's; kept apart so the iPhone's file is untouched.
/// One Canvas, never animated, no redraw while a list scrolls over it. Increase Contrast: the plain ground.
struct MacGround: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        if contrast == .increased {
            Theme.ground
        } else {
            let ground = Theme.ground
            let accent = Theme.accent
            let strength: Double = scheme == .dark ? 0.15 : 0.11
            Canvas { (context: inout GraphicsContext, size: CGSize) in
                let rect = CGRect(origin: .zero, size: size)
                let reach = max(size.width, size.height)
                context.fill(Path(rect), with: .color(ground))
                // (x, y, radius, share of the strength): top-leading, middle-trailing, bottom-leading.
                let blobs: [(CGFloat, CGFloat, CGFloat, Double)] = [
                    (0.10, 0.04, 0.62, 1.0),
                    (0.95, 0.46, 0.55, 0.7),
                    (0.20, 0.98, 0.58, 0.55),
                ]
                for (x, y, r, share) in blobs {
                    let tint = accent.opacity(strength * share)
                    context.fill(Path(rect),
                                 with: .radialGradient(Gradient(colors: [tint, accent.opacity(0)]),
                                                       center: CGPoint(x: size.width * x, y: size.height * y),
                                                       startRadius: 0, endRadius: reach * r))
                }
            }
            .allowsHitTesting(false)
        }
    }
}

private struct MacGroundedKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Something under this view already draws: the page's ground (the shell's `MacPageGround`, or an outer `macGround`) or
    /// the inspector's glass. A panel inside paints nothing, so the wash runs on unbroken behind it (a strip that drew its
    /// own would scale the three gradients to itself and show a seam) and the inspector's glass is not hidden.
    var macGrounded: Bool {
        get { self[MacGroundedKey.self] }
        set { self[MacGroundedKey.self] = newValue }
    }
}

struct MacGroundModifier: ViewModifier {
    @Environment(\.macGrounded) private var grounded

    @ViewBuilder
    func body(content: Content) -> some View {
        if grounded {
            content
        } else {
            content
                .environment(\.macGrounded, true)
                .background { MacGround().ignoresSafeArea() }
        }
    }
}

extension View {
    /// A Mac page's ground (MacGround) where nothing under it draws one yet: a record's own window, a panel on its own.
    /// Inside a place (the shell already draws the page) or the inspector (glass) it paints nothing. Every Mac page and
    /// panel uses it in place of a flat `Theme.ground`.
    func macGround() -> some View { modifier(MacGroundModifier()) }
}

// MARK: Undo and Copy (Edit menu)

/// ⌘Z and ⇧⌘Z for the changes a Mac place makes that can simply be put back: an order's status (a menu, a board drag,
/// Mark Ready, Cancel), a piece ticked, a repair's step. Never money: a payment, an invoice or a refund has its own way
/// back (Refund, Cancel Invoice, the delete code), as the HIG asks of an action that can't be reversed by a keystroke.
/// `undo` makes the change back through the same write; made while undoing, it registers the redo itself (UndoManager).
/// The Edit menu says "Undo <name>".
enum MacUndo {
    private final class Target {}
    private static let target = Target()

    static func register(_ manager: UndoManager?, _ name: String, _ undo: @escaping () -> Void) {
        guard let manager else { return }
        manager.registerUndo(withTarget: target) { _ in undo() }
        manager.setActionName(name)
    }
}

extension View {
    /// ⌘C (Edit › Copy) copies the picked rows as lines of text, as Finder copies its items' names: one line a row, ready
    /// to paste into WhatsApp, Mail or Notes. `lines` says each picked row; nothing picked copies nothing.
    func macCopiesSelection(_ selection: Set<String>, _ lines: @escaping (Set<String>) -> [String]) -> some View {
        onCopyCommand {
            let text = lines(selection).joined(separator: "\n")
            return text.isEmpty ? [] : [NSItemProvider(object: text as NSString)]
        }
    }
}

// MARK: Opening a picked row

extension View {
    /// Return opens what is picked in a list, as Finder's and Mail's do. A `List` hands Return to neither its primary
    /// action (`contextMenu(forSelectionType:primaryAction:)`, a `Table`'s only) nor `onKeyPress` (the Mac check,
    /// 2026-10-27: Return opened nothing in any list), so the key is read where AppKit sees it: while the list itself has
    /// the keys (its table is the window's first responder, under this list), Return opens the picked rows.
    func macOpensOnReturn(_ selection: Set<String>, _ open: @escaping (Set<String>) -> Void) -> some View {
        modifier(MacReturnOpens {
            guard !selection.isEmpty else { return false }
            open(selection)
            return true
        })
    }

    /// A double-click on a row opens it, beside the row's own selection (a simultaneous gesture leaves the click
    /// that picks the row to the list).
    func macOpensOnDoubleClick(_ open: @escaping () -> Void) -> some View {
        simultaneousGesture(TapGesture(count: 2).onEnded { open() })
    }
}

/// What Return opens and where the list sits, kept outside SwiftUI's state: the key monitor reads the latest each time.
@MainActor
final class MacReturnBox {
    weak var anchor: NSView?
    var open: (() -> Bool)?
    var monitor: Any?
}

struct MacReturnOpens: ViewModifier {
    let open: () -> Bool
    @State private var box = MacReturnBox()

    func body(content: Content) -> some View {
        let box = self.box
        box.open = open
        return content
            .background(MacAnchorView { box.anchor = $0 })
            .onAppear {
                guard box.monitor == nil else { return }
                box.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { (e: NSEvent) -> NSEvent? in
                    guard e.keyCode == 36 || e.keyCode == 76,
                          e.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty,
                          let anchor = box.anchor, let window = anchor.window, e.window === window else { return e }
                    let responder = window.firstResponder
                    // Nothing in particular has the keys (the window itself): the picked rows are what Return means.
                    if responder === window {
                        return box.open?() == true ? nil : e
                    }
                    // Whatever has the keys, never a field being typed in (its Return is its own).
                    guard let focused = responder as? NSView, !(focused is NSText) else { return e }
                    // What has the keys sits in this list (its table, or a row's own view; not the sidebar, not an
                    // inspector: a row of Stock's took the keys itself, so the table alone was too narrow a test).
                    let area = focused.enclosingScrollView ?? focused
                    let here = anchor.convert(anchor.bounds, to: nil)
                    let there = area.convert(area.bounds, to: nil)
                    guard here.contains(CGPoint(x: there.midX, y: there.midY)), box.open?() == true else { return e }
                    return nil
                }
            }
            .onDisappear {
                if let m = box.monitor { NSEvent.removeMonitor(m) }
                box.monitor = nil
            }
    }
}

/// A plain view behind a SwiftUI view, to find its window and frame from AppKit.
struct MacAnchorView: NSViewRepresentable {
    let found: (NSView) -> Void

    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { found(v) }
        return v
    }

    func updateNSView(_ v: NSView, context: Context) {}
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
                .font(.house(.headline))
                .foregroundStyle(.secondary)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.house(.callout))
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
