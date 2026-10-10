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
@Observable
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()
    private let tokenKey = "erp.pushToken"
    private(set) var registeredOnServer = false
    private(set) var registrationError: String?
    private(set) var registering = false
    private var registrationTask: Task<Void, Never>?
    private var token: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
    }

    /// iOS permission and the ERP's device record are separate; neither implies delivery.
    func register() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        registrationError = nil
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else { return }
            registering = true
            UIApplication.shared.registerForRemoteNotifications()
            if let token { await link(token) }
        } catch { didFail(error) }
    }

    func didRegister(token data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        registrationTask?.cancel()
        registrationTask = Task { await link(hex) }
    }

    private func link(_ hex: String) async {
        do {
            try await ERPAPI.shared.send("/api/push/devices", ["token": hex, "bundleId": Bundle.main.bundleIdentifier ?? "", "label": UIDevice.current.model])
            guard !Task.isCancelled else { return }
            registeredOnServer = true
            registrationError = nil
        } catch {
            guard !Task.isCancelled else { return }
            registeredOnServer = false
            registrationError = error.localizedDescription
        }
        registering = false
    }

    func didFail(_ error: Error) {
        registering = false
        registrationError = error.localizedDescription
    }

    func unregister() async {
        registrationTask?.cancel()
        registrationTask = nil
        if let t = token { _ = try? await ERPAPI.shared.send("/api/push/devices", method: "DELETE", ["token": t]) }
        token = nil
        registeredOnServer = false
        registering = false
        registrationError = nil
    }

    func kindsOff() async throws -> [String] {
        guard let t = token else { throw PushError.notRegistered }
        let d = try await ERPAPI.shared.data("/api/push/devices?token=\(t)")
        guard let j = try JSONSerialization.jsonObject(with: d) as? [String: Any], j["registered"] as? Bool == true else {
            registeredOnServer = false
            throw PushError.notRegistered
        }
        registeredOnServer = true
        return j["off"] as? [String] ?? []
    }

    func setKindsOff(_ off: [String]) async throws {
        guard registeredOnServer, let t = token else { throw PushError.notRegistered }
        try await ERPAPI.shared.send("/api/push/devices", ["token": t, "bundleId": Bundle.main.bundleIdentifier ?? "", "off": off])
    }

    func sendTest() async throws {
        guard registeredOnServer, let token else { throw PushError.notRegistered }
        try await ERPAPI.shared.send("/api/push/test", ["token": token])
    }

    private enum PushError: LocalizedError {
        case notRegistered
        var errorDescription: String? { "This phone isn't linked for notifications yet. Try registering it again." }
    }

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
