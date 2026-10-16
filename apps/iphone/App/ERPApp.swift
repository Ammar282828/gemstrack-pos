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
        _ = Businesses.shared
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
    var body: some View {
        let store = Businesses.shared
        let business = store.current
        BusinessRoot(session: Sessions.shared.session(for: business))
            .id(business.id)
            .task { await Businesses.shared.refresh() }
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
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            RootGate()
                .environment(session)
                .environment(Book.shared)
            if lock.locked || lock.covered { LockCover(lock: lock) }
        }
        .tint(Theme.accent)
        // Dates the way the shop writes them ("23 Oct 2026"), in the pickers as in ShopDate, whatever the
        // phone's region; the clock stays the phone's own.
        .environment(\.locale, Locale(identifier: "en_PK"))
        .animation(.easeOut(duration: 0.2), value: lock.locked || lock.covered)
        .onChange(of: scenePhase) { _, phase in lock.phase(phase, signedIn: session.state == .signedIn) }
        // The list of businesses names people's emails: it does not stay over the lock.
        .onChange(of: lock.locked) { _, locked in if locked { Businesses.shared.switcherOpen = false } }
        // A cold start of a signed-in app asks for the face too; a fresh sign-in does not.
        .onChange(of: session.state) { old, new in
            if old == .starting && new == .signedIn { lock.launched(signedIn: true) }
            if new != .signedIn && lock.locked { lock.signedOut() }
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
