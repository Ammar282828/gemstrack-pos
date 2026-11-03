import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Send to karigar, in the background (owner, 2026-11-03: "send message in background"). The sheet hands its request
/// here and closes at once; the send runs on the Outbox's own task (so it outlives the sheet), inside a background
/// task so a locked phone still finishes it, and says how it ended app-wide: "Sent to Usman", or the failure with
/// Retry (`outboxToast`).
///
/// Never twice (owner, 2026-11-03: "it keeps retrying or double sending"). The ERP keeps one record per send
/// (`karigar_sends`, keyed by the order, pieces, karigar and words) and ticks each message off as it goes:
/// - the same send asked again while it runs, or within two minutes of finishing, is answered "already" and sends nothing;
/// - an unfinished one carries on from where it stopped, so Retry sends only what had not gone;
/// - a long one answers `partial` after ~40 s and is asked again here until it has all gone.
/// Here: one send per request at a time (a second tap on the same one is dropped), and it is never retried by
/// itself — only the person's Retry asks again, and that resumes rather than repeats.
@MainActor
final class KarigarSendQueue {
    static let shared = KarigarSendQueue()

    /// Requests on their way, by their words: the same one twice is the same tap twice.
    private var inFlight: Set<String> = []

    /// `body` is the route's request (`orderId`, `pieceIndexes`, `karigarId`, `phone`, `texts`).
    func send(body: [String: Any], karigarName: String, business: Business? = nil) {
        let biz = business ?? House.business
        let key = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? UUID().uuidString
        guard inFlight.insert(key).inserted else { return }
        Outbox.shared.post(label: "Send to \(karigarName)") { [weak self] in
            var bg = UIBackgroundTaskIdentifier.invalid
            bg = UIApplication.shared.beginBackgroundTask(withName: "erp.karigar") {
                UIApplication.shared.endBackgroundTask(bg)
                bg = .invalid
            }
            defer {
                if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) }
                self?.inFlight.remove(key)
            }
            do {
                var sent = 0
                var photosFailed = 0
                var unsure = 0
                // A long send comes back `partial`: ask again, and the ERP carries on from where it stopped.
                for _ in 0..<12 {
                    let out = try await ERPAPI.shared.send("/api/app/orders/send-to-karigar", body, timeout: 90, business: biz)
                    if out["duplicate"] as? Bool == true {
                        if sent > 0 { break }
                        return out["said"] as? String ?? "Already sent to \(karigarName)."
                    }
                    sent += out["sent"] as? Int ?? 0
                    unsure += out["unsure"] as? Int ?? 0
                    if out["partial"] as? Bool != true {
                        photosFailed = out["photosFailed"] as? Int ?? 0
                        break
                    }
                }
                var said = "Sent to \(karigarName): \(sent) message\(sent == 1 ? "" : "s")"
                if photosFailed > 0 { said += " · \(photosFailed) photo\(photosFailed == 1 ? "" : "s") did not go. Retry sends only those" }
                if unsure > 0 { said += " · WhatsApp was slow on \(unsure): check the chat" }
                return said
            } catch let e as ERPAPI.Failure {
                // Status 400 so the Outbox does not retry it by itself.
                throw ERPAPI.Failure(status: 400, message: e.message + " Retry sends only what has not gone.")
            } catch {
                throw ERPAPI.Failure(status: 400, message: error.localizedDescription + " Retry sends only what has not gone.")
            }
        }
    }
}
