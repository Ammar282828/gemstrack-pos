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

    /// Never waits more than a few seconds: offline, the sign-out must still happen (the unregister is
    /// a courtesy to the server, tried first while the token is good, then let go).
    @MainActor static func beforeSignOut(unregister: Bool = true, business: Business = House.business) async {
        if unregister {
            // Whichever ends first: the request (itself capped at 3 s) or 3 s, should getting the token hang.
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                let once = Once(done)
                Task { @MainActor in await Push.shared.unregister(business: business); once.fire() }
                Task { @MainActor in try? await Task.sleep(for: .seconds(3)); once.fire() }
            }
        }
        // The widget holds one link per business (its key is for that ERP): only this business's sign-out or removal
        // takes its link; the others keep showing.
        ERPWidgetLink.remove(id: business.id)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Where a tapped notification (or anything else outside a screen) wants to go.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()
    var open: Route?

    /// Opens a page of a business that may not be the open one (a tapped notification names its business):
    /// the business is switched to first, then the page opens over its screens.
    func route(path: String, business id: String?) {
        if let id, id != House.id, Businesses.shared.business(id) != nil { Businesses.shared.switch(to: id) }
        open = Route(path: path)
    }
}

@MainActor
@Observable
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()
    private let tokenKey = "erp.pushToken"
    private(set) var registeredOnServer = false
    private(set) var registrationError: String?
    private(set) var registering = false
    /// Whether each signed-in business has this phone's token (Settings → This phone lists them): by business id.
    enum LinkState: Equatable { case linked, failed(String) }
    private(set) var states: [String: LinkState] = [:]
    private var registrationTask: Task<Void, Never>?
    /// The phone's push token is the device's; each signed-in business is told of it (`link`).
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
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else {
                reportFailure("not allowed on this phone")
                return
            }
            registering = true
            UIApplication.shared.registerForRemoteNotifications()
            if let token { await link(token) }
            // iOS answers with a token or an error; if it says nothing, say so rather than spin for ever.
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard let self, self.registering, !self.registeredOnServer else { return }
                self.didFail(NSError(domain: "ERPPush", code: 1, userInfo: [NSLocalizedDescriptionKey: "iOS gave no notification token after 20 seconds."]))
            }
        } catch { didFail(error) }
    }

    func didRegister(token data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        registrationTask?.cancel()
        registrationTask = Task { await link(hex) }
    }

    /// Tells every business somebody is signed in to about this phone, so an alert from any of them arrives (the
    /// payload names its business, `didReceive` below). What is shown is the open business's own answer.
    private func link(_ hex: String) async {
        let open = House.business
        let body: [String: Any] = ["token": hex, "bundleId": Bundle.main.bundleIdentifier ?? "", "label": UIDevice.current.model]
        for b in Businesses.shared.signedInBusinesses() where b.id != open.id {
            do {
                _ = try await ERPAPI.shared.send("/api/push/devices", body, business: b)
                states[b.id] = .linked
            } catch { states[b.id] = .failed(error.localizedDescription) }
        }
        do {
            try await ERPAPI.shared.send("/api/push/devices", body, business: open)
            guard !Task.isCancelled else { return }
            registeredOnServer = true
            registrationError = nil
            states[open.id] = .linked
        } catch {
            guard !Task.isCancelled else { return }
            registeredOnServer = false
            registrationError = error.localizedDescription
            states[open.id] = .failed(error.localizedDescription)
        }
        registering = false
    }

    func didFail(_ error: Error) {
        registering = false
        registrationError = error.localizedDescription
        reportFailure(error.localizedDescription)
    }

    /// Tells the server why this phone never registers (it shows in push_devices_failed): once per launch,
    /// best effort, no token in it, never waited on.
    private var reportedFailure = false
    private func reportFailure(_ text: String) {
        guard !reportedFailure else { return }
        reportedFailure = true
        let body: [String: Any] = ["bundleId": Bundle.main.bundleIdentifier ?? "", "label": UIDevice.current.model, "error": String(text.prefix(300))]
        Task { _ = try? await ERPAPI.shared.send("/api/push/register-failed", body, timeout: 5) }
    }

    /// This phone leaves one business's alerts; the token is the device's and stays for the others.
    func unregister(business: Business = House.business) async {
        registrationTask?.cancel()
        registrationTask = nil
        if let t = token { _ = try? await ERPAPI.shared.send("/api/push/devices", method: "DELETE", ["token": t], timeout: 3, business: business) }
        states[business.id] = nil
        // The flags below are the open business's: another business leaving (a removal) must not unlink this one.
        guard business.id == House.id else { return }
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
        let info = response.notification.request.content.userInfo
        guard let url = info["url"] as? String, url.hasPrefix("/") else { return }
        // A payload may name its business (the ERP's push sender); without one, the page opens in the open business.
        let business = info["business"] as? String
        await MainActor.run { AppRouter.shared.route(path: url, business: business) }
    }
}

