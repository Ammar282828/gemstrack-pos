import AppIntents
import CryptoKit
import WidgetKit
import SwiftUI

/// Revenue today and this month, the shared pinned note and supporting shop figures, from the ERP every half hour
/// (/api/widget/summary, with the key the app keeps for each business in the shared keychain, ERPWidgetLink). One
/// widget, many businesses: the person picks which one in Edit Widget (the first linked business until they do). With
/// two or more linked, every size shows both by default (owner, 2026-10-17: "Big widget should let me add both
/// business"; 2026-10-24: "the widgets should account for two businesses"): the second is the one chosen in Edit
/// Widget, else the next linked business, and "Show both businesses" turns it off. Small stacks two rows, medium sets
/// two columns, large and extra large stack two medium faces, a rectangular accessory takes a line each; the circular
/// and inline accessories show the first only. Each in its own colours. The faces are Shared/ERPWidgetViews.swift.

struct ERPEntry: TimelineEntry {
    let date: Date
    let summary: ERPSummary?
    /// The business shown; nil when none is linked.
    let link: ERPWidgetLink.Link?
    /// The second business, with its figures; nil for one business (or the circular and inline accessories).
    var second: ERPWidgetLink.Link? = nil
    var secondSummary: ERPSummary? = nil
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
    static let description = IntentDescription("Choose which business this widget shows. The first one you signed in to is shown until you do; with two linked, both are shown.")

    @Parameter(title: "Business")
    var business: BusinessEntity?

    @Parameter(title: "Second business", description: "Shown with the first. The next linked business is used until you choose.")
    var second: BusinessEntity?

    /// On unless turned off; a widget placed before this existed has no stored value and gets true.
    @Parameter(title: "Show both businesses", default: true)
    var showBoth: Bool
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

    /// The second business: the one chosen, if it is still linked and not the first, else the next linked one after
    /// the first (wrapping round). None when "Show both businesses" is off, only one is linked, or the widget is a
    /// circular or inline accessory (one figure, the first business).
    private func second(for configuration: SelectBusinessIntent, after first: ERPWidgetLink.Link?, in context: Context) -> ERPWidgetLink.Link? {
        guard configuration.showBoth, context.family != .accessoryCircular, context.family != .accessoryInline else { return nil }
        let all = ERPWidgetLink.all()
        if let id = configuration.second?.id, id != first?.id, let chosen = all.first(where: { $0.id == id }) { return chosen }
        guard all.count > 1, let first, let i = all.firstIndex(where: { $0.id == first.id }) else { return nil }
        return all[(i + 1) % all.count]
    }

    func placeholder(in context: Context) -> ERPEntry {
        let all = ERPWidgetLink.all()
        let first = all.first
        let other = all.count > 1 ? all[1] : nil
        return ERPEntry(date: Date(), summary: .sample(house: first?.name ?? "ERP"), link: first,
                        second: other, secondSummary: other.map { ERPSummary.sample(house: $0.name) })
    }

    func snapshot(for configuration: SelectBusinessIntent, in context: Context) async -> ERPEntry {
        let link = link(for: configuration)
        let other = second(for: configuration, after: link, in: context)
        if context.isPreview {
            return ERPEntry(date: Date(), summary: cached(link) ?? .sample(house: link?.name ?? "ERP"), link: link,
                            second: other, secondSummary: other.map { cached($0) ?? .sample(house: $0.name) })
        }
        return await entry(link, other)
    }

    func timeline(for configuration: SelectBusinessIntent, in context: Context) async -> Timeline<ERPEntry> {
        let link = link(for: configuration)
        let made = await entry(link, second(for: configuration, after: link, in: context))
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        return Timeline(entries: [made], policy: .after(next))
    }

