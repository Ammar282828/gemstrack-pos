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

/// The cold start's first screen (redone 2026-10-30, owner: "Redo the initial business selection page"): each business is
/// one large card wearing its own identity (mark, wordmark, ground and accent from its palette, never the open
/// business's `Theme`), the one used last first, one tap opens it. Everything on a card is read locally (the descriptor,
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
    @ScaledMetric(relativeTo: .title3) private var badge: CGFloat = 52

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
                    header
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300, maximum: 440), spacing: pt(16), alignment: .top)],
                              spacing: pt(16)) {
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
                    Spacer(minLength: pt(24))
                    footer(store)
                        .opacity(chosen == nil && entered ? 1 : 0)
                        .animation(reduceMotion ? nil : Motion.enter.delay(0.3), value: entered)
                }
                .padding(.horizontal, pt(20))
                .padding(.bottom, pt(20))
                .frame(maxWidth: 900)
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

    private var header: some View {
        VStack(spacing: pt(6)) {
            Text("Choose a business")
                .font(.system(.largeTitle, design: .serif).weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            #if os(macOS)
            Text("Return opens the one you used last, or press \u{2318} and its number.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
            #endif
        }
        .opacity(entered ? 1 : 0)
        .offset(y: entered || reduceMotion ? 0 : 10)
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
        return VStack(alignment: .leading, spacing: pt(18)) {
            HStack(alignment: .top) {
                BusinessBadge(business: b, size: badge)
                Spacer(minLength: 8)
                if last {
                    Text("Last opened")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(accent)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(accent.opacity(0.14), in: Capsule())
                }
            }
            BusinessLogo(business: b)
            HStack(alignment: .bottom, spacing: pt(12)) {
                VStack(alignment: .leading, spacing: pt(4)) {
                    Text(b.displayName).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                    HStack(spacing: 6) {
                        if let icon = line.icon {
                            Image(systemName: icon).foregroundStyle(line.warn ? Color.orange : Color.secondary)
                        }
                        Text(line.text)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                #if os(macOS)
                if !last && slot <= 9 { Text("\u{2318}\(slot)").font(.footnote.monospacedDigit()).foregroundStyle(.tertiary) }
                #endif
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(accent)
                    .frame(width: 36, height: 36)
                    .background(accent.opacity(0.14), in: Circle())
            }
        }
        .padding(pt(22))
        .frame(maxWidth: .infinity, minHeight: pt(190), alignment: .leading)
        .background {
            // The business's own card, in its own colours; a wash of its accent from the corner. Content, so never glass.
            shape.fill(fill)
                .overlay(alignment: .topTrailing) {
                    RadialGradient(colors: [accent.opacity(scheme == .dark ? 0.22 : 0.13), .clear],
                                   center: .topTrailing, startRadius: 0, endRadius: 280)
                        .clipShape(shape)
                }
                .shadow(color: scheme == .light ? .black.opacity(0.06) : .clear, radius: 6, x: 0, y: 2)
                .overlay {
                    shape.strokeBorder(scheme == .dark ? Color.white.opacity(0.08) : accent.opacity(0.18), lineWidth: 0.5)
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
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : Motion.enter, value: configuration.isPressed)
    }
}
