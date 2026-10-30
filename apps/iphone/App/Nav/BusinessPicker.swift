import SwiftUI
import Observation
import FirebaseCore
import FirebaseAuth

/// The cold start's first screen when this phone holds two or more businesses: which one to enter (owner, 2026-10-20:
/// "it should boot up and ask me which business I want to enter"). It lives above `BusinessRoot`'s `.id` (in
/// `BusinessHost`) so a switch, which rebuilds everything below, never brings it back; and it sits below the lock cover
/// (BusinessRoot), so Face ID still guards it.
@MainActor
@Observable
final class LaunchPicker {
    /// Settings → Businesses → "Ask which business on opening". Global, not per business.
    static let key = "erp.askBusinessAtLaunch"
    #if os(macOS)
    /// A Mac opens straight into the business last open, as a Mac app reopens where it was (2026-10-25 audit: the
    /// picker before every launch was a second gate after Touch ID); the switch is a click away (the sidebar's chip,
    /// ⇧⌘B), and Settings → Businesses can still ask.
    nonisolated static let askByDefault = false
    /// Asked once per run of the app at most: a second window (File › New Window) opens on the business in front.
    private static var askedThisRun = false
    #else
    nonisolated static let askByDefault = true
    #endif

    /// A choice was made (or there was never one to make).
    private(set) var dismissed: Bool
    /// The picker has painted: the open business's screens may now be built underneath.
    var ready: Bool
    /// The business that was open at launch. Any other being open means a switch happened (a card, the chip, the add
    /// sheet) and the picker has nothing left to ask.
    private let startID: String

    init() {
        let store = Businesses.shared
        startID = store.current.id
        var ask = UserDefaults.standard.object(forKey: Self.key) as? Bool ?? Self.askByDefault
        #if os(macOS)
        if Self.askedThisRun { ask = false }
        Self.askedThisRun = true
        #endif
        let skip = House.isDemo || !ask || store.list.count < 2
        dismissed = skip
        ready = skip
    }

    var showing: Bool {
        let store = Businesses.shared
        return !dismissed && store.current.id == startID && store.list.count > 1
    }

    /// Whether the app itself is built yet: not in the picker's first pass, so the picker paints at once and the books load
    /// while the person decides.
    var mountsApp: Bool { ready || !showing }

    func dismiss() {
        dismissed = true
        ready = true
    }
}

/// The cold start's first screen (redone 2026-10-30 as "brand bands", after three card versions were turned down): no
/// cards and no chrome. The screen is cut into one full-bleed band per business, edge to edge (the colour runs under the
/// status bar and the home indicator; the content keeps to the safe area): two businesses are two equal halves, three or
/// four equal bands, more than four scroll at a quarter of the screen each. A Mac window wider than tall lays them side by
/// side. Each band is the house's own identity, the same in light and dark (this is an identity screen, not a themed
/// page): Taheri's champagne gold wordmark on #0B1414, Mina's maroon on blush #F2E9E4, an added business's name in the
/// serif face on its dark accent. A band holds the wordmark (28 pt Taheri, 22 pt MINA; the art is cropped to the letters),
/// and 10 pt under it one tiny line: who is signed in, or "Sign in". The business used last has a 4 pt dot beside that line
/// and comes first; Return opens it, and ⌘ and the band's number open the others. A tap grows the band over the rest while its words
/// fade (a crossfade under Reduce Motion), with one soft haptic, and the app takes the screen. Adding and managing are
/// two small symbols in the last band's corner. Everything here is read locally (the descriptor, the Firebase app if it
/// already exists, the stamp of the last open): nothing waits on the network, and the books of the open business keep
/// loading underneath (`launch.ready`), exactly as before.
struct BusinessPicker: View {
    let launch: LaunchPicker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false
    @State private var tick = 0
    /// The band that was tapped: it grows and the rest shrink away while the app takes the screen.
    @State private var chosen: String?

    /// When each business was last opened from here (a plain local stamp, per business: `BizKey` is for the open one).
    private static func stampKey(_ id: String) -> String { "erp.business.lastOpened.\(id)" }

    /// The most bands that share the screen; more scroll.
    private static let fit = 4

