import SwiftUI
import UserNotifications
import WidgetKit

/// What an owner's phone tells the ERP once signed in, and takes back on signing out: where to
/// send notifications (lib/push on the server), and the home-screen widget's own key.
enum DeviceLinks {
    @MainActor static func afterSignIn() async {
        await Push.shared.register()
        await WidgetLinker.link()
    }

    @MainActor static func beforeSignOut() async {
        await Push.shared.unregister()
        ERPWidgetLink.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Where a tapped notification (or anything else outside a screen) wants to go.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()
    var open: Route?
}

@MainActor
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()
    private let tokenKey = "erp.pushToken"
    private var token: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
    }

    /// Asks once (iOS remembers the answer), then registers with Apple; the token arrives in AppDelegate.
    func register() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        guard (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(token data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task { try? await ERPAPI.shared.send("/api/push/devices", ["token": hex, "bundleId": Bundle.main.bundleIdentifier ?? "", "label": "iPhone"]) }
    }

    func didFail(_ error: Error) { print("[push] not registered:", error.localizedDescription) }

    func unregister() async {
        guard let t = token else { return }
        _ = try? await ERPAPI.shared.send("/api/push/devices", method: "DELETE", ["token": t])
        token = nil
    }

    /// Which kinds this phone gets (Settings, natively): the server keeps the list.
    func kindsOff() async -> [String] {
        guard let t = token, let d = try? await ERPAPI.shared.data("/api/push/devices?token=\(t)"),
              let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [] }
        return j["off"] as? [String] ?? []
    }

    func setKindsOff(_ off: [String]) async throws {
        guard let t = token else { return }
        try await ERPAPI.shared.send("/api/push/devices", ["token": t, "bundleId": Bundle.main.bundleIdentifier ?? "", "off": off])
    }

    var isRegistered: Bool { token != nil }

    // Shown while the app is open too, and a tap opens the page it names.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let url = response.notification.request.content.userInfo["url"] as? String, url.hasPrefix("/") else { return }
        await MainActor.run { AppRouter.shared.open = Route(path: url) }
    }
}

/// The home-screen widget's key (/api/widget/key), in the keychain the widget shares.
enum WidgetLinker {
    @MainActor static func link() async {
        if let l = ERPWidgetLink.load(), l.url == House.serverURL.absoluteString { return }
        guard let r = try? await ERPAPI.shared.send("/api/widget/key", ["label": "iPhone widget"]), let key = r["key"] as? String else { return }
        ERPWidgetLink.save(.init(url: House.serverURL.absoluteString, key: key, house: House.storeName))
        WidgetCenter.shared.reloadAllTimelines()
    }
}
