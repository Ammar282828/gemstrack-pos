import SwiftUI

/// The house's colours, as the ERP's own palettes have them (src/app/globals.css, docs/features/two-houses.md):
///
/// - Taheri: its gold on its green-black ground in dark, as the storefront and the ERP's dark theme;
///   in light, a deeper cut of the same gold, so a link or a button's word still reads on white (4.9:1).
/// - House of Mina: its wordmark's maroon in light (`.brand-mina.theme-default`), the catalogue's dusty
///   rose on wine in dark (`.dark .brand-mina`).
///
/// The colours live in the asset catalogue (Accent-<house>, Ground-<house>, Card-<house>) with a light
/// and a dark value each, so they follow the phone's appearance as the ERP does (decision "Light and
/// dark"). Cards and list rows take the house's `--card` (Taheri's teal-black, Mina's wine in dark;
/// white, warm for Mina's cream, in light), never the system's grey; glass takes its tint from the accent.
enum Theme {
    static let accent = Color("Accent-\(House.id)")
    static let ground = Color("Ground-\(House.id)")
    static let card = Color("Card-\(House.id)")
    /// Words on the accent (a filled button): white on the deep light-mode accents, and the house's dark
    /// ground on its light dark-mode gold and rose, as the web's --primary-foreground (white there reads
    /// at under 2.5:1).
    static let onAccent = Color("OnAccent-\(House.id)")
}

/// The same full logo as the ERP, with its original proportions and appearance-specific artwork.
struct HouseLogo: View {
    var body: some View {
        Image("BrandLogo-\(House.id)")
            .resizable()
            .scaledToFit()
            .frame(maxWidth: 256, maxHeight: 72)
            .accessibilityLabel(House.storeName)
    }
}

/// The app's filled button: the system's prominent glass in the house accent, with the words in the
/// colour the accent carries (Theme.onAccent) rather than the system's white.
struct HouseProminentStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) {
            configuration.label.foregroundStyle(Theme.onAccent)
        }
        .buttonStyle(.glassProminent)
    }
}

extension PrimitiveButtonStyle where Self == HouseProminentStyle {
    /// `.buttonStyle(.houseProminent)` wherever a screen would use `.glassProminent`.
    static var houseProminent: HouseProminentStyle { HouseProminentStyle() }
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

/// A list's rows on the house's card colour (apply to each Section, or to the List's content).
struct HouseRows: ViewModifier {
    func body(content: Content) -> some View { content.listRowBackground(Theme.card) }
}

extension View {
    /// Rows on the house's card colour: `Section { … }.houseRows()`.
    func houseRows() -> some View { modifier(HouseRows()) }
}

/// A screen on the house's ground: the list's own background hidden so the ground shows behind its cards.
struct HouseGround: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 56)
            .listSectionSpacing(24)
            .background(Theme.ground.ignoresSafeArea())
    }
}
