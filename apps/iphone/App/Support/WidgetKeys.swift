import Foundation

/// The widget's keys on the ERP's side (`DELETE /api/widget/key`): taking a business's link off this phone also
/// takes its key back from the ERP, so a copied keychain or a sold phone reads nothing.
enum WidgetKeys {
    /// Revokes the business's key on its ERP, then forgets the link. Capped at 3 s so a sign-out never waits on it;
    /// a key the ERP could not be told about stays valid there until its owner is removed (the old behaviour).
    @MainActor static func revoke(business: Business) async {
        guard !House.isDemo, !business.isDemo, let key = ERPWidgetLink.entry(for: business.id)?.key else { return }
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let once = RevokeOnce(done)
            Task { @MainActor in
                _ = try? await ERPAPI.shared.send("/api/widget/key", method: "DELETE", ["key": key], timeout: 3, business: business)
                once.fire()
            }
            Task { @MainActor in try? await Task.sleep(for: .seconds(3)); once.fire() }
        }
    }
}

private final class RevokeOnce: @unchecked Sendable {
    private var done: CheckedContinuation<Void, Never>?
    init(_ c: CheckedContinuation<Void, Never>) { done = c }
    @MainActor func fire() { done?.resume(); done = nil }
}