    var body: some View {
        let store = Businesses.shared
        // The business used last first; the rest in the phone's own order.
        let ordered = store.list.filter { $0.id == store.current.id } + store.list.filter { $0.id != store.current.id }
        let topDark = ordered.first.map { Self.identity($0).isDark } ?? true
        GeometryReader { geo in
            let horizontal = Self.sideBySide(geo.size)
            let along = horizontal ? geo.size.width : geo.size.height
            let each = along / CGFloat(max(1, min(ordered.count, Self.fit)))
            let layout = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            let bands = layout {
                ForEach(Array(ordered.enumerated()), id: \.element.id) { (index: Int, b: Business) in
                    band(b, index: index, count: ordered.count, store: store, geo: geo, horizontal: horizontal,
                         length: chosen == nil ? each : (chosen == b.id ? along : 0))
                }
            }
            Group {
                if ordered.count > Self.fit {
                    ScrollView(horizontal ? .horizontal : .vertical, showsIndicators: false) { bands }
                        .scrollBounceBehavior(.basedOnSize)
                } else {
                    bands
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea()
        // The status bar sits over the top band: light content over a dark one, dark over a light one.
        .preferredColorScheme(topDark ? .dark : .light)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: tick)
        .onAppear { entered = true }
        .task {
            LaunchClock.mark("picker:shown")
            // Let this frame reach the screen, then build the open business underneath while the person decides.
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(50))
            launch.ready = true
        }
    }

    /// A Mac window wider than tall puts the bands side by side; a phone or iPad always stacks them.
    private static func sideBySide(_ size: CGSize) -> Bool {
        #if os(macOS)
        return size.width > size.height
        #else
        return false
        #endif
    }

    // MARK: A band

    private func band(_ b: Business, index: Int, count: Int, store: Businesses, geo: GeometryProxy,
                      horizontal: Bool, length: CGFloat) -> some View {
        let last = b.id == store.current.id
        let slot = (store.list.firstIndex { $0.id == b.id } ?? index) + 1
        let id = Self.identity(b)
        let isFirst = index == 0
        let isEnd = index == count - 1
        let inset = geo.safeAreaInsets
        // Only the edges of the screen the band touches keep to the safe area.
        let pad = EdgeInsets(top: horizontal || isFirst ? inset.top : 0,
                             leading: !horizontal || isFirst ? inset.leading : 0,
                             bottom: horizontal || isEnd ? inset.bottom : 0,
                             trailing: !horizontal || isEnd ? inset.trailing : 0)
        let caption = captionText(b)
        let visible = entered && chosen == nil
        return ZStack(alignment: .bottomTrailing) {
            Button { choose(b) } label: {
                VStack(spacing: pt(10)) {
                    BandWordmark(business: b, ink: id.ink)
                    Text(caption)
                        .font(.caption2)
                        .tracking(0.4)
                        .foregroundStyle(id.ink.opacity(0.55))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .overlay(alignment: .leading) {
                            if last {
                                // Beside the line, not in it, so the line stays centred under the wordmark.
                                Circle().fill(id.ink).frame(width: 4, height: 4).offset(x: -10).accessibilityHidden(true)
                            }
                        }
                }
                .opacity(visible ? 1 : 0)
                .animation(reduceMotion ? nil : Motion.enter.delay(Double(index) * 0.07), value: entered)
                .padding(.horizontal, pt(24))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(pad)
                .background(id.ground)
                .contentShape(Rectangle())
            }
            .buttonStyle(BandPress(tint: id.isDark ? Color.white : Color.black))
            .keyboardShortcut(last ? KeyEquivalent.return : KeyEquivalent(Character(String(min(slot, 9)))),
                              modifiers: last ? [] : .command)
            #if os(macOS)
            .help("Open \(b.displayName)")
            #endif
            .accessibilityLabel("Open \(b.displayName)")
            .accessibilityValue(accessibilityStatus(b, last: last))
            .accessibilityHint("Opens this business")
            .accessibilityIdentifier("picker.\(b.id)")

            if isEnd { footer(store, ink: id.ink, pad: pad).opacity(visible ? 1 : 0) }
        }
        .frame(width: horizontal ? length : nil, height: horizontal ? nil : length)
        .clipped()
        .allowsHitTesting(chosen == nil)
    }

    /// Adding and managing both live on the Businesses screen (its sheet), which this opens above the picker.
    private func footer(_ store: Businesses, ink: Color, pad: EdgeInsets) -> some View {
        HStack(spacing: 0) {
            Button { store.switcherOpen = true } label: {
                Image(systemName: "plus.circle").font(.body).frame(width: Metrics.tap, height: Metrics.tap).contentShape(Rectangle())
            }
            .accessibilityLabel("Add a business")
            .accessibilityHint("Opens the list of businesses, where you can add one")
            .accessibilityIdentifier("picker.add")
            Button { store.switcherOpen = true } label: {
                Image(systemName: "slider.horizontal.3").font(.body).frame(width: Metrics.tap, height: Metrics.tap).contentShape(Rectangle())
            }
            .accessibilityLabel("Manage businesses")
            .accessibilityHint("Opens Settings, Businesses")
            .accessibilityIdentifier("picker.manage")
        }
        .buttonStyle(.plain)
        .foregroundStyle(ink.opacity(0.55))
        .padding(.bottom, pad.bottom + pt(4))
        .padding(.trailing, pad.trailing + pt(8))
    }

    // MARK: Identity

    /// A band's own colours, constant in light and dark.
    private struct Identity { let ground: Color; let ink: Color; let isDark: Bool }

    private static func identity(_ b: Business) -> Identity {
        switch b.art {
        case "taheri"?:
            return Identity(ground: Color(hex: "0B1414") ?? .black, ink: Color(hex: "D3B47F") ?? .yellow, isDark: true)
        case "mina"?:
            return Identity(ground: Color(hex: "F2E9E4") ?? .white, ink: Color(hex: "380000") ?? .red, isDark: false)
        default:
            // An added business: its accent (the dark side's) as the ground, its name in the colour that sits on that accent.
            let side = b.palette.dark
            let dark = (luminance(side.accent) ?? 0) < 0.5
            return Identity(ground: Color(hex: side.accent) ?? Theme.accent, ink: Color(hex: side.onAccent) ?? .white, isDark: dark)
        }
    }

    /// Relative brightness (0...1) of a "RRGGBB" colour, or nil if it is not one.
    private static func luminance(_ hex: String) -> Double? {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard s.count >= 6, let v = UInt64(s.prefix(6), radix: 16) else { return nil }
        let r = Double((v >> 16) & 0xFF) / 255, g = Double((v >> 8) & 0xFF) / 255, b = Double(v & 0xFF) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    // MARK: The line under the wordmark

    /// One quiet line, from what is already on the phone: who is signed in, else that a sign-in is needed, else its address.
    private func captionText(_ b: Business) -> String {
        switch signIn(b) {
        case .email(let e): return e
        case .needed: return "Sign in"
        case .unknown: return b.host
        }
    }

    private func accessibilityStatus(_ b: Business, last: Bool) -> String {
        var parts: [String] = []
        if last { parts.append("Last opened") }
        parts.append(captionText(b))
        if case .email = signIn(b), let when = Self.lastOpened(b.id) { parts.append(when) }
        return parts.joined(separator: ", ")
    }

    private enum SignIn { case email(String), needed, unknown }

    /// Only from a Firebase app that already exists: asking `Businesses.auth(for:)` would make one for a business that is
    /// not open, which is the launch's cost. The open business's was made by the app delegate. A business whose app is not
    /// made yet is `unknown`, not "needed".
    private func signIn(_ b: Business) -> SignIn {
        let app = b.id == Businesses.defaultAppBusinessID ? FirebaseApp.app() : FirebaseApp.app(name: Businesses.appName(b))
        guard let app else { return .unknown }
        if let email = Auth.auth(app: app).currentUser?.email { return .email(email) }
        return .needed
    }

    private static func lastOpened(_ id: String) -> String? {
        let t = UserDefaults.standard.double(forKey: stampKey(id))
        guard t > 0 else { return nil }
        let date = Date(timeIntervalSince1970: t)
        if Date().timeIntervalSince(date) < 60 { return "Opened just now" }
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "en_PK")
        f.unitsStyle = .short
        return "Opened " + f.localizedString(for: date, relativeTo: Date())
    }

    private func choose(_ b: Business) {
        guard chosen == nil else { return }
        tick += 1
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.stampKey(b.id))
        LaunchClock.mark("picked", b.id)
        // One switch, then the picker leaves in the same change: `switch(to:)` resets the books of the one left and the
        // root is rebuilt on the new id (BusinessHost), which the picker's state sits above. The chosen band grows over the
        // others as the host's transition (a scale and fade; a plain fade under Reduce Motion) carries the app in.
        Motion.run(Motion.travel, reduce: reduceMotion) {
            chosen = b.id
            if b.id != Businesses.shared.current.id { Businesses.shared.switch(to: b.id) }
            launch.dismiss()
        }
    }
}

/// Pressed, a band brightens (over a dark ground) or dims (over a light one) by 4%.
private struct BandPress: ButtonStyle {
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay { tint.opacity(configuration.isPressed ? 0.04 : 0).allowsHitTesting(false) }
            .animation(reduceMotion ? nil : Motion.enter, value: configuration.isPressed)
    }
}

/// A business's wordmark as a single tint: the bundled art for a built-in (single-colour PNGs, drawn as templates so the
/// band's ink colours them whatever the asset's rendering intent), else the name in the serif display face.
private struct BandWordmark: View {
    let business: Business
    let ink: Color

    /// The art's rendered height (the PNGs are cropped to the letters, so this is the visible height): Taheri 28 pt, the
    /// spaced capitals of M I N A 22 pt, so the two read as the same weight.
    private var markHeight: CGFloat { business.art == "mina" ? pt(22) : pt(28) }

    var body: some View {
        Group {
            if let art = business.art {
                Image("BrandLogo-\(art)")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(ink)
                    .frame(maxWidth: pt(240), maxHeight: markHeight)
            } else {
                Text(business.name)
                    .font(.system(size: pt(26), weight: .semibold, design: .serif))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
        .accessibilityHidden(true)
    }
}
