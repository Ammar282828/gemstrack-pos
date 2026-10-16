import AppIntents
import CryptoKit
import WidgetKit
import SwiftUI

/// Revenue today and this month, the shared pinned note and supporting shop figures, from the ERP every half hour
/// (/api/widget/summary, with the key the app keeps for each business in the shared keychain, ERPWidgetLink). One
/// widget, many businesses: the person picks which one in Edit Widget (the first linked business until they do).
/// The faces are Shared/ERPWidgetViews.swift.

struct ERPEntry: TimelineEntry {
    let date: Date
    let summary: ERPSummary?
    /// The business shown; nil when none is linked.
    let link: ERPWidgetLink.Link?
}

// MARK: Which business

/// A linked business, as the Edit Widget sheet lists it.
struct BusinessEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Business")
    static let defaultQuery = BusinessQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    init(_ link: ERPWidgetLink.Link) {
        id = link.id
        name = link.name
    }
}

struct BusinessQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [BusinessEntity] {
        ERPWidgetLink.all().filter { identifiers.contains($0.id) }.map(BusinessEntity.init)
    }

    func suggestedEntities() async throws -> [BusinessEntity] {
        ERPWidgetLink.all().map(BusinessEntity.init)
    }
}

struct SelectBusinessIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Business"
    static let description = IntentDescription("Choose which business this widget shows. The first one you signed in to is shown until you do.")

    @Parameter(title: "Business")
    var business: BusinessEntity?
}

// MARK: Figures

struct ERPProvider: AppIntentTimelineProvider {
    private static let cacheKey = "erp.widget.last."
    private static let cacheOwner = "erp.widget.owner."

    /// The chosen business if it is still linked, else the first linked one.
    private func link(for configuration: SelectBusinessIntent) -> ERPWidgetLink.Link? {
        let all = ERPWidgetLink.all()
        if let id = configuration.business?.id, let chosen = all.first(where: { $0.id == id }) { return chosen }
        return all.first
    }

    func placeholder(in context: Context) -> ERPEntry {
        let first = ERPWidgetLink.all().first
        return ERPEntry(date: Date(), summary: .sample(house: first?.name ?? "ERP"), link: first)
    }

    func snapshot(for configuration: SelectBusinessIntent, in context: Context) async -> ERPEntry {
        let link = link(for: configuration)
        if context.isPreview { return ERPEntry(date: Date(), summary: cached(link) ?? .sample(house: link?.name ?? "ERP"), link: link) }
        return ERPEntry(date: Date(), summary: await fetch(link) ?? cached(link), link: link)
    }

    func timeline(for configuration: SelectBusinessIntent, in context: Context) async -> Timeline<ERPEntry> {
        let link = link(for: configuration)
        let fresh = await fetch(link)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        return Timeline(entries: [ERPEntry(date: Date(), summary: fresh ?? cached(link), link: link)], policy: .after(next))
    }

    private func fetch(_ link: ERPWidgetLink.Link?) async -> ERPSummary? {
        guard let link, let url = URL(string: link.url + "/api/widget/summary"), url.scheme == "https" else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("Widget \(link.key)", forHTTPHeaderField: "Authorization")
        // The figures are kept once, below, and never in the HTTP cache.
        guard let (data, response) = try? await URLSession(configuration: .ephemeral).data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let summary = try? JSONDecoder().decode(ERPSummary.self, from: data) else { return nil }
        // Signed out meanwhile: the figures of a key that was taken back are not kept.
        guard ERPWidgetLink.entry(for: link.id)?.key == link.key else { return nil }
        UserDefaults.standard.set(ownerHash(link), forKey: Self.cacheOwner + link.id)
        UserDefaults.standard.set(data, forKey: Self.cacheKey + link.id)
        return summary
    }

    private func ownerHash(_ link: ERPWidgetLink.Link) -> String {
        SHA256.hash(data: Data((link.url + "|" + link.key).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// The last figures that came through for this business, shown with their own time when the ERP cannot be reached.
    private func cached(_ link: ERPWidgetLink.Link?) -> ERPSummary? {
        guard let link, UserDefaults.standard.string(forKey: Self.cacheOwner + link.id) == ownerHash(link),
              let data = UserDefaults.standard.data(forKey: Self.cacheKey + link.id) else { return nil }
        return try? JSONDecoder().decode(ERPSummary.self, from: data)
    }
}

struct ERPWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: ERPEntry

    private var isAccessory: Bool { size == .rectangular || size == .inline }
    private var look: ERPWidgetLook? { entry.link.map(ERPWidgetLook.init) }

    private var size: ERPWidgetSize {
        switch family {
        case .systemSmall: return .small
        case .systemLarge: return .large
        case .systemExtraLarge: return .extraLarge
        case .accessoryRectangular: return .rectangular
        case .accessoryInline: return .inline
        default: return .medium
        }
    }

    var body: some View {
        ERPWidgetFace(summary: entry.summary, size: size, look: look, accented: renderingMode == .accented)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var background: some View {
        if isAccessory { Color.clear } else { ERPWidgetPaper(look: look) }
    }
}

@main
struct ERPWidget: Widget {
    var body: some WidgetConfiguration {
        // The kind is the one the static widget had, so a widget already on a home screen keeps its place and shows
        // the first linked business until it is edited.
        AppIntentConfiguration(kind: "ERPToday", intent: SelectBusinessIntent.self, provider: ERPProvider()) { entry in
            ERPWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Today at the shop")
        .description("Revenue today and this month, with the shop’s pinned message. Touch and hold, then Edit Widget, to choose the business.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryInline])
    }
}
