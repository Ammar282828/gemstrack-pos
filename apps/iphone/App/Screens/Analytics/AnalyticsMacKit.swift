#if os(macOS)
import SwiftUI
import Charts

// The Mac's Analytics: a hover read-out for the charts (the iPhone has none; a pointer is not a finger) and the
// window's own names for the five tabs. Nothing here works out a figure: the charts hand in the rows they draw.

/// Move the pointer along a chart and a line follows it with the day's figure beside it.
struct MacChartReadout: ViewModifier {
    let dates: [Date]
    let text: (Date) -> String
    @State private var hovered: Date?

    func body(content: Content) -> some View {
        content.chartOverlay { (proxy: ChartProxy) in
            GeometryReader { (geo: GeometryProxy) in
                let plot: CGRect = proxy.plotFrame.map { geo[$0] } ?? .zero
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(Color.clear).contentShape(Rectangle())
                        .onContinuousHover { (phase: HoverPhase) in
                            switch phase {
                            case .active(let point):
                                if let at: Date = proxy.value(atX: point.x - plot.minX) {
                                    hovered = dates.min { abs($0.timeIntervalSince(at)) < abs($1.timeIntervalSince(at)) }
                                }
                            case .ended:
                                hovered = nil
                            }
                        }
                    if let h = hovered, let x: CGFloat = proxy.position(forX: h) {
                        Rectangle().fill(Color.secondary.opacity(0.45))
                            .frame(width: 1, height: plot.height)
                            .offset(x: plot.minX + x, y: plot.minY)
                            .allowsHitTesting(false)
                        Text(text(h))
                            .font(.caption.weight(.medium))
                            .monospacedDigit()
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(.regularMaterial, in: .rect(cornerRadius: 6))
                            .fixedSize()
                            .offset(x: min(max(plot.minX, plot.minX + x + 8), max(plot.minX, geo.size.width - 190)), y: plot.minY)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
    }
}

extension View {
    func macChartReadout(dates: [Date], text: @escaping (Date) -> String) -> some View {
        modifier(MacChartReadout(dates: dates, text: text))
    }
}

extension AnaSection {
    /// The five tabs in the toolbar's menu, by the names the web gives them.
    static let macTabs: [(section: AnaSection, name: String, path: String)] = [
        (.overview, "Overview", "/analytics"),
        (.sales, "Sales", "/analytics/sales"),
        (.products, "Products", "/analytics/products"),
        (.customers, "Customers", "/analytics/customers"),
        (.categories, "Categories", "/analytics/categories"),
    ]
}
#endif
