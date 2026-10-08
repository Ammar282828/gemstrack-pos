import SwiftUI

/// The house's colours: its accent on controls (Liquid Glass tints with it), its ground for the
/// launch and sign-in screens. Content stays on the system's own backgrounds, light or dark.
enum Theme {
    static let accent = Color(hex: Bundle.main.object(forInfoDictionaryKey: "ERPAccent") as? String) ?? .accentColor
    static let ground = Color(hex: Bundle.main.object(forInfoDictionaryKey: "ERPGround") as? String) ?? Color(.systemBackground)
}

extension Color {
    /// "#BE9F76"; nil for anything else.
    init?(hex: String?) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
