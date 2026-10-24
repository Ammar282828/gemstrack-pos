#if os(macOS)
import SwiftUI
import AppKit
import FirebaseCore

/// The ERP as a native Mac app (docs/features/mac-app.md). The same app as the iPhone's (one bundle ID, every business,
/// the same screens from App/), dressed as a Mac app: a sidebar of the ERP's map, a window per invoice, order or
/// customer, a menu bar with the shop's shortcuts, Settings in its own window, today's figures in the menu bar, and tags
/// printed through Label LIVE at the counter.
@main
struct ERPMacApp: App {
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var appDelegate

    init() {
        LaunchClock.armTimeout()
        LaunchClock.mark("app:init")
        _ = Businesses.shared
        Diagnostics.start()
        if Sessions.shared.current.state == .signedIn { AppLock.shared.launched(signedIn: true) }
    }

    var body: some Scene {
        WindowGroup("ERP", id: MacWindows.main) {
            MacBusinessHost()
                .onOpenURL { MacWindows.openLink($0) }
        }
        .defaultSize(width: 1320, height: 860)
        .windowToolbarStyle(.unified)
        .commands { MacCommands() }

        // One invoice, order, customer, piece or repair in a window of its own (File › Open in New Window, a row's
        // context menu, or a double-click in a table), so two can be read side by side.
        WindowGroup("Place", id: MacWindows.place, for: Route.self) { $route in
            MacPlaceWindow(route: route)
        }
        .defaultSize(width: 1000, height: 780)

        SwiftUI.Settings {
            MacSettingsWindow()
        }

        // Today's figures for every business signed in on this Mac, a click away in the menu bar.
        MenuBarExtra {
            MacTodayMenu()
        } label: {
            Label("ERP", systemImage: "diamond")
        }
        .menuBarExtraStyle(.window)
    }
}

final class MacAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // As the iPhone's: the open business's Firebase app now, the others when first used.
        if !House.isDemo { MainActor.assumeIsolated { _ = Businesses.shared.firebaseApp } }
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { Push.shared.didRegister(token: deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MainActor.assumeIsolated { Push.shared.didFail(error) }
    }

    /// Closing the last window leaves the menu-bar figures running; the Dock icon opens a window again.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

/// The open business, as on the iPhone (ERPApp's BusinessHost): its session the environment, everything below rebuilt
/// when the business changes.
struct MacBusinessHost: View {
    @State private var launch = LaunchPicker()

    var body: some View {
        let store = Businesses.shared
        let business = store.current
        MacBusinessRoot(session: Sessions.shared.session(for: business), launch: launch)
            .id(business.id)
            .onAppear { LaunchClock.mark("frame:first") }
            .task {
                try? await Task.sleep(for: .seconds(2))
                await Businesses.shared.refresh()
            }
            .sheet(isPresented: Bindable(store).switcherOpen) {
                NavigationStack { BusinessesScreen(inSheet: true) }
                    .tint(Theme.accent)
                    .frame(minWidth: 520, minHeight: 560)
            }
    }
}

private struct MacBusinessRoot: View {
    let session: Session
    let launch: LaunchPicker
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if launch.mountsApp {
                RootGate()
                    .environment(session)
                    .environment(Book.shared)
                    .accessibilityHidden(lock.locked || launch.showing)
                    .allowsHitTesting(!lock.locked && !launch.showing)
            }
            if launch.showing {
                BusinessPicker(launch: launch)
                    .accessibilityHidden(lock.locked)
                    .allowsHitTesting(!lock.locked)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .modifier(MacLockCover())
        .tint(Theme.accent)
        .outboxToast()
        .environment(\.locale, Locale(identifier: "en_PK"))
        .onChange(of: scenePhase) { _, phase in
            lock.phase(phase, signedIn: session.state == .signedIn)
            if phase == .active, session.state == .signedIn { Outbox.shared.warm(); Outbox.shared.resume() }
        }
        .onChange(of: lock.locked) { _, locked in
            if locked { Businesses.shared.switcherOpen = false }
            if !locked { AppRouter.shared.lockPassed() }
        }
        .onChange(of: session.state) { old, new in
            if new == .signedIn { LaunchClock.mark("session:signedIn", session.role) }
            if old == .starting && new == .signedIn { lock.launched(signedIn: true) }
            if new != .signedIn && lock.locked { lock.signedOut() }
        }
        .onAppear {
            if session.state == .signedIn { LaunchClock.mark("session:signedIn", session.role) }
        }
        .task { if lock.locked, NSApp.isActive { await lock.unlock() } }
    }
}

/// The lock over a window's whole content (Touch ID or the Mac's password). Every window of the app carries it, so a
/// customer's window left open shows nothing either while the app is locked.
struct MacLockCover: ViewModifier {
    @State private var lock = AppLock.shared
    func body(content: Content) -> some View {
        content
            .overlay {
                if lock.locked || lock.covered {
                    LockCover(lock: lock).zIndex(10)
                }
            }
    }
}

/// The app's window ids and the ways into them.
enum MacWindows {
    static let main = "main"
    static let place = "place"

    /// `shoperp://open?b=<business>&p=<path>` (a notification's or the menu-bar figures' tap): that business, that page.
    @MainActor static func openLink(_ url: URL) {
        guard url.scheme == "shoperp", url.host == "open",
              let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let path = q.first { $0.name == "p" }?.value ?? "/"
        let business = q.first { $0.name == "b" }?.value
        AppRouter.shared.route(path: path, business: business)
    }
}
#endif
