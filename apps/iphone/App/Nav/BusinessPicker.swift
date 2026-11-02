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

/// The cold start's first screen (redone 2026-11-02 after four versions were turned down: a badge-wordmark-name triplicate, a
/// slim list, big airy cards, full-bleed brand bands; owner: "more minimal for choosing businesses, add two cards"). The
/// page is the system's own ground, light or dark as the device is, with one quiet heading. Each business is one card in
/// its own identity colours (the same in light and dark): Taheri's champagne gold wordmark on #0B1414, Mina's maroon on
/// blush #F2E9E4, an added business's name in the serif face on its accent. A card holds only the wordmark (24 pt Taheri,
/// 18 pt MINA; the art is cropped to the letters) and under it one tiny line: who is signed in, or "Sign in". Cards are
/// equal; side by side from 600 pt wide (iPad, Mac), stacked on a phone. The business used last comes first and carries
/// a 6 pt dot; Return opens it, and ⌘ and the card's number open the others. A tap shrinks to 0.97 while pressed, gives
/// one selection haptic, and the app takes the screen. Adding and managing are two small text buttons at the foot.
/// Everything here is read locally (the descriptor, the Firebase app if it already exists, the stamp of the last open):
/// nothing waits on the network, and the books of the open business keep loading underneath (`launch.ready`).
struct BusinessPicker: View {
    let launch: LaunchPicker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false
    @State private var tick = 0
    /// The card that was tapped: the rest fade while the app takes the screen.
    @State private var chosen: String?

    /// When each business was last opened from here (a plain local stamp, per business: `BizKey` is for the open one).
    private static func stampKey(_ id: String) -> String { "erp.business.lastOpened.\(id)" }

    /// From this width the cards sit side by side.
    private static let wide: CGFloat = 600

    var body: some View {
        let store = Businesses.shared
        // The business used last first; the rest in the phone's own order.
        let ordered = store.list.filter { $0.id == store.current.id } + store.list.filter { $0.id != store.current.id }
        GeometryReader { geo in
            let sideBySide = geo.size.width >= Self.wide
            ScrollView {
                VStack(alignment: .leading, spacing: pt(24)) {
                    Text("Choose a business")
                        .font(.title3.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    cards(ordered, store: store, sideBySide: sideBySide)
                    footer(store)
                }
                .frame(maxWidth: sideBySide ? pt(780) : pt(480), alignment: .leading)
                .padding(.horizontal, pt(20))
                .padding(.vertical, pt(32))
                // Centred in the screen's height: two cards at the top left the lower half empty.
                .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .center)
                .opacity(entered ? 1 : 0)
                .animation(reduceMotion ? nil : Motion.enter, value: entered)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Self.ground.ignoresSafeArea())
        .sensoryFeedback(.selection, trigger: tick)
        .onAppear { entered = true }
        .task {
            LaunchClock.mark("picker:shown")
            // Let this frame reach the screen, then build the open business underneath while the person decides.
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(50))
            launch.ready = true
        }
    }

    /// The system's own page colour, light or dark by the device.
    private static var ground: Color {
        #if os(macOS)
        Color(nsColor: .windowBackgroundColor)
        #else
        Color(uiColor: .systemBackground)
        #endif
    }

    private func cards(_ ordered: [Business], store: Businesses, sideBySide: Bool) -> some View {
        let columns = sideBySide
            ? [GridItem(.adaptive(minimum: pt(240), maximum: pt(380)), spacing: pt(16), alignment: .top)]
            : [GridItem(.flexible())]
        return LazyVGrid(columns: columns, spacing: pt(16)) {
            ForEach(Array(ordered.enumerated()), id: \.element.id) { (index: Int, b: Business) in
                card(b, store: store, sideBySide: sideBySide)
                    .opacity(chosen == nil || chosen == b.id ? 1 : 0)
            }
        }
        .motion(chosen)
    }

    // MARK: A card