/// The home-screen widget's keys (/api/widget/key), one per business, in the keychain the widget shares.
enum WidgetLinker {
    /// Links the open business. `force` asks for a fresh key even when one is kept; the kept link is replaced only once
    /// the new key has arrived, so a failed relink (offline) never leaves a working widget unlinked. False if no key came.
    /// Other businesses' links are never touched here: each is made when that business is signed in to.
    @discardableResult
    @MainActor static func link(force: Bool = false) async -> Bool {
        let b = House.business
        if !force, let kept = ERPWidgetLink.entry(for: b.id), kept.url == b.serverURL {
            // The key stays; the name and colours follow the business (it may have changed them).
            let fresh = ERPWidgetLink.Link(business: b, key: kept.key)
            if fresh != kept { ERPWidgetLink.save(fresh); WidgetCenter.shared.reloadAllTimelines() }
            return true
        }
        guard let r = try? await ERPAPI.shared.send("/api/widget/key", ["label": "iPhone widget"], business: b),
              let key = r["key"] as? String else { return false }
        // Signed out or switched away while the key was made: it is not kept for a business that no longer has a sign-in.
        guard Businesses.shared.auth(for: b)?.currentUser != nil || House.isDemo else { return false }
        ERPWidgetLink.save(.init(business: b, key: key))
        WidgetCenter.shared.reloadAllTimelines()
        return true
    }

    /// The businesses were described again (a new colour, name or logo): the widget's links follow, keeping their keys.
    @MainActor static func sync(_ list: [Business]) {
        var changed = false
        for b in list {
            guard let kept = ERPWidgetLink.entry(for: b.id) else { continue }
            let fresh = ERPWidgetLink.Link(business: b, key: kept.key)
            if fresh != kept { ERPWidgetLink.save(fresh); changed = true }
        }
        if changed { WidgetCenter.shared.reloadAllTimelines() }
    }
}

extension ERPWidgetLink.Link {
    /// A business's entry: its address and the key made for it, with the name and colours the widget draws it in.
    init(business b: Business, key: String) {
        self.init(id: b.id, name: b.displayName, url: b.serverURL, key: key, palette: .init(b.palette), brand: b.art)
    }
}

extension ERPWidgetLink.Palette {
    init(_ p: Business.Palette) {
        self.init(light: .init(p.light), dark: .init(p.dark))
    }
}

extension ERPWidgetLink.Side {
    init(_ s: Business.Side) {
        self.init(accent: s.accent, ground: s.ground, card: s.card, onAccent: s.onAccent)
    }
}

extension ERPWidgetLook {
    /// How a business looks on the widget, for the app's preview of it.
    init(_ b: Business) {
        self.init(ERPWidgetLink.Link(business: b, key: ""))
    }
}

/// Resumes a continuation the first time it is fired, never twice.
@MainActor private final class Once {
    private var done: CheckedContinuation<Void, Never>?
    init(_ done: CheckedContinuation<Void, Never>) { self.done = done }
    func fire() { done?.resume(); done = nil }
}
