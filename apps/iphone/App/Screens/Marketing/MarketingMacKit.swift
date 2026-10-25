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
#endif
