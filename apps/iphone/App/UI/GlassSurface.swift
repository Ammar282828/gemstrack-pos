import SwiftUI

// Liquid Glass on the content layer (owner, 2026-11-03: "for the UI and cards, search and add glassmorphism").
// Until then glass was the control layer only (Apple's HIG). Settings → Appearance → Interface style → Liquid Glass
// (`settings.uiStyle == "glass"`, the shop's, mirrored per business by RootGate into `UIStyle.key`) now also makes the
// cards and the page glass. Standard is untouched: every modifier here falls back to exactly the surface it replaces
// (`houseCard`, `Theme.card`, `Theme.ground`). Reduce Transparency and Increase Contrast get that same solid surface.
// Not on a Mac: its glass stays the window's own controls (Mac/MAC-CONVENTIONS.md).
//
// Two surfaces, by how many there are on screen:
//
// - `.glassCard()`: true Liquid Glass (`.glassEffect`) for the FEW cards of a screen (a hero, a row of figure tiles, a
//   record page's header, an iPad's grid of ~6-12 cards, the business picker's two). Apple's guidance (WWDC25 "Meet
//   Liquid Glass", "Build a SwiftUI app with the new design"; HIG Materials): each glass view samples the content behind
//   it, so glass is for a handful of elements, grouped in one `GlassEffectContainer` so the group is sampled together
//   (`GlassGrid` below), and glass never sits inside glass.
// - `.glassRow()` and `glassRowBackground`: the cheap look for what scrolls by the dozen (List rows, chips).

// MARK: The style, as a view reads it

/// Where the shop's interface style is kept on this device, per business (each business has its own setting, and the
/// first paint of a launch or a switch must not wait for the settings to arrive; the same reason as `erp.lastShopTheme`).
enum UIStyle {
    static var key: String { "erp.uiStyle.\(House.id)" }

    /// RootGate calls this whenever the settings say (or the business changes).
    static func remember(_ style: String?) {
        guard let style else { return }
        UserDefaults.standard.set(style == "glass" ? "glass" : "standard", forKey: key)
    }
}

/// `private var mode = GlassMode()` in a view or modifier. `live` is true only when the shop chose Liquid Glass, this is
/// not a Mac, and the reader has not asked for less transparency or more contrast.
struct GlassMode: DynamicProperty {
    @AppStorage(UIStyle.key) private var style = "standard"
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    init() {}

    var live: Bool {
        #if os(macOS)
        return false
        #else
        return style == "glass" && !reduceTransparency && contrast != .increased
        #endif
    }
}

private struct OnGlassKey: EnvironmentKey { static let defaultValue = false }
private struct InGlassGroupKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// True inside a `GlassGroup`: a group within a group adds no second container.
    var inGlassGroup: Bool {
        get { self[InGlassGroupKey.self] }
        set { self[InGlassGroupKey.self] = newValue }
    }

    /// True inside a glass surface (a glass card, a sheet marked `.onGlassSheet()`): HIG, no glass in glass. A `.glassCard()`
    /// below one draws as a `.glassRow()` instead.
    var onGlass: Bool {
        get { self[OnGlassKey.self] }
        set { self[OnGlassKey.self] = newValue }
    }
}

// MARK: The ground

/// The page behind the cards. Standard: `Theme.ground`, as before. Liquid Glass: the same colour with a soft ambient wash
/// of the house's accent in three large radial gradients, so translucency has something to show on an otherwise flat ground.
/// Drawn once as a Canvas (a radial gradient is soft by itself: no blur pass), never animated, and it does not redraw
/// while a list scrolls over it. Light and dark differ only in strength; the owner's taste is minimal, so it is faint.
struct HouseGroundFill: View {
    private var mode = GlassMode()
    @Environment(\.colorScheme) private var scheme

    init() {}

    var body: some View {
        if mode.live {
            let ground = Theme.ground
            let accent = Theme.accent
            let strength: Double = scheme == .dark ? 0.15 : 0.11
            Canvas { context, size in
                let rect = CGRect(origin: .zero, size: size)
                let reach = max(size.width, size.height)
                context.fill(Path(rect), with: .color(ground))
                // (x, y, radius, share of the strength): top-leading, middle-trailing, bottom-leading.
                let blobs: [(CGFloat, CGFloat, CGFloat, Double)] = [
                    (0.10, 0.04, 0.62, 1.0),
                    (0.95, 0.46, 0.55, 0.7),
                    (0.20, 0.98, 0.58, 0.55),
                ]
                for (x, y, r, share) in blobs {
                    let tint = accent.opacity(strength * share)
                    context.fill(
                        Path(rect),
                        with: .radialGradient(Gradient(colors: [tint, accent.opacity(0)]),
                                              center: CGPoint(x: size.width * x, y: size.height * y),
                                              startRadius: 0, endRadius: reach * r))
                }
            }
            .allowsHitTesting(false)
        } else {
            Theme.ground
        }
    }
}

// MARK: Glass cards (few on screen)

/// A card as true Liquid Glass. `tint` is the accent's share in the glass (the HIG tints only a primary action; a faint
/// house colour on the few big cards is the owner's call, and the hero takes a little more). `interactive` is for a card
/// that is itself the tap target and NOT inside a `.pressable` button (that style already scales and dims it).
struct GlassCardSurface: ViewModifier {
    var radius: CGFloat
    var hairline = true
    var tint: Double = 0.05
    var interactive = false
    private var mode = GlassMode()
    @Environment(\.onGlass) private var onGlass

