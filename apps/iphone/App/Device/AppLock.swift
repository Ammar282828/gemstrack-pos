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

    /// A cold start of a signed-in app asks too.
    func launched(signedIn: Bool) {
        guard !House.isDemo, signedIn, enabled, Self.available else { return }
        locked = true
        Task { await unlock() }
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
