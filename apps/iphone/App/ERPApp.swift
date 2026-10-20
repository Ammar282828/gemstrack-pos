import SwiftUI
import FirebaseCore

/// The ERP as a native iPhone app (docs/features/iphone-app.md). One app, many businesses: Taheri and House of
/// Mina ship in it, others are added by their ERP's address, and the person switches between them
/// (Config/Businesses.swift). Each business keeps its own sign-in, books and settings.
@main
struct ERPApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // The businesses first (this moves what the one-house builds kept), then the open one's session:
        // opened straight onto the books (Session's cached answer), the lock covers them from the first frame.
        LaunchClock.armTimeout()
        LaunchClock.mark("app:init")
        _ = Businesses.shared
        // Crash and hang reports from MetricKit go to the ERP (app_diagnostics): no personal data in them.
        Diagnostics.start()
        if Sessions.shared.current.state == .signedIn { AppLock.shared.launched(signedIn: true) }
    }

    var body: some Scene {
        WindowGroup {
            BusinessHost()
        }
    }
}

/// Follows the open business: its session is the environment, and the whole screen is rebuilt on its id when the
/// business changes, so every `@State` below it (a tab, a draft in progress, a sheet) starts from nothing.
private struct BusinessHost: View {
    /// The cold start's business picker. Held here, above the `.id` below, so a switch never brings it back.
    @State private var launch = LaunchPicker()

    var body: some View {
        let store = Businesses.shared
        let business = store.current
        BusinessRoot(session: Sessions.shared.session(for: business), launch: launch)
            .id(business.id)
            .onAppear { LaunchClock.mark("frame:first") }
            // The businesses describe themselves again once the launch is under way, not racing its first frame.
            .task {
                try? await Task.sleep(for: .seconds(2))
                await Businesses.shared.refresh()
            }
            // The switcher sits above the screens, not in them: a switch rebuilds those, and the sheet closes itself.
            .sheet(isPresented: Bindable(store).switcherOpen) {
                NavigationStack { BusinessesScreen(inSheet: true) }
                    .tint(Theme.accent)
                    .presentationDetents([.medium, .large])
            }
    }
}

private struct BusinessRoot: View {
    let session: Session
    let launch: LaunchPicker
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            let locked = lock.locked || lock.covered
            // Not built in the picker's first pass: it paints, then the open business's books load beneath it.
            if launch.mountsApp {
                RootGate()
                    .environment(session)
                    .environment(Book.shared)
                    // Behind the cover nothing is reachable: not by touch, not by VoiceOver's swipe.
                    .accessibilityHidden(locked || launch.showing)
                    .allowsHitTesting(!locked && !launch.showing)
            }
            // Above the app, below the lock: Face ID still guards the list of businesses.
            if launch.showing {
                BusinessPicker(launch: launch)
                    .accessibilityHidden(locked)
                    .allowsHitTesting(!locked)
                    .transition(reduceMotion ? .opacity : .scale(scale: 1.06).combined(with: .opacity))
                    .zIndex(1)
            }
            // The cover itself is a window above everything (LockWindow), so a presented sheet or menu is under it too.
        }
        .tint(Theme.accent)
        // Dates the way the shop writes them ("23 Oct 2026"), in the pickers as in ShopDate, whatever the
        // phone's region; the clock stays the phone's own.
        .environment(\.locale, Locale(identifier: "en_PK"))
        .onChange(of: scenePhase) { _, phase in
            lock.phase(phase, signedIn: session.state == .signedIn)
            // The window follows the scene: a move to another scene brings it along.
            LockWindow.shared.update(show: lock.locked || lock.covered)
        }
        .onChange(of: lock.covered) { _, _ in LockWindow.shared.update(show: lock.locked || lock.covered) }
        // The list of businesses names people's emails: it does not stay over the lock.
        .onChange(of: lock.locked) { _, locked in
            if locked { Businesses.shared.switcherOpen = false }
            LockWindow.shared.update(show: lock.locked || lock.covered)
            // A tapped notification waits for the face, then opens.
            if !locked { AppRouter.shared.lockPassed() }
        }
        // A cold start of a signed-in app asks for the face too; a fresh sign-in does not.
        .onChange(of: session.state) { old, new in
            if new == .signedIn { LaunchClock.mark("session:signedIn", session.role) }
            if old == .starting && new == .signedIn { lock.launched(signedIn: true) }
            if new != .signedIn && lock.locked { lock.signedOut() }
        }
        .onAppear {
            if session.state == .signedIn { LaunchClock.mark("session:signedIn", session.role) }
            LockWindow.shared.update(show: lock.locked || lock.covered)
        }
        // The launch's own ask, if the app was not yet in front when the lock went up.
        .task { if lock.locked, UIApplication.shared.applicationState == .active { await lock.unlock() } }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // The open business's Firebase app is made now (Taheri's is the default app, the others are named); any
        // other business's is made when it is first used. Firestore's disk copy is set up with it, per business.
        if !House.isDemo { MainActor.assumeIsolated { _ = Businesses.shared.firebaseApp } }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.didRegister(token: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.shared.didFail(error)
    }
}
