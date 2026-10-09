import SwiftUI
import Observation
import ERPCore

/// The online orders and their moves, through the web's own staff routes (lib/website/online-client.ts):
/// the list (/api/website/online), Confirm and Decline (/api/website/online/<ONL-…>), Transfer received and
/// Let it lapse (/api/website/orders/<ORD-…>). Each of those sends WhatsApp from the shop's number and the
/// transfer books money, so they are the server's (lib/website/online.ts, fulfilment.ts) and gated there to a
/// signed-in owner or staff account; the phone only asks, after saying what goes (the preview routes).
/// Each move is safe to ask twice: the server claims a confirm in a transaction and records a transfer once.
@MainActor
@Observable
final class OnlineOrdersStore {
    static let shared = OnlineOrdersStore()

    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var rows: [OnlineOrderRow] = []
    @ObservationIgnored private var loading = false

    var waiting: [OnlineOrderRow] { rows.filter { OnlineOrdersLogic.isWaiting($0) } }
    /// The last fortnight's, newest first (the server sorts them so).
    var lately: [OnlineOrderRow] { rows.filter { !OnlineOrdersLogic.isWaiting($0) } }

    /// The list, and the count the dashboard and the Orders tab show, asked again.
    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if rows.isEmpty { phase = .loading }
        do {
            rows = try await ERPAPI.shared.get("/api/website/online", as: OnlineOrdersAnswer.self).orders
            phase = .loaded
        } catch {
            if rows.isEmpty { phase = .failed(Self.say(error)) }
        }
        await OnlineInbox.shared.refresh()
    }

    // MARK: What a move will send

    func previewOnline(_ id: String, action: String, reason: String? = nil) async throws -> OnlinePreview {
        var path = "/api/website/online/\(OnlineOrdersLogic.component(id))/preview?action=\(action)"
        if let reason { path += "&reason=" + OnlineOrdersLogic.component(reason) }
        do { return try await ERPAPI.shared.get(path, as: OnlinePreview.self) } catch { throw Self.plain(error) }
    }

    func previewOrder(_ id: String, action: String) async throws -> OnlinePreview {
        let path = "/api/website/orders/\(OnlineOrdersLogic.component(id))/preview?action=\(action)"
        do { return try await ERPAPI.shared.get(path, as: OnlinePreview.self) } catch { throw Self.plain(error) }
    }

    // MARK: The moves

    struct Confirmed: Equatable {
        let orderId: String
        /// Why the customer's WhatsApp did not go; nil when it went.
        let notified: String?
    }

    /// Writes the ORD- order (labelled Online, the quoted prices), starts the price hold and tells the customer.
    func confirm(_ id: String) async throws -> Confirmed {
        let out = try await move("/api/website/online/\(OnlineOrdersLogic.component(id))", ["action": "confirm"])
        return Confirmed(orderId: out["orderId"] as? String ?? "", notified: out["notified"] as? String)
    }

    /// Sends the customer the reason. Nothing else is written. Answers why the WhatsApp did not go, if it did not.
    func decline(_ id: String, reason: String) async throws -> String? {
        let out = try await move("/api/website/online/\(OnlineOrdersLogic.component(id))", ["action": "decline", "reason": reason])
        return out["notified"] as? String
    }

    /// The money is in the bank: the pieces as a dated Bank Transfer advance, the delivery as extra revenue.
    func transferReceived(order id: String) async throws -> String? {
        let out = try await move("/api/website/orders/\(OnlineOrdersLogic.component(id))", ["action": "transfer_received"])
        return out["notified"] as? String
    }

    /// Nothing came and the bank was checked: the order is cancelled and the customer told.
    func lapse(order id: String) async throws -> String? {
        let out = try await move("/api/website/orders/\(OnlineOrdersLogic.component(id))", ["action": "lapse"])
        return out["notified"] as? String
    }

    private func move(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
        let out: [String: Any]
        do { out = try await ERPAPI.shared.send(path, body) } catch { throw Self.plain(error) }
        // Staff read the books from the server every 25 seconds: ask now, so the order just confirmed or paid
        // is on the screen at once (owners' are live already).
        ServerShelf.wake()
        Task { await self.load() }
        return out
    }

    // MARK: Words for a refusal

    /// The web's words for the gate's refusals (online-client.ts staffFetch); the server's own otherwise.
    static func say(_ error: Error) -> String {
        if let f = error as? ERPAPI.Failure {
            if f.status == 401 { return "Sign in with Google to act on online orders." }
            if f.status == 403 { return "Only owner and staff accounts can act on online orders." }
        }
        return error.localizedDescription
    }

    private static func plain(_ error: Error) -> Error {
        guard let f = error as? ERPAPI.Failure else { return error }
        return ERPAPI.Failure(status: f.status, message: say(f))
    }
}
