import WidgetKit
import SwiftUI

/// The home-screen and lock-screen widget: the rate, today's cash, what is owed to the shop and
/// the orders due, from the ERP every half hour (/api/widget/summary, with the key the app
/// keeps in the shared keychain, ERPWidgetLink). The faces are Shared/ERPWidgetViews.swift.

struct ERPEntry: TimelineEntry {
    let date: Date
    let summary: ERPSummary?
}

struct ERPProvider: TimelineProvider {
    private let cacheKey = "erp.widget.last"

    func placeholder(in context: Context) -> ERPEntry {
        ERPEntry(date: Date(), summary: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (ERPEntry) -> Void) {
        if context.isPreview { completion(ERPEntry(date: Date(), summary: cached() ?? .sample)); return }
        fetch { completion(ERPEntry(date: Date(), summary: $0 ?? cached())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ERPEntry>) -> Void) {
        fetch { fresh in
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [ERPEntry(date: Date(), summary: fresh ?? cached())], policy: .after(next)))
        }
    }

    private func fetch(_ done: @escaping (ERPSummary?) -> Void) {
        guard let link = ERPWidgetLink.load(), let url = URL(string: link.url + "/api/widget/summary") else { done(nil); return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("Widget \(link.key)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                  let summary = try? JSONDecoder().decode(ERPSummary.self, from: data) else { done(nil); return }
            UserDefaults.standard.set(data, forKey: cacheKey)
            done(summary)
        }.resume()
    }

    /// The last figures that came through, shown with their own time when the ERP cannot be reached.
    private func cached() -> ERPSummary? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(ERPSummary.self, from: data)
    }
}

struct ERPWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ERPEntry

    private var size: ERPWidgetSize {
        switch family {
        case .systemSmall: return .small
        case .accessoryRectangular: return .rectangular
        case .accessoryInline: return .inline
        default: return .medium
        }
    }

    var body: some View {
        let face = ERPWidgetFace(summary: entry.summary, size: size,
                                 appName: Bundle.main.object(forInfoDictionaryKey: "ERPAppName") as? String ?? "the ERP app")
        if #available(iOSApplicationExtension 17.0, *) {
            face.containerBackground(.fill.tertiary, for: .widget)
        } else {
            face.padding()
        }
    }
}

@main
struct ERPWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ERPToday", provider: ERPProvider()) { entry in
            ERPWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Today at the shop")
        .description("The rate, today's cash, what is owed and the orders due.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
