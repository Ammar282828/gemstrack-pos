import Foundation
import Network
import Observation

/// Cached Firestore data is not evidence that the phone has lost its network connection.
@MainActor
@Observable
final class Connection {
    static let shared = Connection()
    private(set) var isOffline = false
    @ObservationIgnored private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let offline = path.status == .unsatisfied
            Task { @MainActor [weak self] in self?.isOffline = offline }
        }
        monitor.start(queue: DispatchQueue(label: "erp.connection"))
    }
}
