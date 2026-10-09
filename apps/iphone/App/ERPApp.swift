import SwiftUI
import FirebaseCore

/// The ERP as a native iPhone app (docs/features/iphone-app.md). One codebase, two houses: the
/// house is chosen at build time (House.xcconfig) and read at run time (Config/House.swift).
@main
struct ERPApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = Session()
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
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
            // A cold start of a signed-in app asks for the face too; a fresh sign-in does not.
            .onChange(of: session.state) { old, new in
                if old == .starting && new == .signedIn { lock.launched(signedIn: true) }
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !House.isDemo, let options = House.firebaseOptions {
            FirebaseApp.configure(options: options)
            FirestoreSource.configure()
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.didRegister(token: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.shared.didFail(error)
    }
}