    private func card(_ b: Business, store: Businesses, sideBySide: Bool) -> some View {
        let last = b.id == store.current.id
        let slot = (store.list.firstIndex { $0.id == b.id } ?? 0) + 1
        let id = Self.identity(b)
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        return Button { choose(b) } label: {
            VStack(spacing: pt(8)) {
                CardWordmark(business: b, ink: id.ink)
                Text(captionText(b))
                    .font(.caption2)
                    .tracking(0.4)
                    .foregroundStyle(id.ink.opacity(0.6))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, pt(20))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(height: sideBySide ? nil : pt(130))
            .aspectRatio(sideBySide ? 1.6 : nil, contentMode: .fit)
            .background(id.ground, in: shape)
            .overlay(alignment: .topTrailing) {
                if last {
                    Circle().fill(id.ink).frame(width: 6, height: 6).padding(pt(14)).accessibilityHidden(true)
                }
            }
            .contentShape(shape)
        }
        .buttonStyle(CardPress())
        .keyboardShortcut(last ? KeyEquivalent.return : KeyEquivalent(Character(String(min(slot, 9)))),
                          modifiers: last ? [] : .command)
        #if os(macOS)
        .help("Open \(b.displayName)")
        #endif
        .accessibilityLabel("Open \(b.displayName)")
        .accessibilityValue(accessibilityStatus(b, last: last))
        .accessibilityHint("Opens this business")
        .accessibilityIdentifier("picker.\(b.id)")
        .allowsHitTesting(chosen == nil)
    }

    /// Adding and managing both live on the Businesses screen (its sheet), which this opens above the picker.
    private func footer(_ store: Businesses) -> some View {
        HStack(spacing: pt(20)) {
            Button("Add a business") { store.switcherOpen = true }
                .accessibilityHint("Opens the list of businesses, where you can add one")
                .accessibilityIdentifier("picker.add")
            Button("Manage") { store.switcherOpen = true }
                .accessibilityLabel("Manage businesses")
                .accessibilityHint("Opens Settings, Businesses")
                .accessibilityIdentifier("picker.manage")
        }
        .buttonStyle(.plain)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(minHeight: Metrics.tap)
        .opacity(chosen == nil ? 1 : 0)
    }

    // MARK: Identity

    /// A card's own colours, constant in light and dark.
    private struct Identity { let ground: Color; let ink: Color }

    private static func identity(_ b: Business) -> Identity {
        switch b.art {
        case "taheri"?:
            return Identity(ground: Color(hex: "0B1414") ?? .black, ink: Color(hex: "D3B47F") ?? .yellow)
        case "mina"?:
            return Identity(ground: Color(hex: "F2E9E4") ?? .white, ink: Color(hex: "380000") ?? .red)
        default:
            // An added business: its accent (the dark side's) as the ground, its name in the colour that sits on that accent.
            let side = b.palette.dark
            return Identity(ground: Color(hex: side.accent) ?? Theme.accent, ink: Color(hex: side.onAccent) ?? .white)
        }
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
        // root is rebuilt on the new id (BusinessHost), which the picker's state sits above. The other cards fade as the
        // host's transition (a scale and fade; a plain fade under Reduce Motion) carries the app in.
        Motion.run(Motion.travel, reduce: reduceMotion) {
            chosen = b.id
            if b.id != Businesses.shared.current.id { Businesses.shared.switch(to: b.id) }
            launch.dismiss()
        }
    }
}

/// Pressed, a card settles to 0.97 on the app's enter curve (none under Reduce Motion).
private struct CardPress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : Motion.enter, value: configuration.isPressed)
    }
}

/// A business's wordmark as a single tint: the bundled art for a built-in (single-colour PNGs, drawn as templates so the
/// card's ink colours them whatever the asset's rendering intent), else the name in the serif display face.
private struct CardWordmark: View {
    let business: Business
    let ink: Color

    /// The art's rendered height (the PNGs are cropped to the letters, so this is the visible height): Taheri 24 pt, the
    /// spaced capitals of M I N A 18 pt, so the two read as the same weight.
    private var markHeight: CGFloat { business.art == "mina" ? pt(18) : pt(24) }

    var body: some View {
        Group {
            if let art = business.art {
                Image("BrandLogo-\(art)")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(ink)
                    .frame(maxWidth: pt(200), maxHeight: markHeight)
            } else {
                Text(business.name)
                    .font(.system(size: pt(22), weight: .semibold, design: .serif))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .accessibilityHidden(true)
    }
}
