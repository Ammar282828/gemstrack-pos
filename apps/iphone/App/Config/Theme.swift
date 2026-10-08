import SwiftUI

/// The house's colours, as the ERP's own palettes have them (src/app/globals.css, docs/features/two-houses.md):
///
/// - Taheri: its gold on its green-black ground in dark, as the storefront and the ERP's dark theme;
///   in light, a deeper cut of the same gold, so a link or a button's word still reads on white (4.9:1).
/// - House of Mina: its wordmark's maroon in light (`.brand-mina.theme-default`), the catalogue's dusty
///   rose on wine in dark (`.dark .brand-mina`).
///
/// The colours live in the asset catalogue (Accent-<house>, Ground-<house>) with a light and a dark
/// value each, so they follow the phone's appearance as the ERP does (decision "Light and dark").
/// Content stays on the system's own cards over the house's ground; glass takes its tint from the accent.
enum Theme {
    static let accent = Color("Accent-\(House.id)")
    static let ground = Color("Ground-\(House.id)")
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

/// A screen on the house's ground: the list's own background hidden so the ground shows behind its cards.
struct HouseGround: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(Theme.ground.ignoresSafeArea())
    }
}
