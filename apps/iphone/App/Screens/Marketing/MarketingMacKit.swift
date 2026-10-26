#if os(macOS)
import SwiftUI
import AppKit
import Charts

// What the Marketing screens share on the Mac (docs/features/mac-app.md, Mac/MAC-CONVENTIONS.md): the right-click
// line that opens a place in a window of its own, a two-pane window (the list or photos on one side, the record or
// the words on the other), and a copy-to-clipboard line. No logic lives here; every screen keeps its own.

/// "Open in New Window" for a row that opens a Route.
struct MacOpenInWindow: View {
    let path: String
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        if let openPlace {
            Button("Open in New Window", systemImage: "macwindow.badge.plus") { openPlace(Route(path: path)) }
        }
    }
}

/// A pane of up to `sideWidth` beside a flexible one, divided by a hairline: the Mac's form of a phone's two stacked
/// sections. The side gives way before the window grows past a 13-inch screen: it never asks for more than 280 points
/// to fit and the other pane for more than 300, so a window of the two needs 600 at least.
struct MacTwoPane<Side: View, Main: View>: View {
    var sideWidth: CGFloat = 380
    var sideOnRight = false
    @ViewBuilder let side: () -> Side
    @ViewBuilder let main: () -> Main

    private var sideMin: CGFloat { min(sideWidth, 280) }

    var body: some View {
        HStack(spacing: 0) {
            if sideOnRight {
                main().frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                side().frame(minWidth: sideMin, idealWidth: sideWidth, maxWidth: sideWidth).frame(maxHeight: .infinity)
            } else {
                side().frame(minWidth: sideMin, idealWidth: sideWidth, maxWidth: sideWidth).frame(maxHeight: .infinity)
                Divider()
                main().frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

enum MacClipboard {
    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

/// One day's value for a chart the pointer reads.
struct MacHoverPoint: Identifiable {
    let id: String
    let date: Date
    let value: Double
}

/// A Mac reads a chart by pointing at it: a hairline at the nearest day and a small card with its date and figure.
struct MacDayHover: ViewModifier {
    let points: [MacHoverPoint]
    let say: (Double) -> String
    @State private var hovered: MacHoverPoint?

    func body(content: Content) -> some View {
        content.chartOverlay { (proxy: ChartProxy) in
            GeometryReader { (geo: GeometryProxy) in
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .onContinuousHover { (phase: HoverPhase) in
                            switch phase {
                            case .active(let at):
                                guard let frame = proxy.plotFrame else { return }
                                let x = at.x - geo[frame].origin.x
                                guard let date: Date = proxy.value(atX: x) else { return }
                                hovered = points.min { (a: MacHoverPoint, b: MacHoverPoint) in
                                    abs(a.date.timeIntervalSince(date)) < abs(b.date.timeIntervalSince(date))
                                }
                            case .ended:
                                hovered = nil
                            }
                        }
                    if let h = hovered, let frame = proxy.plotFrame, let x = proxy.position(forX: h.date) {
                        let box = geo[frame]
                        Rectangle().fill(Color.secondary.opacity(0.45))
                            .frame(width: 1, height: box.height)
                            .offset(x: box.origin.x + x, y: box.origin.y)
                            .allowsHitTesting(false)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ChartSummary.day(h.date)).font(.caption.weight(.semibold))
                            Text(say(h.value)).font(.caption).monospacedDigit()
                        }
                        .padding(8)
                        .background(Theme.card, in: .rect(cornerRadius: 8, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                        .offset(x: min(max(box.origin.x + x + 8, 0), max(0, geo.size.width - 120)), y: box.origin.y)
                        .allowsHitTesting(false)
                    }
                }
            }
        }
    }
}

/// ⌘ and the scroll wheel (or two fingers on the trackpad) zoom what the pointer is over, as in Preview and Figma; the
/// factor is handed to the screen, which keeps its own zoom limits.
struct MacScrollZoom: ViewModifier {
    let zoom: (Double) -> Void
    @State private var inside = false
    @State private var monitor: Any?

    func body(content: Content) -> some View {
        content
            .onHover { inside = $0 }
            .onAppear {
                guard monitor == nil else { return }
                monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { (event: NSEvent) -> NSEvent? in
                    guard inside, event.modifierFlags.contains(.command) else { return event }
                    let step = event.hasPreciseScrollingDeltas ? 0.01 : 0.06
                    zoom(exp(Double(event.scrollingDeltaY) * step))
                    return nil
                }
            }
            .onDisappear {
                if let monitor { NSEvent.removeMonitor(monitor) }
                monitor = nil
            }
    }
}

extension View {
    func macScrollZoom(_ zoom: @escaping (Double) -> Void) -> some View { modifier(MacScrollZoom(zoom: zoom)) }

    /// Hover read-out for a day chart: `.macDayHover(points) { AdsFormat.compact($0) }`.
    func macDayHover(_ points: [MacHoverPoint], say: @escaping (Double) -> String) -> some View {
        modifier(MacDayHover(points: points, say: say))
    }

    /// A page's reading width on a wide window: centred, no wider than `width`.
    func macReadingWidth(_ width: CGFloat = 760) -> some View {
        frame(maxWidth: width).frame(maxWidth: .infinity)
    }
}

// MARK: The page's own bar at the foot, the attention banner, the chips that wrap

/// A page's own action bar at the foot (Design's Continue, the website's Send, Ad sets' Create): the look of the list's summary
/// bar, one hairline over the page's ground, 44 points high. Before it, each of these was `.bar`, a grey of its own, under
/// pages that stand on the house's ground (owner's snapshots, 2026-10-27).
struct MacPageFooter<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) { content() }
                .padding(.horizontal, 12)
                .frame(height: 44)
        }
        .background(Theme.ground)
    }
}

