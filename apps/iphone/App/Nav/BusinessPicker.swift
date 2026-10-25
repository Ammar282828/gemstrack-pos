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
        let ask = UserDefaults.standard.object(forKey: Self.key) as? Bool ?? true
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

struct BusinessPicker: View {
    let launch: LaunchPicker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false
    @State private var tick = 0
    @ScaledMetric(relativeTo: .title3) private var badge: CGFloat = 56

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        let store = Businesses.shared
        ScrollView {
            VStack(alignment: .leading, spacing: pt(14)) {
                Text("Open")
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, pt(48))
                    .padding(.bottom, pt(10))
                ForEach(Array(store.list.enumerated()), id: \.element.id) { index, b in
                    Button { choose(b) } label: { card(b, last: b.id == store.current.id) }
                        .buttonStyle(PickerPress())
                        .opacity(entered ? 1 : 0)
                        .offset(y: entered || reduceMotion ? 0 : 14)
                        .animation(reduceMotion ? nil : Motion.enter.delay(Double(index) * 0.06), value: entered)
                        .accessibilityIdentifier("picker.\(b.id)")
                }
                Button {
                    store.switcherOpen = true
                } label: {
                    Label("Add a business", systemImage: "plus")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: Metrics.tap)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, pt(6))
                .accessibilityHint("Opens the list of businesses, where you can add one")
            }
            .padding(.horizontal, pt(20))
            .padding(.bottom, pt(32))
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
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

    private func card(_ b: Business, last: Bool) -> some View {
        HStack(spacing: pt(16)) {
            BusinessBadge(business: b, size: badge)
            VStack(alignment: .leading, spacing: pt(4)) {
                Text(b.displayName).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                if let email = signedInEmail(b) {
                    Text(email).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if last {
                    Text("Last opened").font(.caption).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .frame(minHeight: 72)
        .ledgerCard(padding: 22)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this business")
    }

    /// Only from a Firebase app that already exists: asking `Businesses.auth(for:)` would make one for a business that is
    /// not open, which is the launch's cost. The open business's was made by the app delegate.
    private func signedInEmail(_ b: Business) -> String? {
        let app = b.id == Businesses.defaultAppBusinessID ? FirebaseApp.app() : FirebaseApp.app(name: Businesses.appName(b))
        guard let app else { return nil }
        return Auth.auth(app: app).currentUser?.email
    }

    private func choose(_ b: Business) {
        tick += 1
        LaunchClock.mark("picked", b.id)
        // One switch, then the picker leaves in the same change: `switch(to:)` resets the books of the one left and the
        // root is rebuilt on the new id (BusinessHost), which the picker's state sits above.
        Motion.run(Motion.travel, reduce: reduceMotion) {
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

#if os(macOS)
extension BusinessPicker {
    /// The Mac's first screen: a centred panel, the businesses as cards two across in a wide window, each with its own
    /// shortcut (⌘1, ⌘2…); Return opens the one that was open last, Esc is not needed (there is nothing to cancel).
    @ViewBuilder
    fileprivate var macBody: some View {
        let store = Businesses.shared
        return ScrollView {
            VStack(spacing: 22) {
                Text("Open")
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 56)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300, maximum: 420), spacing: 16, alignment: .top)], spacing: 16) {
                    ForEach(Array(store.list.enumerated()), id: \.element.id) { (index: Int, b: Business) in
                        let last = b.id == store.current.id
                        Button { choose(b) } label: { macCard(b, last: last, index: index) }
                            .buttonStyle(PickerPress())
                            .pointerHover()
                            .help("Open \(b.displayName)")
                            .keyboardShortcut(last ? KeyEquivalent.return : KeyEquivalent(Character(String(min(index + 1, 9)))),
                                              modifiers: last ? [] : .command)
                            .accessibilityIdentifier("picker.\(b.id)")
                    }
                }
                Button { store.switcherOpen = true } label: {
                    Label("Add a business", systemImage: "plus").font(.subheadline)
                }
                .buttonStyle(.link)
                Text("Press Return to open the one you used last, or ⌘ and its number.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 40)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        .onAppear { entered = true }
        .task {
            LaunchClock.mark("picker:shown")
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(50))
            launch.ready = true
        }
    }

    private func macCard(_ b: Business, last: Bool, index: Int) -> some View {
        HStack(spacing: 16) {
            BusinessBadge(business: b, size: badge)
            VStack(alignment: .leading, spacing: 4) {
                Text(b.displayName).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                if let email = signedInEmail(b) {
                    Text(email).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if last { Text("Last opened").font(.caption).foregroundStyle(.tertiary) }
            }
            Spacer(minLength: 8)
            if !last && index < 9 {
                Text("⌘\(index + 1)").font(.footnote.monospacedDigit()).foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 72)
        .ledgerCard(padding: 22)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this business")
    }
}
#endif
