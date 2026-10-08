import Foundation
import FirebaseFirestore
import ERPCore

/// An owner's shelves: Firestore's own listeners, as the web store keeps (store.ts createDataLoader),
/// with the phone's copy on disk so the app opens with yesterday's books and no connection.
enum FirestoreSource {
    /// Listeners answer here, off the main thread: a first answer can be a few thousand documents,
    /// and decoding them must not stall a scroll.
    static let queue = DispatchQueue(label: "erp.firestore", qos: .userInitiated)

    /// Once, after FirebaseApp.configure and before anything reads.
    static func configure() {
        let s = FirestoreSettings()
        s.cacheSettings = PersistentCacheSettings(sizeBytes: NSNumber(value: 512 * 1024 * 1024))
        s.dispatchQueue = queue
        Firestore.firestore().settings = s
    }

    /// SDK values JSON cannot hold, as text the models read (dates as ISO, as the ERP writes its own).
    static func plainSDK(_ v: Any) -> Any? {
        switch v {
        case let t as Timestamp: return ERPDate.iso(t.dateValue())
        case let r as DocumentReference: return r.path
        case let g as GeoPoint: return ["latitude": g.latitude, "longitude": g.longitude]
        default: return nil
        }
    }

    /// A collection unordered (sorted on the phone, so a document missing the sort field is still
    /// shown), or one document. Every change after the first answer arrives as just that change.
    static func listen<T: Decodable>(_ name: String, docId: String?, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        let db = Firestore.firestore()
        var registration: ListenerRegistration?
        var stopped = false
        var tries = 0

        func send(_ d: Delivery<T>) { Task { @MainActor in deliver(d) } }

        func failed(_ error: Error) {
            let code = FirestoreErrorCode.Code(rawValue: (error as NSError).code)
            // Just after sign-in the listener can start before Firestore has the person's token:
            // the web retries the same way (store.ts, permission-denied).
            if code == .permissionDenied, tries < 4 {
                tries += 1
                queue.asyncAfter(deadline: .now() + 0.5 * pow(2, Double(tries - 1))) { if !stopped { start() } }
                return
            }
            send(.failed(code == .permissionDenied ? "This account can't read the shop's books." : error.localizedDescription))
        }

        func start() {
            registration?.remove()
            if let docId {
                registration = db.collection(name).document(docId).addSnapshotListener { snap, error in
                    if let error { return failed(error) }
                    guard let snap else { return }
                    let model = snap.data().flatMap { DocJSON.decode(T.self, id: snap.documentID, data: $0, custom: plainSDK) }
                    send(.all(model.map { [$0] } ?? [], offline: snap.metadata.isFromCache))
                }
            } else {
                var first = true
                registration = db.collection(name).addSnapshotListener { snap, error in
                    if let error { return failed(error) }
                    guard let snap else { return }
                    let decode = { (d: QueryDocumentSnapshot) in DocJSON.decode(T.self, id: d.documentID, data: d.data(), custom: plainSDK) }
                    if first {
                        first = false
                        send(.all(snap.documents.compactMap(decode), offline: snap.metadata.isFromCache))
                        return
                    }
                    var upserts: [T] = []
                    var removed: [String] = []
                    for c in snap.documentChanges {
                        if c.type == .removed {
                            removed.append(c.document.documentID)
                        } else if let m = decode(c.document) {
                            upserts.append(m)
                        } else {
                            // A document that no longer reads as the model leaves the shelf, not a stale copy.
                            removed.append(c.document.documentID)
                        }
                    }
                    send(.changes(upserts: upserts, removed: removed, offline: snap.metadata.isFromCache))
                }
            }
        }

        queue.async { start() }
        return { queue.async { stopped = true; registration?.remove(); registration = nil } }
    }
}
