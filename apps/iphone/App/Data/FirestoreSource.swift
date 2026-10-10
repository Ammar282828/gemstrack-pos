import Foundation
import FirebaseCore
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

    /// Signing out forgets the books on this phone: the client is shut, its copy on disk erased, and a
    /// fresh one set up as at launch, so the next person to sign in starts from nothing.
    @MainActor
    static func forget() async {
        guard !House.isDemo, FirebaseApp.app() != nil else { return }
        let db = Firestore.firestore()
        do {
            try await db.terminate()
            try await db.clearPersistence()
        } catch {
            print("[firestore] could not clear the phone's copy:", error.localizedDescription)
        }
        configure()
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
        let l = Listening<T>(name: name, docId: docId, deliver: deliver)
        queue.async { l.start() }
        return { queue.async { l.stop() } }
    }
}

/// One listener and its retries. Everything in it runs on FirestoreSource.queue (Firestore answers
/// there too), so its state needs no lock.
private final class Listening<T: Decodable>: @unchecked Sendable {
    let name: String
    let docId: String?
    let deliver: @MainActor (Delivery<T>) -> Void
    private var registration: ListenerRegistration?
    private var stopped = false
    private var tries = 0
    private var first = true

    init(name: String, docId: String?, deliver: @escaping @MainActor (Delivery<T>) -> Void) {
        self.name = name
        self.docId = docId
        self.deliver = deliver
    }

    private func send(_ d: Delivery<T>) {
        let deliver = deliver
        Task { @MainActor in deliver(d) }
    }

    func stop() {
        stopped = true
        registration?.remove()
        registration = nil
    }

    func start() {
        guard !stopped else { return }
        registration?.remove()
        first = true
        let db = Firestore.firestore()
        if let docId {
            registration = db.collection(name).document(docId).addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, error in
                guard let self else { return }
                if let error { return self.failed(error) }
                guard let snap else { return }
                let model = snap.data().flatMap { DocJSON.decode(T.self, id: snap.documentID, data: $0, custom: FirestoreSource.plainSDK) }
                self.send(.all(model.map { [$0] } ?? [], offline: snap.metadata.isFromCache))
            }
        } else {
            registration = db.collection(name).addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, error in
                guard let self else { return }
                if let error { return self.failed(error) }
                guard let snap else { return }
                self.take(snap)
            }
        }
    }

    private func decode(_ d: QueryDocumentSnapshot) -> T? {
        DocJSON.decode(T.self, id: d.documentID, data: d.data(), custom: FirestoreSource.plainSDK)
    }

    private func take(_ snap: QuerySnapshot) {
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

    private func failed(_ error: Error) {
        let code = FirestoreErrorCode.Code(rawValue: (error as NSError).code)
        // Just after sign-in a listener can start before Firestore has the person's token: the web
        // retries the same way (store.ts, permission-denied).
        if code == .permissionDenied, tries < 4 {
            tries += 1
            FirestoreSource.queue.asyncAfter(deadline: .now() + 0.5 * pow(2, Double(tries - 1))) { [weak self] in self?.start() }
            return
        }
        send(.failed(code == .permissionDenied ? "This account can't read the shop's books." : error.localizedDescription))
    }
}
