import SwiftUI
import Security

/// The widget's way into each business's ERP: one entry per business, in a keychain group the app and the widget
/// share. Each entry is the business's address and a key of its own (/api/widget/key), with the look the widget
/// wears for it, so the widget needs nothing of the app's code to draw Taheri in gold and House of Mina in maroon.
/// The key reads the widget summary only (/api/widget/summary), and the ERP can forget it.
enum ERPWidgetLink {
    struct Side: Codable, Hashable {
        var accent: String
        var ground: String
        var card: String
        var onAccent: String
    }

    struct Palette: Codable, Hashable {
        var light: Side
        var dark: Side
    }

    struct Link: Codable, Hashable, Identifiable {
        /// The business id ("taheri", "mina", or an added business's slug).
        var id: String
        /// What the widget calls it ("Taheri ERP").
        var name: String
        var url: String
        var key: String
        /// The business's colours (hex, light and dark): the look of every business without art in the app.
        var palette: Palette?
        /// The id of the art that ships in the app ("taheri", "mina"): their colours and wordmark come from the
        /// asset catalogue. Nil for an added business, which is drawn from its palette and its name.
        var brand: String?

        init(id: String, name: String, url: String, key: String, palette: Palette? = nil, brand: String? = nil) {
            self.id = id; self.name = name; self.url = url; self.key = key; self.palette = palette; self.brand = brand
        }
    }

    /// What the one-house builds kept: a single link, with the house's name.
    private struct Legacy: Codable {
        let url: String
        let key: String
        let house: String
    }

    private static let service = "erp.widget"
    private static let listAccount = "links"
    private static let legacyAccount = "link"

    /// "<team>.<bundle id>", from Info.plist ERPSharedKeychainGroup; nil when the build has none
    /// (a simulator build signs nothing, so the app's own keychain is used there).
    static var group: String? {
        guard let g = Bundle.main.object(forInfoDictionaryKey: "ERPSharedKeychainGroup") as? String,
              !g.isEmpty, !g.contains("$(") else { return nil }
        return g.hasPrefix(".") ? nil : g
    }

    private static func query(_ account: String) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    private static func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    private static func write(_ data: Data, _ account: String) -> OSStatus {
        SecItemDelete(query(account) as CFDictionary)
        var item = query(account)
        item[kSecValueData as String] = data
        // The widget refreshes in the background, locked phone included, once it has been unlocked.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil)
    }

    /// Every linked business, in the order they were linked. A link from a one-house build is moved into the list
    /// the first time it is read.
    static func all() -> [Link] {
        if let data = read(listAccount), let list = try? JSONDecoder().decode([Link].self, from: data) { return list }
        guard let data = read(legacyAccount), let old = try? JSONDecoder().decode(Legacy.self, from: data) else { return [] }
        let host = URL(string: old.url)?.host ?? ""
        let brand: String? = host.contains("houseofmina") ? "mina" : host.contains("taheri") ? "taheri" : nil
        let link = Link(id: brand ?? host.replacingOccurrences(of: ".", with: "-"), name: old.house, url: old.url, key: old.key, brand: brand)
        store([link])
        SecItemDelete(query(legacyAccount) as CFDictionary)
        return [link]
    }

    static func entry(for id: String) -> Link? { all().first { $0.id == id } }

    private static func store(_ list: [Link]) {
        if list.isEmpty {
            SecItemDelete(query(listAccount) as CFDictionary)
        } else if let data = try? JSONEncoder().encode(list) {
            write(data, listAccount)
        }
    }

    /// Adds the business's link, or replaces the one it has (its place in the list is kept).
    static func save(_ link: Link) {
        var list = all()
        if let i = list.firstIndex(where: { $0.id == link.id }) { list[i] = link } else { list.append(link) }
        store(list)
    }

    /// A business signed out or removed: its link goes, the others stay.
    static func remove(id: String) {
        store(all().filter { $0.id != id })
    }

    static func clear() {
        SecItemDelete(query(listAccount) as CFDictionary)
        SecItemDelete(query(legacyAccount) as CFDictionary)
    }
}

/// How the widget looks for one business: the built-ins' colours are the asset catalogue's (Accent-<brand> ...),
/// any other's are its hex palette, light and dark. Nothing here reads the build's Info.plist: the same widget
/// shows every business the person has linked.
struct ERPWidgetLook {
    let name: String
    let brand: String?
    let palette: ERPWidgetLink.Palette?

    init(_ link: ERPWidgetLink.Link) {
        name = link.name
        brand = link.brand
        palette = link.palette
    }

    private func color(_ asset: String, _ pick: (ERPWidgetLink.Side) -> String) -> Color {
        if let brand { return Color("\(asset)-\(brand)") }
        if let p = palette, let l = UIColor(hex: pick(p.light)), let d = UIColor(hex: pick(p.dark)) {
            return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? d : l })
        }
        return Color("\(asset)-taheri")
    }

    var accent: Color { color("Accent") { $0.accent } }
    var ground: Color { color("Ground") { $0.ground } }

    /// What an unlinked widget wears: Taheri's, the code's defaults.
    static let accentFallback = Color("Accent-taheri")
    static let groundFallback = Color("Ground-taheri")
}

extension UIColor {
    /// "#BE9F76" (the leading # optional); nil for anything else.
    convenience init?(hex: String?) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
