import SwiftUI
import Security
import WidgetKit

/// What the home-screen widget shows and how, shared by the widget (ERPWidget/) and the app,
/// which writes the widget's link and draws a preview of it (WidgetPreviewScreen).
/// The figures come ready to show from the ERP (/api/widget/summary): the widget only lays
/// them out, so a change to what they say needs no new build.

struct ERPSummary: Codable {
    struct Figure: Codable, Hashable {
        let label: String
        let value: String
        let detail: String?
    }
    /// "Taheri", "House of Mina".
    let house: String
    /// When the ERP worked the figures out, as the shop reads a time ("4:05 pm").
    let updated: String
    /// Revenue today and this month first; supporting shop figures follow.
    let figures: [Figure]
    var teamNote: String? = nil
    var asOf: String? = nil

    static let sample = ERPSummary(house: "Taheri", updated: "4:05 pm", figures: [
        Figure(label: "Made today", value: "Rs 3.12 lac", detail: "revenue"),
        Figure(label: "This month", value: "Rs 28.4 lac", detail: "revenue"),
        Figure(label: "Gold 24k", value: "Rs 2.45 lac", detail: "a tola"),
        Figure(label: "Today's cash", value: "Rs 3.12 lac", detail: "in the drawer"),
        Figure(label: "Owed to you", value: "Rs 18.6 lac", detail: "41 customers"),
        Figure(label: "Orders due", value: "6", detail: "2 late"),
    ], teamNote: "Please confirm all collections before closing today.")

    static func sample(house: String) -> ERPSummary {
        ERPSummary(house: house, updated: sample.updated, figures: sample.figures, teamNote: sample.teamNote)
    }
}

/// The widget's way into the ERP: the house's address and a key of its own, kept in a keychain
/// group the app and the widget share. The key reads the widget summary only
/// (/api/widget/summary), and the ERP can forget it.
enum ERPWidgetLink {
    struct Link: Codable {
        let url: String
        let key: String
        let house: String
    }

    private static let service = "erp.widget"
    private static let account = "link"

    /// "<team>.<bundle id>", from Info.plist ERPSharedKeychainGroup; nil when the build has none
    /// (a simulator build signs nothing, so the app's own keychain is used there).
    static var group: String? {
        guard let g = Bundle.main.object(forInfoDictionaryKey: "ERPSharedKeychainGroup") as? String,
              !g.isEmpty, !g.contains("$(") else { return nil }
        return g.hasPrefix(".") ? nil : g
    }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    @discardableResult
    static func save(_ link: Link) -> OSStatus {
        guard let data = try? JSONEncoder().encode(link) else { return errSecParam }
        SecItemDelete(query() as CFDictionary)
        var item = query()
        item[kSecValueData as String] = data
        // The widget refreshes in the background, locked phone included, once it has been unlocked.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil)
    }

    static func load() -> Link? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Link.self, from: data)
    }

    static func clear() {
        SecItemDelete(query() as CFDictionary)
    }
}

/// Which house this build is: the explicit ERPHouse in Info.plist (written from ERP_HOUSE by
/// scripts/house.mjs), as the app's House.id reads it. Never guessed from a name or bundle id.
/// Taheri is the default, as the code's defaults are Taheri's.
enum ERPWidgetHouse {
    static let brand: String = {
        let id = (Bundle.main.object(forInfoDictionaryKey: "ERPHouse") as? String ?? "")
            .trimmingCharacters(in: .whitespaces)
        return id == "mina" ? "mina" : "taheri"
    }()
}

enum ERPWidgetSize {
    case small, medium, large, extraLarge, rectangular, inline
}

/// Marks a view as part of the accent group when the system renders the widget tinted.
extension View {
    @ViewBuilder func erpAccentable(_ on: Bool = true) -> some View {
        if #available(iOS 16.0, *) { self.widgetAccentable(on) } else { self }
    }
}

/// When the figures were worked out; carries the day when they are not today's.
struct ERPFreshness {
    let text: String
    let short: String
    let stale: Bool

