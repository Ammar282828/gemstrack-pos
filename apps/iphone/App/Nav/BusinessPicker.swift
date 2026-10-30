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

/// The cold start's first screen (redone 2026-10-30, then pared back the same day, owner: "so bulky and ugly"): each
/// business is one big airy card carrying only its wordmark (in its own ground, never the open business's `Theme`) and one
/// quiet line under it; the one used last first, one tap opens it. Everything on a card is read locally (the descriptor,
/// the Firebase app if it already exists, the time it was last opened): nothing here waits on the network, and the
/// books of the open business keep loading underneath (`launch.ready`), exactly as before.
struct BusinessPicker: View {
    let launch: LaunchPicker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var entered = false
    @State private var tick = 0
    /// The card that was tapped: it grows and the rest let go while the app takes the screen.
    @State private var chosen: String?

    /// When each business was last opened from here (a plain local stamp, per business: `BizKey` is for the open one).
    private static func stampKey(_ id: String) -> String { "erp.business.lastOpened.\(id)" }

    var body: some View {
        let store = Businesses.shared
        // The business used last first; the rest in the phone's own order.
        let ordered = store.list.filter { $0.id == store.current.id } + store.list.filter { $0.id != store.current.id }
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: pt(24)) {
                    Spacer(minLength: pt(24))
                    VStack(alignment: .leading, spacing: pt(16)) {
                        header
                        ForEach(Array(ordered.enumerated()), id: \.element.id) { (index: Int, b: Business) in
                            let last = b.id == store.current.id
                            let slot = (store.list.firstIndex { $0.id == b.id } ?? index) + 1
                            Button { choose(b) } label: { card(b, last: last, slot: slot) }
                                .buttonStyle(PickerPress())
                                .pointerHover()
                                .scaleEffect(chosen == b.id ? 1.05 : 1)
                                .opacity(chosen != nil && chosen != b.id ? 0 : (entered ? 1 : 0))
                                .offset(y: entered || reduceMotion ? 0 : 18)
                                .animation(reduceMotion ? nil : Motion.enter.delay(Double(index) * 0.07), value: entered)
                                .keyboardShortcut(last ? KeyEquivalent.return : KeyEquivalent(Character(String(min(slot, 9)))),
                                                  modifiers: last ? [] : .command)
                                #if os(macOS)
                                .help("Open \(b.displayName)")
                                #endif
                                .accessibilityLabel("Open \(b.displayName)")
                                .accessibilityValue(accessibilityStatus(b, last: last))
                                .accessibilityHint("Opens this business")
                                .accessibilityIdentifier("picker.\(b.id)")
                        }
                    }
                    .frame(maxWidth: 520)
                    Spacer(minLength: pt(24))
                    footer(store)
                        .opacity(chosen == nil && entered ? 1 : 0)
                        .animation(reduceMotion ? nil : Motion.enter.delay(0.3), value: entered)
                }
                .padding(.horizontal, pt(20))
                .padding(.bottom, pt(20))
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Theme.ground.ignoresSafeArea())
        .selectionFeedback(trigger: tick)
        .onAppear { entered = true }
        .task {
            LaunchClock.mark("picker:shown")
            // Let this frame reach the screen, then build the open business underneath while the person decides.
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(50))
            launch.ready = true
        }
    }

    /// A quiet caption, not a title.
    private var header: some View {
        VStack(alignment: .leading, spacing: pt(2)) {
            Text("Choose a business")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            #if os(macOS)
            Text("Return opens the one you used last, or press \u{2318} and its number.")
                .font(.caption)
                .foregroundStyle(.tertiary)
            #endif
        }
        .padding(.horizontal, pt(4))
        .padding(.bottom, pt(4))
        .opacity(entered ? 1 : 0)
        .animation(reduceMotion ? nil : Motion.enter, value: entered)
    }

    private func footer(_ store: Businesses) -> some View {
        // Adding and managing both live on the Businesses screen (its sheet), which this opens above the picker.
        HStack(spacing: pt(24)) {
            Button { store.switcherOpen = true } label: {
                Label("Add a business", systemImage: "plus").font(.subheadline)
            }
            .accessibilityHint("Opens the list of businesses, where you can add one")
            Button { store.switcherOpen = true } label: {
                Label("Manage", systemImage: "slider.horizontal.3").font(.subheadline)
            }
            .accessibilityHint("Opens Settings, Businesses")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .frame(minHeight: Metrics.tap)
    }

    // MARK: A card

    private func card(_ b: Business, last: Bool, slot: Int) -> some View {
        let side = scheme == .dark ? b.palette.dark : b.palette.light
        let accent = Color(hex: side.accent) ?? Theme.accent
        let fill = Color(hex: side.card) ?? Theme.card
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        let line = status(b, last: last)
        return VStack(alignment: .leading, spacing: 0) {
            PickerWordmark(business: b)
            Spacer(minLength: pt(24))
            HStack(alignment: .lastTextBaseline, spacing: pt(12)) {
                HStack(spacing: 5) {
                    if let icon = line.icon {
                        Image(systemName: icon).imageScale(.small)
                    }
                    Text(line.text).lineLimit(1)
                }
                .font(.footnote)
                .foregroundStyle(line.warn ? Color.orange : Color.secondary)
                Spacer(minLength: 8)
                #if os(macOS)
                if !last && slot <= 9 { Text("\u{2318}\(slot)").font(.footnote.monospacedDigit()).foregroundStyle(.tertiary) }
                #endif
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(pt(24))
        // Big and airy: the height is a floor (Dynamic Type may grow it); a small wordmark above, one quiet line below.
        .frame(maxWidth: .infinity, minHeight: pt(180), alignment: .topLeading)
        .background {
            // The business's own flat card colour. Content, so never glass.
            shape.fill(fill)
                .shadow(color: scheme == .light ? .black.opacity(0.06) : .clear, radius: 6, x: 0, y: 2)
                .overlay {
                    shape.strokeBorder(scheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.04), lineWidth: 0.5)
                }
        }
        .overlay(alignment: .topTrailing) {
            if last {
                Text("Last")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(accent)
                    .padding(.top, pt(24)).padding(.trailing, pt(24))
                    .accessibilityHidden(true)
            }
        }
        .contentShape(shape)
    }

    private struct Status { var text: String; var icon: String?; var warn = false }

    /// One quiet line, from what is already on the phone: who is signed in, else that a sign-in is needed, else when it was
    /// last opened, else its address.
    private func status(_ b: Business, last: Bool) -> Status {
        switch signIn(b) {
        case .email(let e): return Status(text: e, icon: "person.crop.circle")
        case .needed: return Status(text: "Sign-in needed", icon: "person.crop.circle.badge.exclamationmark", warn: true)
        case .unknown:
            if let when = Self.lastOpened(b.id) { return Status(text: when, icon: "clock") }
            return Status(text: b.host, icon: nil)
        }
    }

    private func accessibilityStatus(_ b: Business, last: Bool) -> String {
        var parts: [String] = []
        if last { parts.append("Last opened") }
        let s = status(b, last: last)
        parts.append(s.text)
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
        // root is rebuilt on the new id (BusinessHost), which the picker's state sits above. The chosen card grows and the
        // others let go as the host's transition (a scale and fade; a plain fade under Reduce Motion) carries the app in.
        Motion.run(Motion.travel, reduce: reduceMotion) {
            chosen = b.id
            if b.id != Businesses.shared.current.id { Businesses.shared.switch(to: b.id) }
            launch.dismiss()
        }
    }
}

private struct PickerPress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : Motion.enter, value: configuration.isPressed)
    }
}

/// A business's wordmark as its whole identity on a card: the bundled art for a built-in, else the logo its ERP serves
/// (kept on disk), else its name in the serif display face at the same size.
private struct PickerWordmark: View {
    let business: Business
    @Environment(\.colorScheme) private var scheme
    @State private var fetched: UIImage?

    /// The art's rendered height (the PNGs are cropped to the letters, so this is the visible height): Taheri's 26pt,
    /// Mina's spaced capitals 22pt, so the two read as the same weight.
    private var markHeight: CGFloat { business.art == "mina" ? pt(22) : pt(26) }

    var body: some View {
        Group {
            if let art = business.art {
                Image("BrandLogo-\(art)").resizable().scaledToFit()
            } else if let fetched {
                Image(uiImage: fetched).resizable().scaledToFit()
            } else {
                Text(business.name)
                    .font(.system(size: pt(22), weight: .semibold, design: .serif))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
        .frame(maxWidth: 160, alignment: .leading)
        .frame(height: markHeight, alignment: .leading)
        .task(id: "\(business.id)|\(scheme == .dark)") {
            guard business.art == nil else { return }
            fetched = await BusinessLogos.load(business, dark: scheme == .dark)
        }
        .accessibilityHidden(true)
    }
}
