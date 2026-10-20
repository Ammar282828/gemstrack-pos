import Foundation
import FirebaseFirestore
import ERPCore

/// An owner's shelves: Firestore's own listeners, as the web store keeps (store.ts createDataLoader),
/// with the phone's copy on disk so the app opens with yesterday's books and no connection.
enum FirestoreSource {
    /// Listeners answer here, off the main thread: a first answer can be a few thousand documents,
    /// and decoding them must not stall a scroll.
    static let queue = DispatchQueue(label: "erp.firestore", qos: .userInitiated)

    /// Signing out of a business forgets its books on this phone: that business's client is shut and its copy on
    /// disk erased. The next `Businesses.firestore(for:)` sets up a fresh one (persistent cache and this queue
    /// are applied there, per instance), so the next person to sign in starts from nothing. Other businesses'
    /// books are untouched.
    @MainActor
    static func forget(_ business: Business = House.business) async {
        // The snapshots go first (and on the listeners' queue, behind any write they have pending), whatever else fails.
        await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
            queue.async { ShelfSnapshots.erase(business: business.id); k.resume() }
        }
        guard !House.isDemo, let db = Businesses.shared.firestore(for: business) else { return }
        do {
            try await db.terminate()
            try await db.clearPersistence()
        } catch {
            print("[firestore] could not clear the phone's copy:", error.localizedDescription)
        }
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
    ///
    /// Listens on the open business's Firestore, resolved here on the main actor: a listener keeps its own
    /// business's database for as long as it runs, whatever is opened later.
    @MainActor
    static func listen<T: Decodable>(_ name: String, docId: String?, sort: ((T, T) -> Bool)? = nil, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        guard let db = Businesses.shared.firestore else {
            Task { @MainActor in deliver(.failed("Not signed in to a business.")) }
            return {}
        }
        let l = Listening<T>(db: db, business: Businesses.shared.current.id, name: name, docId: docId, sort: sort, deliver: deliver)
        queue.async { l.start() }
        // Stopped on the spot (a lock), then on the queue: an answer already on its way to the main actor is dropped.
        return { l.cancel(); queue.async { l.stop() } }
    }
}

/// One listener and its retries. Everything in it runs on FirestoreSource.queue (Firestore answers
/// there too), so its state needs no lock.
private final class Listening<T: Decodable>: @unchecked Sendable {
    let db: Firestore
    let business: String
    let name: String
    let docId: String?
    /// The shelf's order, applied here so a few thousand documents are sorted off the main thread.
    let sort: ((T, T) -> Bool)?
    let deliver: @MainActor (Delivery<T>) -> Void
    private var registration: ListenerRegistration?
    private var stopped = false
    private var tries = 0
    private var first = true
    /// The cache flag last handed on, so a metadata-only snapshot is sent only when it flips.
    private var lastOffline = false
    /// The snapshot is read once per Listening (a retry after permission-denied must not paint it again).
    private var snapshotTried = false
    /// The plain JSON of every document the shelf holds, by id: what the snapshot file is made of.
    private var json: [String: Data] = [:]
    private var pendingWrite: DispatchWorkItem?
    private var lastWrite: Date?
    /// Retries after an error that is not "permission denied" (the web store retries too); reset by any answer.
    private var retries = 0
    /// Read from any thread: set the moment the shelf lets go, so no snapshot is painted after `stop()`.
    private let alive = NSLock()
    private var cancelled = false

    func cancel() { alive.lock(); cancelled = true; alive.unlock() }
    private var isCancelled: Bool { alive.lock(); defer { alive.unlock() }; return cancelled }

    init(db: Firestore, business: String, name: String, docId: String?, sort: ((T, T) -> Bool)?, deliver: @escaping @MainActor (Delivery<T>) -> Void) {
        self.db = db
        self.business = business
        self.name = name
        self.docId = docId
        self.sort = sort
        self.deliver = deliver
    }

    private func send(_ d: Delivery<T>) {
        let deliver = deliver
        Task { @MainActor [weak self] in
            guard let self, !self.isCancelled else { return }
            deliver(d)
        }
    }

    private func sendAll(_ items: [T], offline: Bool, source: String? = nil) {
        send(.all(sort.map { items.sorted(by: $0) } ?? items, offline: offline, source: source))
    }

