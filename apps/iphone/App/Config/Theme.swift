import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The business's colours, as the ERP's own palettes have them (src/app/globals.css, docs/features/two-houses.md):
///
/// - Taheri: champagne gold (#D3B47F) on a near-black green ground (#030606) in dark; in light, a deeper cut of
///   the gold, so a link or a button's word still reads on white (4.9:1), on a warm #ECE8E1 ground.
/// - House of Mina: its wordmark's maroon in light (`.brand-mina.theme-default`) on #F2E9E4, a lifted rose
///   (#EBA9B3) on near-black wine (#090405) in dark (`.dark .brand-mina`).
///
/// Separation (owner, 2026-10-25, decision "Light and dark"): light cards are pure white on a deeper ground
/// and carry a very soft shadow; dark cards are clearly lifted off a near-black ground and carry a 0.5 pt
/// hairline (`houseCard`). Sheets, popovers and rows inside a card are `elevated`.
///
/// The built-ins' colours live in the asset catalogue (Accent-<id>, Ground-<id>, Card-<id>, Elevated-<id>, OnAccent-<id>)
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
    /// A step above the card: a sheet, a popover, a grouped row inside a card.
    static var elevated: Color { Color(nsColor: macElevated) }
    private static let macCard = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.06) : NSColor.controlBackgroundColor
    }
    private static let macElevated = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.10) : NSColor.controlBackgroundColor
    }
    #else
    static var ground: Color { color("Ground") { $0.ground } }
    static var card: Color { color("Card") { $0.card } }
    /// A step above the card: a sheet, a popover, a grouped row inside a card.
    static var elevated: Color { color("Elevated") { $0.elevated ?? $0.card } }
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

/// A card's surface: the house's card colour in the flat 22 pt shape, lifted off the ground by what each mode can
/// carry (light: a very soft shadow, y 1 / blur 3 / black 5%; dark: a 0.5 pt hairline of white at 7%). Content
/// only, never glass, and it never fades or slides on its own: put it on the card, not on a transition.
/// `hairline: false` where the card already has an edge of its own (HeroSheen).
struct HouseCardSurface: ViewModifier {
    var radius: CGFloat
    var hairline = true
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        #if os(macOS)
        // A Mac's group box, as System Settings draws its groups: the content colour and a hairline edge, no shadow.
        content.background {
            shape.fill(Theme.card)
                .overlay {
                    if hairline {
                        shape.strokeBorder(Color(nsColor: .separatorColor), lineWidth: 0.5).allowsHitTesting(false)
                    }
                }
        }
        #else
        content.background {
            shape.fill(Theme.card)
                .shadow(color: scheme == .light ? .black.opacity(0.05) : .clear, radius: 1.5, x: 0, y: 1)
                .overlay {
                    if scheme == .dark && hairline {
                        shape.strokeBorder(.white.opacity(0.07), lineWidth: 0.5).allowsHitTesting(false)
                    }
                }
        }
        #endif
    }
}

extension View {
    /// `.houseCard()` where a view is a card: `Theme.card` in `Radius.card`, with the mode's lift.
    func houseCard(radius: CGFloat = Radius.card, hairline: Bool = true) -> some View {
        modifier(HouseCardSurface(radius: radius, hairline: hairline))
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
