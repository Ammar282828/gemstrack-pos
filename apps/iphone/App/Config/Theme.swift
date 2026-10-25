import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The business's colours, as the ERP's own palettes have them (src/app/globals.css, docs/features/two-houses.md):
///
/// - Taheri: its gold on its green-black ground in dark, as the storefront and the ERP's dark theme;
///   in light, a deeper cut of the same gold, so a link or a button's word still reads on white (4.9:1).
/// - House of Mina: its wordmark's maroon in light (`.brand-mina.theme-default`), the catalogue's dusty
///   rose on wine in dark (`.dark .brand-mina`).
///
/// The built-ins' colours live in the asset catalogue (Accent-<id>, Ground-<id>, Card-<id>, OnAccent-<id>)
/// with a light and a dark value each; any other business's come from its palette (`/api/app/business`,
/// STORE_PALETTE) as the same pair, which follows the phone's appearance as the ERP does (decision "Light and
/// dark"). Cards and list rows take the business's `--card`, never the system's grey; glass takes its tint
/// from the accent.
///
/// Computed on every read, never kept: the business changes at run time (Businesses.switch), and the root view
/// is rebuilt on it.
enum Theme {
    static var accent: Color { color("Accent") { $0.accent } }
    #if os(macOS)
    // A classic Mac application (owner, 2026-10-25: "operate as a classic native mac os application"): the window's own
    // background and the system's content colour, light or dark as the Mac is; the house is in the accent, as Mail
    // and Finder carry the system's.
    static var ground: Color { Color(nsColor: .windowBackgroundColor) }
    static var card: Color { Color(nsColor: macCard) }
    private static let macCard = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.06) : NSColor.controlBackgroundColor
    }
    #else
    static var ground: Color { color("Ground") { $0.ground } }
    static var card: Color { color("Card") { $0.card } }
    #endif
    /// Words on the accent (a filled button): white on the deep light-mode accents, and the house's dark
    /// ground on its light dark-mode gold and rose, as the web's --primary-foreground (white there reads
    /// at under 2.5:1).
    static var onAccent: Color { color("OnAccent") { $0.onAccent } }

    private static func color(_ asset: String, _ pick: @escaping @Sendable (Business.Side) -> String) -> Color {
        let b = House.business
        if let art = b.art { return Color("\(asset)-\(art)") }
        return Color(uiColor: b.palette.dynamic(pick))
    }
}

/// The same full logo as the ERP, with its original proportions and appearance-specific artwork. The built-ins
/// use the bundled BrandLogo-<id>; another business's is fetched from its ERP once and kept on disk, and its
/// name stands in until it arrives.
struct HouseLogo: View {
    @Environment(\.colorScheme) private var scheme
    @State private var fetched: UIImage?

    var body: some View {
        let b = House.business
        Group {
            if let art = b.art {
                Image("BrandLogo-\(art)").resizable().scaledToFit()
            } else if let fetched {
                Image(uiImage: fetched).resizable().scaledToFit()
            } else {
                Text(b.name).font(.largeTitle.weight(.semibold)).foregroundStyle(Theme.accent).minimumScaleFactor(0.5).lineLimit(1)
            }
        }
        .frame(maxWidth: 256, maxHeight: 72)
        .accessibilityLabel(House.storeName)
        .task(id: "\(b.id)|\(scheme == .dark)") {
            guard b.art == nil else { return }
            fetched = await BusinessLogos.load(b, dark: scheme == .dark)
        }
    }
}

/// The app's filled button: the system's prominent glass in the house accent, with the words in the
/// colour the accent carries (Theme.onAccent) rather than the system's white.
struct HouseProminentStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) {
            configuration.label.foregroundStyle(Theme.onAccent)
        }
        #if os(macOS)
        // On a Mac glass is for the window's own controls (toolbar, sidebar); a button in the page is a push button,
        // the default one filled with the accent.
        .buttonStyle(.borderedProminent)
        .tint(Theme.accent)
        #else
        .buttonStyle(.glassProminent)
        #endif
    }
}

/// `.buttonStyle(.houseGlass)`: the phone's glass button; a Mac's ordinary bordered push button.
struct HouseGlassStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) { configuration.label }
        #if os(macOS)
            .buttonStyle(.bordered)
        #else
            .buttonStyle(.glass)
        #endif
    }
}

/// `.buttonStyle(.houseGlassProminent)`: the phone's prominent glass; a Mac's filled push button.
struct HouseGlassProminentStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role, action: configuration.trigger) { configuration.label }
        #if os(macOS)
            .buttonStyle(.borderedProminent)
        #else
            .buttonStyle(.glassProminent)
        #endif
    }
}

extension PrimitiveButtonStyle where Self == HouseGlassStyle {
    static var houseGlass: HouseGlassStyle { HouseGlassStyle() }
}

extension PrimitiveButtonStyle where Self == HouseGlassProminentStyle {
    static var houseGlassProminent: HouseGlassProminentStyle { HouseGlassProminentStyle() }
}

extension View {
    /// The phone's large control (a thumb's); a Mac's regular one, as every Mac window sizes its buttons.
    @ViewBuilder
    func largeOnPhone() -> some View {
        #if os(macOS)
        self
        #else
        controlSize(.large)
        #endif
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
    func body(content: Content) -> some View {
        #if os(macOS)
        // A Mac's list draws its own rows (and their selection); a colour behind each row would hide both.
        content
        #else
        content.listRowBackground(Theme.card)
        #endif
    }
}

extension View {
    /// Rows on the house's card colour: `Section { … }.houseRows()`.
    func houseRows() -> some View { modifier(HouseRows()) }
}

extension View {
    /// A sheet's Form on the house's ground, as the sale and order workspaces have it: `Form { … }.houseForm()`.
    @ViewBuilder
    func houseForm() -> some View {
        #if os(macOS)
        // A Mac's grouped form (System Settings' look, its own background), at a width a form reads at, and a sheet at
        // least that size.
        self.formStyle(.grouped)
            .frame(minWidth: 520, idealWidth: 640, minHeight: 420, idealHeight: 620)
        #else
        self.scrollContentBackground(.hidden).background(Theme.ground)
        #endif
    }
}

/// A screen on the house's ground: the list's own background hidden so the ground shows behind its cards.
struct HouseGround: ViewModifier {
    #if os(macOS)
    /// A Mac's list row (Mail's, Finder's): the row's words decide, not a finger.
    private static let rowHeight: CGFloat = 28
    #else
    private static let rowHeight: CGFloat = 56
    #endif
    func body(content: Content) -> some View {
        #if os(macOS)
        // A Mac's list or form keeps the system's own background.
        content
            .environment(\.defaultMinListRowHeight, Self.rowHeight)
        #else
        content
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, Self.rowHeight)
            .sectionSpacing24()
            .background(Theme.ground.ignoresSafeArea())
        #endif
    }
}
