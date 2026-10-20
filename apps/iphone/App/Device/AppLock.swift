import SwiftUI
import LocalAuthentication
import Observation

/// The shop's books are on this phone: the app asks for Face ID (or the phone's passcode) when it comes
/// back after being away, and never lets the app switcher's snapshot show a figure.
///
/// On by default for an owner on a phone with a passcode; switched in Search → This phone. A minute
/// away is allowed without asking again (a customer's call, a photo from the camera).
@MainActor
@Observable
final class AppLock {
    static let shared = AppLock()

    private static let enabledKey = "erp.lock.enabled"
    private static let grace: TimeInterval = 60

    /// The app is behind the lock screen.
    private(set) var locked = false
    /// The switcher is about to photograph the app: cover it.
    private(set) var covered = false
    private(set) var unlocking = false
    @ObservationIgnored private var leftAt: Date?

    var enabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    /// Whether this phone can lock at all (a passcode is set).
    static var available: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func phase(_ phase: ScenePhase, signedIn: Bool) {
        guard !House.isDemo else { return }
        switch phase {
        case .inactive:
            covered = signedIn
        case .background:
            covered = signedIn
            if leftAt == nil { leftAt = Date() }
        case .active:
            covered = false
            if signedIn, enabled, Self.available, let left = leftAt, Date().timeIntervalSince(left) > Self.grace {
                locked = true
            }
            leftAt = nil
            if locked { Task { await unlock() } }
        @unknown default:
            break
        }
    }

    /// A cold start of a signed-in app asks too. The cover is up from the first frame; Face ID is asked for
    /// once the app is in front (a launch calls this before it is, and the ask would fail), here or in `phase`.
    func launched(signedIn: Bool) {
        guard !House.isDemo, signedIn, enabled, Self.available else { return }
        locked = true
        if UIApplication.shared.applicationState == .active { Task { await unlock() } }
    }

    /// Nobody is signed in after all (the cached sign-in was gone): there is nothing to lock away.
    func signedOut() {
        locked = false
    }

    func unlock() async {
        guard locked, !unlocking else { return }
        unlocking = true
        defer { unlocking = false }
        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"
        do {
            if try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Open \(House.storeName)") { locked = false }
        } catch {
            // Cancelled or failed: the lock screen stays, with its button to try again.
        }
    }
}

/// What shows over the app while it is locked or being photographed for the switcher: the house's mark
/// on its ground, nothing of the books.
struct LockCover: View {
    let lock: AppLock

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 24) {
                HouseLogo().padding(.horizontal, 32)
                if lock.locked {
                    Button {
                        Task { await lock.unlock() }
                    } label: {
                        Label("Unlock", systemImage: "faceid").padding(.horizontal, 12).padding(.vertical, 4)
                    }
                    .buttonStyle(.houseProminent)
                    .controlSize(.large)
                    .disabled(lock.unlocking)
                }
            }
        }
        .transition(.opacity)
    }
}

/// The cover in a window of its own, above every sheet, full-screen cover, menu and alert of the app's window (a
/// SwiftUI ZStack can only cover what it contains), and so in the app switcher's snapshot. Made once, moved to the
/// active scene, gone the moment the lock is.
@MainActor
final class LockWindow {
    static let shared = LockWindow()
    private var window: UIWindow?

    func update(show: Bool) {
        if show { present() } else { dismiss() }
    }

    private func present() {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard let scene else { return }
        if let window, window.windowScene === scene { window.isHidden = false; return }
        window?.isHidden = true
        let host = UIHostingController(rootView: LockCoverHost())
        host.view.backgroundColor = .clear
        // VoiceOver stays on the cover: nothing beneath it is reachable.
        host.view.accessibilityViewIsModal = true
        let w = UIWindow(windowScene: scene)
        w.windowLevel = UIWindow.Level.alert + 1
        w.rootViewController = host
        w.isHidden = false
        window = w
        UIAccessibility.post(notification: .screenChanged, argument: host.view)
    }

    private func dismiss() {
        window?.isHidden = true
        window = nil
    }
}

private struct LockCoverHost: View {
    @State private var lock = AppLock.shared
    var body: some View {
        LockCover(lock: lock)
    }
}