    init(_ s: ERPSummary, now: Date = Date()) {
        guard let day = s.asOf else { text = s.updated; short = s.updated; stale = false; return }
        let tz = TimeZone(identifier: "Asia/Karachi")
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.timeZone = tz
        iso.dateFormat = "yyyy-MM-dd"
        if day == iso.string(from: now) { text = s.updated; short = s.updated; stale = false; return }
        var shown = day
        if let d = iso.date(from: day) {
            let out = DateFormatter()
            out.timeZone = tz
            out.setLocalizedDateFormatFromTemplate("d MMM")
            shown = out.string(from: d)
        }
        text = "\(shown) · \(s.updated)"
        short = shown
        stale = true
    }
}

/// The widget's face. `size` is passed in, not read from WidgetKit's environment, so the app can
/// draw the same face for its preview.
struct ERPWidgetFace: View {
    let summary: ERPSummary?
    let size: ERPWidgetSize
    var appName: String = "the ERP app"
    var accented = false
    private var brand: String { ERPWidgetHouse.brand }
    // Hero figures keep their sizes at the default text size and grow with Dynamic Type;
    // lineLimit and minimumScaleFactor keep them inside the widget.
    @ScaledMetric(relativeTo: .largeTitle) private var heroSmall: CGFloat = 26
    @ScaledMetric(relativeTo: .largeTitle) private var heroMedium: CGFloat = 30
    @ScaledMetric(relativeTo: .largeTitle) private var heroLarge: CGFloat = 40
    @ScaledMetric(relativeTo: .largeTitle) private var heroExtraLarge: CGFloat = 44