    /// Both businesses' figures, asked for at once.
    private func entry(_ link: ERPWidgetLink.Link?, _ other: ERPWidgetLink.Link?) async -> ERPEntry {
        async let first = fetch(link)
        async let next = fetch(other)
        let a = await first, b = await next
        return ERPEntry(date: Date(), summary: a ?? cached(link), link: link,
                        second: other, secondSummary: other == nil ? nil : (b ?? cached(other)))
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

    private var isAccessory: Bool { size == .rectangular || size == .inline || size == .circular }
    private var tinted: Bool { renderingMode != .fullColor }
    private var look: ERPWidgetLook? { entry.link.map(ERPWidgetLook.init) }

    private var size: ERPWidgetSize {
        switch family {
        case .systemSmall: return .small
        case .systemLarge: return .large
        case .systemExtraLarge: return .extraLarge
        case .accessoryRectangular: return .rectangular
        case .accessoryCircular: return .circular
        case .accessoryInline: return .inline
        default: return .medium
        }
    }

    var body: some View {
        if let other = entry.second, size != .circular, size != .inline {
            pair(other)
        } else {
            ERPWidgetFace(summary: entry.summary, size: size, look: look, accented: tinted)
                .containerBackground(for: .widget) { background }
        }
    }

    /// Two businesses on one widget, each in its own colours: rows (small), columns (medium), stacked medium faces
    /// (large), lines (rectangular accessory).
    @ViewBuilder private func pair(_ other: ERPWidgetLink.Link) -> some View {
        let otherLook = ERPWidgetLook(other)
        switch size {
        case .small:
            // A small widget has one tap target (widgetURL; a Link is ignored there): the first business.
            VStack(spacing: 0) {
                ERPWidgetFace(summary: entry.summary, size: .smallHalf, look: look, accented: tinted)
                Rectangle().fill(.primary.opacity(0.12)).frame(height: 1).padding(.vertical, 6)
                ERPWidgetFace(summary: entry.secondSummary, size: .smallHalf, look: otherLook, accented: tinted)
            }
            .widgetURL(look?.rootURL)
            .containerBackground(for: .widget) { split(otherLook, stacked: true) }
        case .medium:
            HStack(alignment: .top, spacing: 16) {
                opens(look) { ERPWidgetFace(summary: entry.summary, size: .mediumHalf, look: look, accented: tinted) }
                opens(otherLook) { ERPWidgetFace(summary: entry.secondSummary, size: .mediumHalf, look: otherLook, accented: tinted) }
            }
            .containerBackground(for: .widget) { split(otherLook, stacked: false) }
        case .rectangular:
            VStack(alignment: .leading, spacing: 3) {
                ERPWidgetFace(summary: entry.summary, size: .rectangularLine, look: look, accented: tinted)
                ERPWidgetFace(summary: entry.secondSummary, size: .rectangularLine, look: otherLook, accented: tinted)
            }
            .widgetURL(look?.rootURL)
            .containerBackground(for: .widget) { Color.clear }
        default:
            // Large and extra large: each business a medium face on its own paper.
            VStack(spacing: 0) {
                ERPWidgetFace(summary: entry.summary, size: .medium, look: look, accented: tinted)
                    .frame(maxHeight: .infinity)
                    .padding(.bottom, 12)
                ERPWidgetFace(summary: entry.secondSummary, size: .medium, look: otherLook, accented: tinted)
                    .frame(maxHeight: .infinity)
                    .padding(.top, 12)
            }
            .containerBackground(for: .widget) { split(otherLook, stacked: true) }
        }
    }

    /// A half that opens its business in the app (a Link; widgetURL allows only one).
    @ViewBuilder private func opens<C: View>(_ look: ERPWidgetLook?, @ViewBuilder _ content: () -> C) -> some View {
        if let url = look?.rootURL { Link(destination: url) { content() } } else { content() }
    }

    /// Each business's own paper for its half; tinted and clear home screens take none.
    @ViewBuilder private func split(_ otherLook: ERPWidgetLook, stacked: Bool) -> some View {
        if tinted {
            Color.clear
        } else if stacked {
            VStack(spacing: 0) {
                ERPWidgetPaper(look: look)
                ERPWidgetPaper(look: otherLook)
            }
        } else {
            HStack(spacing: 0) {
                ERPWidgetPaper(look: look)
                ERPWidgetPaper(look: otherLook)
            }
        }
    }

    /// Tinted and clear home screens (accented, vibrant) take no ground of ours.
    @ViewBuilder private var background: some View {
        if isAccessory || tinted { Color.clear } else { ERPWidgetPaper(look: look) }
    }
}

@main
struct ERPWidget: Widget {
    var body: some WidgetConfiguration {
        // The kind is the one the static widget had, so a widget already on a home screen keeps its place and shows
        // the first linked business, with the next one beside or under it, until it is edited.
        AppIntentConfiguration(kind: "ERPToday", intent: SelectBusinessIntent.self, provider: ERPProvider()) { entry in
            ERPWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Today at the shop")
        .description("Revenue today and this month, with the shop’s pinned message. Shows both businesses by default when two are linked; touch and hold, then Edit Widget, to choose which, or to show just one.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}
