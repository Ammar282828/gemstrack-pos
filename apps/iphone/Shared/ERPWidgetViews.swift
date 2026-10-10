import SwiftUI
import Security

/// What the home-screen widget shows and how, shared by the widget (ERPWidget/) and the app,
/// which writes the widget's link and draws a preview of it (ERPDevice.swift, widgetPreview).
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

enum ERPWidgetSize {
    case small, medium, large, rectangular, inline
}

/// The widget's face. `size` is passed in, not read from WidgetKit's environment, so the app can
/// draw the same face for its preview.
struct ERPWidgetFace: View {
    let summary: ERPSummary?
    let size: ERPWidgetSize
    /// "Taheri ERP": named in the "open the app" line before the widget is linked.
    var appName: String = "the ERP app"

    var body: some View {
        if let s = summary, !s.figures.isEmpty {
            switch size {
            case .inline:
                Text("\(s.figures[0].label) \(s.figures[0].value)")
            case .rectangular:
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(s.figures.prefix(2)), id: \.self) { f in
                        HStack(spacing: 4) {
                            Text(f.label).font(.caption2).foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                            Text(f.value).font(.caption.weight(.semibold)).monospacedDigit()
                        }
                    }
                    Text(stamp(s)).font(.caption2).foregroundStyle(.secondary)
                }
            case .small:
                VStack(alignment: .leading, spacing: 6) {
                    Text(s.house.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    ForEach(Array(s.figures.prefix(2)), id: \.self) { f in figure(f, big: false, detail: false) }
                    if let note = s.teamNote, !note.isEmpty { pinned(note, lines: 2) }
                    Spacer(minLength: 0)
                    Text(stamp(s)).font(.caption2).foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            case .medium, .large:
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(s.house.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        Text(stamp(s)).font(.caption2).foregroundStyle(.tertiary)
                    }
                    HStack(alignment: .top, spacing: 18) {
                        ForEach(Array(s.figures.prefix(2)), id: \.self) { f in
                            figure(f, big: true, detail: false).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if let note = s.teamNote, !note.isEmpty { pinned(note, lines: size == .large ? 8 : 3) }
                    if size == .large {
                        Divider()
                        LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                                  alignment: .leading, spacing: 12) {
                            ForEach(Array(s.figures.dropFirst(2)), id: \.self) { f in figure(f, big: false) }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        } else {
            switch size {
            case .inline:
                Text("Open \(appName)")
            default:
                VStack(alignment: .leading, spacing: 4) {
                    Text("Today at the shop").font(.caption.weight(.semibold))
                    Text("Open \(appName) once, signed in as an owner.").font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private func pinned(_ note: String, lines: Int) -> some View {
        HStack(alignment: .top, spacing: 5) {
            Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary)
            Text(note).font(.caption).lineLimit(lines).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func stamp(_ summary: ERPSummary) -> String {
        guard let day = summary.asOf else { return summary.updated }
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: "Asia/Karachi")
        formatter.dateFormat = "yyyy-MM-dd"
        return day == formatter.string(from: Date()) ? summary.updated : "\(day) · \(summary.updated)"
    }

    @ViewBuilder
    private func figure(_ f: ERPSummary.Figure, big: Bool, detail: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(f.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Text(f.value)
                .font(big ? .title3.weight(.semibold) : .subheadline.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if detail, let d = f.detail, !d.isEmpty {
                Text(d).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
        }
    }
}
