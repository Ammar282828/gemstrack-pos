import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Send to karigar, in the background (owner, 2026-11-03: "send message in background"). The sheet hands its request
/// here and closes at once; the send runs on the Outbox's own task (so it outlives the sheet), inside a background
/// task so a locked phone still finishes it, and says how it ended app-wide: "Sent to Usman", or the failure with
/// Retry (`outboxToast`). It is never retried by itself: a timeout may still have delivered some photos, and a second
/// try would send them again, so only the person's Retry sends again.
@MainActor
final class KarigarSendQueue {
    static let shared = KarigarSendQueue()

    /// `body` is the route's request (`orderId`, `pieceIndexes`, `karigarId`, `phone`, `texts`).
    func send(body: [String: Any], karigarName: String, business: Business? = nil) {
        let biz = business ?? House.business
        Outbox.shared.post(label: "Send to \(karigarName)") {
            var bg = UIBackgroundTaskIdentifier.invalid
            bg = UIApplication.shared.beginBackgroundTask(withName: "erp.karigar") {
                UIApplication.shared.endBackgroundTask(bg)
                bg = .invalid
            }
            defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) } }
            do {
                let out = try await ERPAPI.shared.send("/api/app/orders/send-to-karigar", body, timeout: 180, business: biz)
                let sent = out["sent"] as? Int ?? 0
                var said = "Sent to \(karigarName): \(sent) message\(sent == 1 ? "" : "s")"
                if let failed = out["photosFailed"] as? Int, failed > 0 { said += " · \(failed) photo\(failed == 1 ? "" : "s") did not go" }
                return said
            } catch let e as ERPAPI.Failure {
                // Status 400 so the Outbox does not retry it by itself.
                throw ERPAPI.Failure(status: 400, message: e.message)
            } catch {
                throw ERPAPI.Failure(status: 400, message: error.localizedDescription + " Some of it may have gone: check the chat before Retry.")
            }
        }
    }
}