/// What a page says on the left of its foot (the balance, what is still missing), quiet.
struct MacFooterSummary: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

/// The foot's push button: the title, a symbol or a spinner before it.
struct MacFooterButton: View {
    let action: ActionBar.Action
    var prominent = false

    var body: some View {
        if prominent {
            Button(role: action.role, action: action.action) { label }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .disabled(action.isDisabled || action.isBusy)
        } else {
            Button(role: action.role, action: action.action) { label }
                .controlSize(.regular)
                .disabled(action.isDisabled || action.isBusy)
        }
    }

    private var label: some View {
        HStack(spacing: 6) {
            if action.isBusy {
                ProgressView().controlSize(.small)
            } else if let symbol = action.systemImage {
                Image(systemName: symbol)
            }
            Text(action.title)
        }
        .frame(minWidth: 72)
    }
}

extension View {
    /// The page's one primary action at the foot, in the page's own bar: what it will do on the left, the other actions, then the
    /// primary as the default button (Return) at the right. The Mac's form of `.actionBar`, on the ground.
    func macPageActionBar(primary: ActionBar.Action, secondary: [ActionBar.Action] = [], summary: String? = nil) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            MacPageFooter {
                if let summary, !summary.isEmpty { MacFooterSummary(text: summary) }
                Spacer(minLength: 12)
                ForEach(Array(secondary.enumerated()), id: \.offset) { (_: Int, item: ActionBar.Action) in
                    MacFooterButton(action: item)
                }
                MacFooterButton(action: primary, prominent: true)
            }
        }
    }
}

/// What needs a look, said once at the head of a page: a tinted card in the house's corner, the same on Posts, Ads and the
/// website's tray (it was a rounded box here, a grey full-width bar there).
struct MacBanner<Content: View>: View {
    var tone: Tone = .owed
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(tone.color.opacity(0.12), in: .rect(cornerRadius: Radius.card, style: .continuous))
    }
}

/// Chips (sizes, where a photograph comes from) set one after another and wrapped at the width, left-aligned: an adaptive grid
/// gave each chip a column as wide as the widest, and the short ones stood apart.
struct MacChipFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    private func arrange(width: CGFloat, subviews: Subviews) -> (offsets: [CGPoint], size: CGSize) {
        var offsets: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            offsets.append(CGPoint(x: x, y: y))
            x += size.width
            widest = max(widest, x)
            x += spacing
            lineHeight = max(lineHeight, size.height)
        }
        return (offsets, CGSize(width: widest, height: y + lineHeight))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? CGFloat.infinity
        return arrange(width: width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placed = arrange(width: bounds.width, subviews: subviews)
        for (i, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + placed.offsets[i].x, y: bounds.minY + placed.offsets[i].y),
                          anchor: .topLeading, proposal: .unspecified)
        }
    }
}
#endif
