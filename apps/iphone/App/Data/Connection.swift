import Foundation
import Network
import Observation

/// Cached Firestore data is not evidence that the phone has lost its network connection.
///
/// Offline is a first-class state (owner, 2026-11-03: "it should fully handle not being connected at all in any
/// situation"): `isOffline` drives the app-wide capsule (`OfflineCapsule`), and every time the line comes back
/// `regained` goes up and each `onRegain` listener runs, so the Outbox sends what was waiting without anyone asking.
@MainActor
@Observable
final class Connection {
    static let shared = Connection()
    private(set) var isOffline = false
    /// Goes up each time the line comes back after being lost.
    private(set) var regained = 0
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var listeners: [@MainActor () -> Void] = []

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let offline = path.status == .unsatisfied
            Task { @MainActor [weak self] in self?.set(offline) }
        }
        monitor.start(queue: DispatchQueue(label: "erp.connection"))
    }

    /// Runs on the main actor each time the connection returns.
    func onRegain(_ listener: @escaping @MainActor () -> Void) { listeners.append(listener) }

    private func set(_ offline: Bool) {
        let was = isOffline
        if offline != was { isOffline = offline }
        if was && !offline {
            regained += 1
            for l in listeners { l() }
        }
    }

    /// The request never reached the ERP, or its answer never came back: no line, a timeout, the server down.
    /// What a queued money write waits out, and what an awaited one hands to the Outbox. A timeout may have been
    /// recorded already, which is why every queued write keeps its request name: sent again, it is the same change.
    nonisolated static func lost(_ error: Error) -> Bool {
        if let f = error as? ERPAPI.Failure { return f.offline || [502, 503, 504].contains(f.status) }
        guard let u = error as? URLError else { return false }
        switch u.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .dataNotAllowed,
             .cannotConnectToHost, .dnsLookupFailed, .internationalRoamingOff, .callIsActive,
             .secureConnectionFailed, .badServerResponse:
            return true
        default:
            return false
        }
    }

    /// The request certainly never left the phone (no line at all): safe for a send that must never go twice.
    nonisolated static func neverLeft(_ error: Error) -> Bool {
        if let f = error as? ERPAPI.Failure { return f.offline }
        guard let u = error as? URLError else { return false }
        switch u.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .callIsActive: return true
        default: return false
        }
    }
}
