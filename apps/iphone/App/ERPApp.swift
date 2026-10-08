import SwiftUI
import FirebaseCore

/// The ERP as a native iPhone app (docs/features/iphone-app.md). One codebase, two houses: the
/// house is chosen at build time (House.xcconfig) and read at run time (Config/House.swift).
@main
struct ERPApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootGate()
                .environment(session)
                .tint(Theme.accent)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !House.isDemo, let options = House.firebaseOptions {
            FirebaseApp.configure(options: options)
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