    init(radius: CGFloat, hairline: Bool = true, tint: Double = 0.05, interactive: Bool = false) {
        self.radius = radius
        self.hairline = hairline
        self.tint = tint
        self.interactive = interactive
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if !mode.live {
            content.houseCard(radius: radius, hairline: hairline)
        } else if onGlass {
            // Inside glass: the cheap look (HIG: no nested glass).
            content.glassRow(radius: radius, hairline: hairline)
        } else {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            let base = Glass.regular.tint(Theme.accent.opacity(tint))
            content
                .environment(\.onGlass, true)
                .glassEffect(interactive ? base.interactive() : base, in: shape)
        }
    }
}

/// The group of glass cards a grid or a row of tiles holds, sampled together in one `GlassEffectContainer` (one pass for
/// the group, not one per card). Standard, Reduce Transparency and a Mac: just the content.
struct GlassGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content
    private var mode = GlassMode()
    @Environment(\.onGlass) private var onGlass
    @Environment(\.inGlassGroup) private var inGroup

    init(@ViewBuilder content: @escaping () -> Content) { self.content = content }

    var body: some View {
        if mode.live && !onGlass && !inGroup {
            // A small spacing: the cards are further apart than this, so they never melt into one another.
            GlassEffectContainer(spacing: pt(2)) { content() }
                .environment(\.inGlassGroup, true)
        } else {
            content()
        }
    }
}

// MARK: Glass rows (scrolling by the dozen)

/// The look of glass without the glass: the house's card colour at 72%, a 0.5 pt specular hairline (bright at the top
/// leading corner, fading across, as the web's pane has) and a 1 pt inner highlight. NO blur and no material, on purpose:
/// a material samples and blurs whatever is behind it on every frame it moves, and a list of dozens of rows scrolling is
/// dozens of those passes (the same cost class as the web's `backdrop-filter` over scrolling content, docs/performance.md,
/// "Proposed" 2). Behind a row there is only the page's static ambient ground (`HouseGroundFill`), so a translucent fill
/// over it reads as the same tint of glass at the price of a plain fill.
/// `radius` nil is a List row (the system clips it to its section, so it draws a top highlight only: a stroke on every
/// row would draw a border between rows); a radius is a free-standing shape (a chip, a card inside a sheet).
struct GlassRowBackground: View {
    var radius: CGFloat?
    var hairline = true
    @Environment(\.colorScheme) private var scheme

    init(radius: CGFloat?, hairline: Bool = true) {
        self.radius = radius
        self.hairline = hairline
    }

    private var specular: LinearGradient {
        let colors: [Color] = scheme == .dark ? [Color.white.opacity(0.30), Color.white.opacity(0.04)]
                                              : [Color.white.opacity(0.95), Color.black.opacity(0.06)]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var inner: Color { Color.white.opacity(scheme == .dark ? 0.04 : 0.45) }

    var body: some View {
        if let radius {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            shape.fill(Theme.card.opacity(0.72))
                .overlay { shape.inset(by: 0.5).strokeBorder(inner, lineWidth: 1).allowsHitTesting(false) }
                .overlay {
                    if hairline { shape.strokeBorder(specular, lineWidth: 0.5).allowsHitTesting(false) }
                }
        } else {
            Rectangle().fill(Theme.card.opacity(0.72))
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(LinearGradient(colors: [Color.white.opacity(scheme == .dark ? 0.22 : 0.9), Color.clear],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(height: 0.5)
                        .allowsHitTesting(false)
                }
        }
    }
}

struct GlassRowSurface: ViewModifier {
    var radius: CGFloat
    var hairline = true
    private var mode = GlassMode()

    init(radius: CGFloat, hairline: Bool = true) {
        self.radius = radius
        self.hairline = hairline
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if mode.live {
            content.background { GlassRowBackground(radius: radius, hairline: hairline) }
        } else {
            content.houseCard(radius: radius, hairline: hairline)
        }
    }
}

/// How a `ledgerCard` is drawn.
enum CardGlass {
    /// Today's flat card in every style.
    case flat
    /// True glass under Liquid Glass (a few cards on a screen).
    case card
    /// The cheap glass look (a card inside a sheet, a chip, a section).
    case row
}

/// What `ledgerCard(glass:)` puts behind a card.
struct CardGlassSurface: ViewModifier {
    var glass: CardGlass

    @ViewBuilder
    func body(content: Content) -> some View {
        switch glass {
        case .flat: content.houseCard()
        case .card: content.glassCard()
        case .row: content.glassRow()
        }
    }
}

extension View {
    /// A card of true Liquid Glass under the Liquid Glass style; the house card otherwise. Few per screen.
    func glassCard(radius: CGFloat = Radius.card, hairline: Bool = true, tint: Double = 0.05,
                   interactive: Bool = false) -> some View {
        modifier(GlassCardSurface(radius: radius, hairline: hairline, tint: tint, interactive: interactive))
    }

    /// The cheap glass look under the Liquid Glass style; the house card otherwise. For what scrolls by the dozen.
    func glassRow(radius: CGFloat = Radius.card, hairline: Bool = true) -> some View {
        modifier(GlassRowSurface(radius: radius, hairline: hairline))
    }

    /// Marks a sheet's content as sitting on glass (a sheet is glass in iOS 26): its cards draw as `.glassRow()`.
    func onGlassSheet() -> some View { environment(\.onGlass, true) }
}