    // Explicit, because the private metrics would make the memberwise init private.
    init(summary: ERPSummary?, size: ERPWidgetSize, appName: String = "the ERP app", accented: Bool = false) {
        self.summary = summary
        self.size = size
        self.appName = appName
        self.accented = accented
    }
    private var ink: Color { accented ? .primary : Color("Accent-\(brand)") }
    private var note: String? { summary?.teamNote.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } }

    var body: some View {
        if let s = summary, let today = s.figures.first {
            face(s, today)
        } else if size == .inline {
            // An inline accessory is one line of text: no wordmark fits there.
            Text("Open \(appName)")
        } else {
            unlinked
        }
    }

    @ViewBuilder private func face(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        switch size {
        case .inline: inlineFace(today)
        case .rectangular: rectangularFace(s, today)
        case .small: smallFace(s, today)
        case .medium: mediumFace(s, today)
        case .large: largeFace(s, today)
        case .extraLarge: extraLargeFace(s, today)
        }
    }

    // MARK: Accessory

    private func inlineFace(_ today: ERPSummary.Figure) -> some View {
        Text("\(today.label) · \(today.value)").privacySensitive()
    }

    private func rectangularFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(today.label)
                .textCase(.uppercase)
                .font(.caption2.weight(.semibold)).tracking(0.8)
                .lineLimit(1).minimumScaleFactor(0.7).erpAccentable()
            Text(today.value)
                .font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7).privacySensitive()
            if let note {
                Label(note, systemImage: "pin.fill").font(.caption).lineLimit(1)
            } else if s.figures.count > 1 {
                Text("\(s.figures[1].label) · \(s.figures[1].value)")
                    .font(.caption).lineLimit(1).privacySensitive()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Home screen

    private func smallFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(s, compact: true)
            Spacer(minLength: 6)
            hero(today, size: heroSmall)
            month(s, compact: true).padding(.top, 3)
            if let note {
                Spacer(minLength: 8)
                pinned(note, lines: 2, compact: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mediumFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(s)
            Spacer(minLength: 8)
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    hero(today, size: heroMedium)
                    month(s, compact: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let note {
                    hairline(vertical: true)
                    pinned(note, lines: 3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func largeFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(s)
            hero(today, size: heroLarge).padding(.top, 18)
            month(s).padding(.top, 6)
            if let note { pinned(note, lines: 3).padding(.top, 16) }
            Spacer(minLength: 12)
            supporting(s, columns: 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func extraLargeFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(s)
            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 6) { hero(today, size: heroExtraLarge); month(s) }
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let note {
                    hairline(vertical: true)
                    pinned(note, lines: 5).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 18)
            Spacer(minLength: 12)
            supporting(s, columns: 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var unlinked: some View {
        VStack(alignment: .leading, spacing: 8) {
            wordmark(width: 92, height: 24)
            Spacer(minLength: 4)
            Text("Your shop, at a glance").font(.headline).lineLimit(2)
            Text("Open \(appName) and link your widget in Settings.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Pieces

    @ViewBuilder private func wordmark(width: CGFloat, height: CGFloat) -> some View {
        let image = Image("BrandLogo-\(brand)").resizable()
        if #available(iOS 18.0, *) {
            image.widgetAccentedRenderingMode(.accented).scaledToFit()
                .frame(width: width, height: height, alignment: .leading)
        } else {
            image.scaledToFit().frame(width: width, height: height, alignment: .leading)
        }
    }

    private func header(_ s: ERPSummary, compact: Bool = false) -> some View {
        HStack(alignment: .center, spacing: 6) {
            wordmark(width: compact ? 72 : 96, height: compact ? 18 : 24)
                .accessibilityLabel(s.house)
            Spacer(minLength: 4)
            stamp(ERPFreshness(s), compact: compact)
        }
    }

    private func stamp(_ f: ERPFreshness, compact: Bool) -> some View {
        HStack(spacing: 3) {
            if f.stale { Image(systemName: "clock.arrow.circlepath").font(.caption2.weight(.semibold)) }
            Text(compact ? f.short : f.text)
                .font(.caption2.weight(f.stale ? .semibold : .medium))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .foregroundStyle(f.stale ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(f.stale ? "Figures from \(f.text)" : "Updated \(f.text)")
    }

    private func hero(_ f: ERPSummary.Figure, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(f.label)
                .textCase(.uppercase)
                .font(.caption2.weight(.semibold)).tracking(1.2)
                .foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
            Text(f.value)
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .foregroundStyle(ink).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
                .privacySensitive().erpAccentable()
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func month(_ s: ERPSummary, compact: Bool = false) -> some View {
        if s.figures.count > 1 {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(s.figures[1].label).foregroundStyle(.secondary)
                Text(s.figures[1].value).fontWeight(.semibold).monospacedDigit().privacySensitive()
            }
            .font(compact ? .caption : .subheadline)
            .lineLimit(1).minimumScaleFactor(0.75)
            .accessibilityElement(children: .combine)
        }
    }

    private func pinned(_ text: String, lines: Int, compact: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if compact {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "pin.fill").font(.caption2.weight(.semibold))
                        .foregroundStyle(ink).erpAccentable()
                    Text(text).font(.caption.weight(.medium)).lineLimit(lines).minimumScaleFactor(0.8)
                }
            } else {
                Label("Pinned", systemImage: "pin.fill")
                    .textCase(.uppercase)
                    .font(.caption2.weight(.semibold)).tracking(1.1)
                    .foregroundStyle(ink).erpAccentable()
                Text(text).font(.footnote.weight(.medium)).lineLimit(lines).minimumScaleFactor(0.8)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Pinned note: \(text)")
    }

    @ViewBuilder private func hairline(vertical: Bool) -> some View {
        if vertical {
            Rectangle().fill(.primary.opacity(0.14)).frame(width: 1)
        } else {
            Rectangle().fill(.primary.opacity(0.14)).frame(height: 1)
        }
    }

    @ViewBuilder private func supporting(_ s: ERPSummary, columns: Int) -> some View {
        let rest = Array(s.figures.dropFirst(2).enumerated())
        if !rest.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                hairline(vertical: false)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .topLeading), count: columns),
                          alignment: .leading, spacing: 12) {
                    ForEach(rest, id: \.offset) { item in figureCell(item.element) }
                }
            }
        }
    }

    private func figureCell(_ f: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(f.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Text(f.value).font(.system(.subheadline, design: .rounded).weight(.semibold))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.75).privacySensitive()
            if let detail = f.detail, !detail.isEmpty {
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Quiet house paper; personality comes from the wordmark, typography and the shop's note.
struct ERPWidgetPaper: View {
    private var brand: String { ERPWidgetHouse.brand }
    var body: some View {
        Color("Ground-\(brand)").overlay(alignment: .leading) {
            Rectangle().fill(Color("Accent-\(brand)")).frame(width: 4)
        }
    }
}