    /// Writes the shelf's snapshot 1.5 s after the last change, so a burst of changes is one file, and not
    /// more than once in ten seconds (a busy shop rewrites a big file for every payment otherwise).
    private func scheduleWrite() {
        guard !stopped else { return }
        pendingWrite?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.stopped else { return }
            self.lastWrite = Date()
            ShelfSnapshots.write(.firestore, business: self.business, collection: self.name, docId: self.docId, documents: Array(self.json.values))
        }
        pendingWrite = work
        let wait = max(1.5, lastWrite.map { 10 - Date().timeIntervalSince($0) } ?? 0)
        FirestoreSource.queue.asyncAfter(deadline: .now() + wait, execute: work)
    }

    /// Paints from the snapshot before Firestore is asked: one file read and one decode pass.
    private func paintSnapshot() {
        guard !snapshotTried else { return }
        snapshotTried = true
        guard let data = ShelfSnapshots.read(.firestore, business: business, collection: name, docId: docId) else { return }
        guard let items = DocJSON.decodeArray(T.self, json: data) else {
            ShelfSnapshots.discard(.firestore, business: business, collection: name, docId: docId)
            return
        }
        sendAll(items, offline: true, source: "snapshot")
    }

    func stop() {
        cancel()
        stopped = true
        pendingWrite?.cancel()
        pendingWrite = nil
        registration?.remove()
        registration = nil
    }

    func start() {
        guard !stopped else { return }
        paintSnapshot()
        registration?.remove()
        first = true
        lastOffline = false
        if let docId {
            registration = db.collection(name).document(docId).addSnapshotListener { [weak self] snap, error in
                guard let self else { return }
                if let error { return self.failed(error) }
                guard let snap else { return }
                self.retries = 0
                self.tries = 0
                let model = snap.data().flatMap { self.decode(id: snap.documentID, data: $0) }
                self.send(.all(model.map { [$0] } ?? [], offline: snap.metadata.isFromCache, source: nil))
                if model == nil { self.json = [:] }
                if !(model == nil && snap.metadata.isFromCache) { self.scheduleWrite() }
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

    /// One conversion, kept: the JSON the model is read from is the JSON the snapshot stores.
    private func decode(id: String, data: [String: Any]) -> T? {
        guard let bytes = DocJSON.json(id: id, data: data, custom: FirestoreSource.plainSDK),
              let model = DocJSON.decode(T.self, json: bytes) else { json[id] = nil; return nil }
        json[id] = bytes
        return model
    }

    private func decode(_ d: QueryDocumentSnapshot) -> T? { decode(id: d.documentID, data: d.data()) }

    private func take(_ snap: QuerySnapshot) {
        retries = 0
        tries = 0
        let off = snap.metadata.isFromCache
        if first {
            // Even an empty collection is an answer: "loaded, nothing in it".
            first = false
            lastOffline = off
            json = [:]
            sendAll(snap.documents.compactMap { decode($0) }, offline: off)
            // A cold, empty cache answer says nothing yet: it must not wipe the snapshot before the server speaks.
            if !(off && snap.documents.isEmpty) { scheduleWrite() }
            return
        }
        // Metadata alone (pending write acknowledged, cache -> server) has no changes: it matters only when
        // the cache flag flips, which the shelf takes without counting a change of the books.
        if snap.documentChanges.isEmpty && off == lastOffline { return }
        lastOffline = off
        var upserts: [T] = []
        var removed: [String] = []
        for c in snap.documentChanges {
            if c.type == .removed {
                json[c.document.documentID] = nil
                removed.append(c.document.documentID)
            } else if let m = decode(c.document) {
                upserts.append(m)
            } else {
                // A document that no longer reads as the model leaves the shelf, not a stale copy.
                removed.append(c.document.documentID)
            }
        }
        send(.changes(upserts: upserts, removed: removed, offline: off))
        if !upserts.isEmpty || !removed.isEmpty { scheduleWrite() }
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
        // Any other error (a dropped channel, unavailable): the listener is dead, so it is started again, 1, 2, 4,
        // 8, 16 seconds apart, before the error is shown.
        if code != .permissionDenied, retries < 5, !stopped {
            let wait = pow(2, Double(retries))
            retries += 1
            FirestoreSource.queue.asyncAfter(deadline: .now() + wait) { [weak self] in self?.start() }
            return
        }
        send(.failed(code == .permissionDenied ? "This account can't read the shop's books." : error.localizedDescription))
    }
}
