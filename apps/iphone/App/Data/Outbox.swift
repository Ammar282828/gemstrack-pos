import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Saves that do not move money leave the screen at once and finish in the background (owner, 2026-10-23: "make
/// the app snappier"). `send` returns as soon as the change is queued; the write goes through `ERPAPI.write` with
/// the name (`requestId`) kept in the entry, so every retry is the same change to the ERP. Entries are kept on disk
/// per business (a kill loses nothing), retried with backoff and again when the app comes forward, and a refusal
/// or a last failure is said app-wide with Retry. Money writes are awaited: the person sees the ERP's answer.
///
/// Except offline (owner, 2026-11-03: "allow massive offline capabilities … it should fully handle not being
/// connected at all in any situation"): a creation or a payment that cannot reach the ERP (`queueableOps`) is kept
/// here, durably, with the request name fixed at the first tap (`queueForLater`, called by `ERPAPI.write`). Those
/// entries (`durable`) never give up on a missing line: they wait for it (`.waiting`), go one at a time in the order they
/// were made, and send themselves when the connection returns (`Connection.onRegain`), the app comes forward, or
/// the backoff comes round. The ERP records a name once, so a replay is never a second sale. Only a refusal (4xx) stops
/// one: it stays here with its data, said app-wide with Retry, and can be discarded from Waiting to send.
@MainActor @Observable
final class Outbox {
    static let shared = Outbox()

    init() {
        // The line is back: whatever was waiting goes now, not at the end of its backoff.
        Connection.shared.onRegain { [weak self] in self?.wake() }
    }

    /// Every op the ERP records once by name (src/app/api/app/write/idempotency.ts MONEY_OP_NAMES) plus the
    /// owner-only money ops of ops-money.ts. `send` refuses these: the person must see the ERP's answer.
    nonisolated static let moneyOps: Set<String> = [
        "recordPayment", "recordOrderAdvance", "createInvoice", "createOrder", "finalizeOrder",
        "addRepair", "recordRepairPayment", "addExpense",
        "addHisaabEntry", "addShareholderEntry", "addExtraRevenue",
        "updateInvoiceDiscount", "refundInvoicePartial", "payBackCredit", "settleInvoicePayment", "settleOrderAdvance", "raiseOrderDiscount",
        "startPayBatch", "settlePayBatch",
        "saveOverheadPlan", "deleteShareholderEntry", "deletePartnerSalary", "setWorkingCapitalFloor",
        "restoreRemoved", "purgeRemoved",
    ]

    /// What may wait for the line when `ERPAPI.write` cannot reach the ERP: creations and payments (the ERP records
    /// these once by name, so a replay is safe), and the edits whose callers never read an answer. Deletes, refunds,
    /// settlements, finalizing and the owner-only money settings are never here: they say "Needs a connection".
    nonisolated static let queueableOps: Set<String> = [
        "createOrder", "createInvoice", "recordPayment", "recordOrderAdvance",
        "addRepair", "recordRepairPayment", "addExpense", "addHisaabEntry", "addShareholderEntry", "addExtraRevenue",
        "updateOrder", "updateRepair", "setRepairStatus", "updateExpense", "updateExtraRevenue",
    ]

    enum Status: Equatable {
        case saving, retrying, failed
        /// Kept on this phone until the connection is back.
        case waiting
    }

    /// What a screen may show: "Saving…" while `pending > 0`, or `status(of:)` for one label.
    struct Item: Identifiable, Equatable {
        let id: String
        let label: String
        var status: Status
        var message = ""
        var isPost = false
        /// A change kept for the line (`queueForLater`): its summary is what the pending row in a list reads.
        var summary: PendingSummary?
        var business = ""
        var createdAt = Date()
        var durable = false
    }

    /// A change on its way, written to disk (a post is a closure, so it lives only until the app is killed).
    /// The optional fields came with the offline queue: a file written before them still reads.
    private struct Entry: Codable {
        var id: String
        var op: String
        var fields: Data
        var business: String
        var label: String
        var attempts = 0
        var createdAt = Date()
        var durable: Bool?
        var summary: PendingSummary?
        /// The write's intent (`WriteIntents`): forgotten once the ERP has the change.
        var intent: String?
        /// A POST to an ERP route that is not /api/app/write (send to karigar): `fields` is its body.
        var route: String?
        /// The ERP's words when it refused this change: it stays on the phone as refused (not sent again at every launch)
        /// until the person retries or discards it.
        var refusal: String?
    }

    private(set) var items: [Item] = []
    /// The last thing that failed for good: the root's banner shows it with Retry.
    private(set) var failure: Item?
    /// A post that finished (or a send that did): said once as a toast.
    private(set) var notice: Note?
    /// Waiting to send is open (the capsule, Settings).
    var queueOpen = false

    var pending: Int { items.filter { $0.status != .failed }.count }
    func status(of label: String) -> Status? { items.first { $0.label == label }?.status }

    /// Changes kept for the line, not yet at the ERP (Waiting to send's count, the offline capsule's).
    var waitingCount: Int { items.filter { $0.status == .waiting }.count }
    /// Kept changes in all, those refused included: the number Waiting to send shows.
    var keptCount: Int { items.filter { $0.durable }.count }

    /// New orders and sales (or other kinds) of the open business that the ERP does not have yet, oldest last as
    /// the lists show them (newest first). Their rows are "Waiting to send" at the top of Orders and Invoices.
    func records(kind: String) -> [Item] {
        let mine = House.business.id
        return items.filter { $0.durable && $0.summary?.kind == kind && $0.business == mine }.sorted { $0.createdAt > $1.createdAt }
    }

    /// The pending payments and advances on an invoice or an order (its page may say "PKR x waiting to send").
    func payments(on target: String) -> [Item] {
        items.filter { $0.durable && $0.summary?.target == target && ($0.summary?.kind == "payment" || $0.summary?.kind == "advance") }
    }

    @ObservationIgnored private var entries: [String: Entry] = [:]
    @ObservationIgnored private var posts: [String: () async throws -> String] = [:]
    @ObservationIgnored private var running: Set<String> = []
    @ObservationIgnored private var loaded: Set<String> = []
    @ObservationIgnored private var lastWarm: Date = .distantPast
    /// Bumped to cut every wait short (the line is back, the app came forward, Retry): the waiting tasks go now.
    @ObservationIgnored private var nudge = 0

    /// ~5 tries over ~2 minutes: now, then after these seconds.
    private static let backoff: [Double] = [2, 8, 25, 80]

    // MARK: Non-money saves

    /// Queue a change and return. The label is what the person reads if it fails ("Not saved: <label>").
    func send(op: String, fields: [String: Any], business: Business? = nil, label: String) {
        guard !Self.moneyOps.contains(op) else {
            assertionFailure("Outbox.send: \(op) moves money; await ERPAPI.write")
            let biz = business
            Task { [weak self] in
                do { try await ERPAPI.shared.write(op, fields, business: biz) }
                catch { self?.fail(id: UUID().uuidString, label: label, message: error.localizedDescription) }
            }
            return
        }
        let biz = business ?? House.business
        guard let data = try? JSONSerialization.data(withJSONObject: fields) else { return }
        let e = Entry(id: UUID().uuidString, op: op, fields: data, business: biz.id, label: label)
        entries[e.id] = e
        items.append(Item(id: e.id, label: label, status: .saving, business: biz.id, createdAt: e.createdAt))
        persist(biz.id)
        run(e.id)
    }

    // MARK: Kept for the line (offline)

    /// Keep a creation or a payment on this phone to be sent when the ERP can be reached, and say so. The entry's id IS
    /// the request name, fixed at the first tap, so the same change asked again (a double tap, a retry after the app
    /// was killed) is the same entry and, at the ERP, the same record. Written to disk before this returns.
    func queueForLater(op: String, fields: [String: Any], requestId: String, business: Business, intent: String?,
                       summary: PendingSummary?) throws -> [String: Any] {
        let answer: [String: Any] = ["queued": true, "requestId": requestId]
        if entries[requestId] != nil { return answer }
        // The moment of the tap travels with it: a payment is dated then (`date`, which the ERP honours), and every kept
        // change carries `clientAt` for the ERP to stamp its records with when it learns to (see the report).
        var kept = fields
        let tapped = Date().ISO8601Format()
        if kept["clientAt"] == nil { kept["clientAt"] = tapped }
        if op == "recordPayment", kept["date"] == nil { kept["date"] = tapped }
        guard JSONSerialization.isValidJSONObject(kept), let data = try? JSONSerialization.data(withJSONObject: kept) else {
            throw ERPAPI.Failure(status: 0, message: "This couldn't be kept for later. Try again when you're online.")
        }
        let s = summary ?? PendingSummary.make(op: op, fields: fields)
        var e = Entry(id: requestId, op: op, fields: data, business: business.id, label: s.label)
        e.durable = true
        e.summary = s
        e.intent = intent
        entries[e.id] = e
        items.append(Item(id: e.id, label: s.label, status: Connection.shared.isOffline ? .waiting : .saving,
                          summary: s, business: business.id, createdAt: e.createdAt, durable: true))
        persist(business.id)
        notice = Note(title: "Saved on this phone", detail: "\(s.label) will send when you're back online.")
        run(e.id)
        return answer
    }

    /// A send to an ERP route (send to karigar) kept for the line. Only for a send that certainly never left the
    /// phone, so waiting for the line can never make it go twice. The same send asked twice is one.
    func queueRoute(_ path: String, body: [String: Any], label: String, detail: String = "", business: Business? = nil) {
        let biz = business ?? House.business
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        if entries.values.contains(where: { $0.route == path && $0.fields == data && $0.business == biz.id }) { return }
        let s = PendingSummary(kind: "send", title: label, detail: detail)
        var e = Entry(id: UUID().uuidString, op: "route", fields: data, business: biz.id, label: label)
        e.durable = true
        e.summary = s
        e.route = path
        entries[e.id] = e
        items.append(Item(id: e.id, label: label, status: Connection.shared.isOffline ? .waiting : .saving,
                          summary: s, business: biz.id, createdAt: e.createdAt, durable: true))
        persist(biz.id)
        notice = Note(title: "Saved on this phone", detail: "\(label) will go when you're back online.")
        run(e.id)
    }

    /// Give a kept change up (Waiting to send's Discard, after asking): it is not sent and not kept.
    func discard(_ id: String) {
        if failure?.id == id { failure = nil }
        running.remove(id)
        remove(id)
    }

    /// Every wait ends now: the line is back, or the person asked.
    func wake() {
        nudge += 1
        // The drafts the phone could not send or remove while the line was gone.
        WorkDraftSync.resumeAll()
        for i in items where i.status == .waiting || i.status == .retrying { run(i.id) }
    }

    // MARK: Long sends

    /// A website post or any long request: runs now in the background with the same retry policy. The closure
    /// returns the words for success ("Posted to 3 places"); a thrown error is "<label> failed: …". Not kept on disk.
    func post(label: String, _ request: @escaping () async throws -> String) {
        let id = UUID().uuidString
        posts[id] = request
        items.append(Item(id: id, label: label, status: .saving, isPost: true, business: House.business.id))
        run(id)
    }

    // MARK: Retry

    /// Retry the failed one (the banner's button), or every failed one.
    func retry(_ id: String? = nil) {
        if let id { if failure?.id == id { failure = nil } }
        else { failure = nil }
        for i in items where i.status == .failed && (id == nil || i.id == id) {
            if var e = entries[i.id] { e.attempts = 0; e.refusal = nil; entries[i.id] = e; persist(e.business) }
            set(i.id, .saving)
            run(i.id)
        }
    }

    func dismissFailure() { failure = nil }
    func clearNotice() { notice = nil }

    /// Back in front: load what a kill left, and try again what had given up waiting.
    func resume() {
        for b in Businesses.shared.list where !loaded.contains(b.id) { load(b.id) }
        nudge += 1
        for i in items where i.status == .retrying || i.status == .waiting || (i.status == .saving && !running.contains(i.id)) { run(i.id) }
    }

    // MARK: Warm-up

    /// The first real tap should not pay a cold start: a cheap read of /api/app/me, at most once a minute.
    func warm() {
        guard !House.isDemo, Date().timeIntervalSince(lastWarm) > 60 else { return }
        lastWarm = Date()
        Task.detached(priority: .utility) { _ = try? await ERPAPI.shared.data("/api/app/me", timeout: 10) }
    }

    // MARK: Running

    private func run(_ id: String) {
        if entries[id]?.durable == true { runDurable(id); return }
        guard running.insert(id).inserted else { return }
        Task { [weak self] in
            guard let self else { return }
            var attempt = self.entries[id]?.attempts ?? 0
            var lostTries = 0
            while true {
                if self.items.first(where: { $0.id == id })?.status == .waiting { self.set(id, .saving) }
                do {
                    let said = try await self.attemptOnce(id)
                    self.finish(id, said: said)
                    return
                } catch let e as ERPAPI.Failure where e.status == 409 {
                    // "Already recorded": the earlier try went through.
                    self.finish(id, said: nil)
                    return
                } catch {
                    let status = (error as? ERPAPI.Failure)?.status ?? 0
                    // No line is not a failure: a change waits for it as long as it takes (a named write is the same change
                    // however often it is sent). A post that may have gone out is not repeated; only one that never left.
                    let lost = self.posts[id] != nil ? Connection.neverLeft(error) : Connection.lost(error)
                    if lost {
                        lostTries += 1
                        self.set(id, .waiting)
                        await self.pause(Self.waitBackoff(lostTries))
                        if self.items.first(where: { $0.id == id }) == nil { self.running.remove(id); return }
                        continue
                    }
                    // 4xx other than a timeout/rate limit/expired token is a refusal: no retry will change it.
                    let refused = (400..<500).contains(status) && ![401, 408, 425, 429].contains(status)
                    attempt += 1
                    if var en = self.entries[id] { en.attempts = attempt; self.entries[id] = en; self.persist(en.business) }
                    if refused || attempt > Self.backoff.count {
                        self.running.remove(id)
                        self.fail(id: id, label: self.items.first { $0.id == id }?.label ?? "", message: error.localizedDescription)
                        return
                    }
                    self.set(id, .retrying)
                    try? await Task.sleep(for: .seconds(Self.backoff[attempt - 1]))
                    if self.items.first(where: { $0.id == id }) == nil { self.running.remove(id); return }
                }
            }
        }
    }

    // MARK: Running a kept change

    /// A kept creation or payment: one at a time per phone in the order made, waiting for the line without a limit,
    /// stopped only by a refusal (4xx), which keeps it here with its data (`fail`, said app-wide with Retry).
    private func runDurable(_ id: String) {
        guard running.insert(id).inserted else { return }
        Task { [weak self] in
            guard let self else { return }
            var lostTries = 0
            var serverTries = 0
            while true {
                guard self.items.contains(where: { $0.id == id }) else { self.running.remove(id); return }
                // The earlier ones first: sales are numbered in the order they were taken.
                if self.hasEarlier(id) { try? await Task.sleep(for: .milliseconds(500)); continue }
                self.set(id, Connection.shared.isOffline ? .waiting : .saving)
                do {
                    let out = try await self.attemptDurable(id)
                    self.finishDurable(id, out)
                    return
                } catch {
                    guard self.items.contains(where: { $0.id == id }) else { self.running.remove(id); return }
                    let said = error as? ERPAPI.Failure
                    let status = said?.status ?? 0
                    // The ERP is still recording the earlier try (a timeout whose answer was lost): ask again shortly and it
                    // answers with what it recorded.
                    let busy = status == 409 && (said?.message.hasPrefix("This was already sent") ?? false)
                    if Connection.lost(error) || busy || [401, 408, 425, 429].contains(status) {
                        lostTries += 1
                    } else if status >= 500 {
                        serverTries += 1
                        if serverTries > 5 { self.refuse(id, error); return }
                    } else {
                        // A refusal (not in stock any more, a bad request, the app out of date): no retry changes it.
                        self.refuse(id, error)
                        return
                    }
                    self.set(id, .waiting)
                    await self.pause(Self.waitBackoff(lostTries + serverTries))
                }
            }
        }
    }

    private func refuse(_ id: String, _ error: Error) {
        running.remove(id)
        if var e = entries[id] { e.refusal = error.localizedDescription; entries[id] = e; persist(e.business) }
        fail(id: id, label: items.first { $0.id == id }?.label ?? "", message: error.localizedDescription)
    }

    /// Earlier kept changes of this business that are still to go (a refused one does not hold the rest back).
    private func hasEarlier(_ id: String) -> Bool {
        guard let me = entries[id] else { return false }
        for e in entries.values where e.id != id && e.durable == true && e.business == me.business && e.createdAt < me.createdAt {
            if items.first(where: { $0.id == e.id })?.status != .failed { return true }
        }
        return false
    }

    private func attemptDurable(_ id: String) async throws -> [String: Any] {
        guard let e = entries[id] else { return [:] }
        let fields = (try? JSONSerialization.jsonObject(with: e.fields)) as? [String: Any] ?? [:]
        // Never the open business's by default: a change goes only to the business it was made in.
        guard let biz = Businesses.shared.business(e.business) else {
            throw ERPAPI.Failure(status: 0, message: "That business isn't on this phone any more.", offline: true)
        }
        if let route = e.route {
            // A long send answers `partial` and is asked again until it has all gone (the ERP carries on, never repeats).
            var last: [String: Any] = [:]
            for _ in 0..<12 {
                last = try await ERPAPI.shared.send(route, method: "POST", fields, timeout: 130, business: biz)
                if last["partial"] as? Bool != true { break }
            }
            return last
        }
        return try await ERPAPI.shared.write(e.op, fields, requestId: e.id, business: biz, queueOffline: false)
    }

    private func finishDurable(_ id: String, _ out: [String: Any]) {
        running.remove(id)
        guard let e = entries[id] else { return }
        if let intent = e.intent { WriteIntents.clear(intent, business: e.business) }
        remove(id)
        if failure?.id == id { failure = nil }
        let sent = (out["order"] as? [String: Any])?["id"] as? String ?? (out["invoice"] as? [String: Any])?["id"] as? String
        let title: String
        switch e.summary?.kind ?? "" {
        case "order": title = sent.map { "Order \($0) sent" } ?? "Order for \(e.summary?.title ?? "") sent"
        case "invoice": title = sent.map { "Invoice \($0) sent" } ?? "Sale to \(e.summary?.title ?? "") sent"
        default:
            if let said = out["said"] as? String, !said.isEmpty { title = said } else { title = "\(e.label) sent" }
        }
        notice = Note(title: title, detail: "")
    }

    /// Waits up to `seconds`, less if something wakes the queue (`nudge`).
    private func pause(_ seconds: Double) async {
        let seen = nudge
        var left = seconds
        while left > 0 && nudge == seen {
            try? await Task.sleep(for: .seconds(1))
            left -= 1
        }
    }

    /// 3, 8, 20, 45 seconds, then every minute: the line coming back wakes it sooner.
    private static func waitBackoff(_ tries: Int) -> Double {
        let steps: [Double] = [3, 8, 20, 45]
        return tries <= steps.count ? steps[max(0, tries - 1)] : 60
    }

    private func attemptOnce(_ id: String) async throws -> String? {
        if let request = posts[id] { return try await request() }
        guard let e = entries[id] else { return nil }
        let fields = (try? JSONSerialization.jsonObject(with: e.fields)) as? [String: Any] ?? [:]
        let biz = Businesses.shared.business(e.business) ?? House.business
        // This is the queue itself: a change that cannot go waits here, it is never queued a second time.
        try await ERPAPI.shared.write(e.op, fields, requestId: e.id, business: biz, queueOffline: false)
        return nil
    }

    private func finish(_ id: String, said: String?) {
        running.remove(id)
        remove(id)
        if let said, !said.isEmpty { notice = Note(title: said, detail: "") }
        if failure?.id == id { failure = nil }
    }

    private func fail(id: String, label: String, message: String) {
        var item = Item(id: id, label: label, status: .failed, message: message)
        if let i = items.firstIndex(where: { $0.id == id }) { items[i].status = .failed; items[i].message = message; item = items[i] }
        else { items.append(item) }
        failure = item
    }

    private func set(_ id: String, _ s: Status) {
        if let i = items.firstIndex(where: { $0.id == id }) { items[i].status = s }
    }

    private func remove(_ id: String) {
        items.removeAll { $0.id == id }
        posts[id] = nil
        if let e = entries.removeValue(forKey: id) { persist(e.business) }
    }

    // MARK: Disk (Application Support, file-protected, one file per business)

    private func file(_ business: String) -> URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        let safe = business.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        return dir.appendingPathComponent("outbox-\(safe).json")
    }

    private func persist(_ business: String) {
        guard let url = file(business) else { return }
        let mine = entries.values.filter { $0.business == business }.sorted { $0.createdAt < $1.createdAt }
        if mine.isEmpty { try? FileManager.default.removeItem(at: url); return }
        guard let data = try? JSONEncoder().encode(mine) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func load(_ business: String) {
        loaded.insert(business)
        guard let url = file(business), let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode([Entry].self, from: data) else { return }
        for e in saved where entries[e.id] == nil {
            entries[e.id] = e
            let kept = e.durable == true
            if kept, let refusal = e.refusal {
                // Refused before the app was closed: kept as it was, said again in Waiting to send, not sent at every launch.
                items.append(Item(id: e.id, label: e.label, status: .failed, message: refusal, summary: e.summary,
                                  business: e.business, createdAt: e.createdAt, durable: true))
                continue
            }
            items.append(Item(id: e.id, label: e.label, status: kept ? .waiting : .saving, summary: e.summary,
                              business: e.business, createdAt: e.createdAt, durable: kept))
            run(e.id)
        }
    }
}

// MARK: - App-wide presenter

extension View {
    /// At the root: the Outbox's failure with Retry, and a finished post's words.
    func outboxToast() -> some View { modifier(OutboxPresenter()) }
}

private struct OutboxPresenter: ViewModifier {
    @State private var outbox = Outbox.shared
    @State private var said: Note?
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content
            // Offline, or something still to send: one slim capsule over the app, whatever screen is open.
            .safeAreaInset(edge: .top, spacing: 0) { OfflineCapsule() }
            .sheet(isPresented: Binding(get: { outbox.queueOpen }, set: { outbox.queueOpen = $0 })) { WaitingToSendSheet() }
            .task { outbox.resume() }
            .overlay(alignment: .bottom) {
                if let f = outbox.failure {
                    HStack(spacing: pt(10)) {
                        NoteBanner(note: Note(title: f.isPost ? "\(f.label) failed" : "Not saved: \(f.label)", detail: f.message.isEmpty ? "Tap to retry." : f.message + " Tap to retry.", failed: true))
                        Button("Retry") { Motion.run(Motion.exit, reduce: reduce) { outbox.retry(f.id) } }
                            .buttonStyle(.borderedProminent)
                    }
                    .onTapGesture { outbox.retry(f.id) }
                    .frame(maxWidth: 560)
                    .padding(.horizontal)
                    .padding(.bottom, pt(64))
                    .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    .accessibilityAction(named: "Retry") { outbox.retry(f.id) }
                }
            }
            .motion(outbox.failure)
            .noteToast($said)
            .onChange(of: outbox.notice) { _, n in
                guard let n else { return }
                Note.show(n, in: $said, reduce: reduce)
                outbox.clearNotice()
            }
    }
}
