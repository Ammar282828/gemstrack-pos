import SwiftUI
import UIKit

/// Saves that do not move money leave the screen at once and finish in the background (owner, 2026-10-23: "make
/// the app snappier"). `send` returns as soon as the change is queued; the write goes through `ERPAPI.write` with
/// the name (`requestId`) kept in the entry, so every retry is the same change to the ERP. Entries are kept on disk
/// per business (a kill loses nothing), retried with backoff and again when the app comes forward, and a refusal
/// or a last failure is said app-wide with Retry. Money writes are never queued: they stay awaited (CONVENTIONS.md).
@MainActor @Observable
final class Outbox {
    static let shared = Outbox()

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

    enum Status: Equatable { case saving, retrying, failed }

    /// What a screen may show: "Saving…" while `pending > 0`, or `status(of:)` for one label.
    struct Item: Identifiable, Equatable {
        let id: String
        let label: String
        var status: Status
        var message = ""
        var isPost = false
    }

    /// A change on its way, written to disk (a post is a closure, so it lives only until the app is killed).
    private struct Entry: Codable {
        var id: String
        var op: String
        var fields: Data
        var business: String
        var label: String
        var attempts = 0
        var createdAt = Date()
    }

    private(set) var items: [Item] = []
    /// The last thing that failed for good: the root's banner shows it with Retry.
    private(set) var failure: Item?
    /// A post that finished (or a send that did): said once as a toast.
    private(set) var notice: Note?

    var pending: Int { items.filter { $0.status != .failed }.count }
    func status(of label: String) -> Status? { items.first { $0.label == label }?.status }

    @ObservationIgnored private var entries: [String: Entry] = [:]
    @ObservationIgnored private var posts: [String: () async throws -> String] = [:]
    @ObservationIgnored private var running: Set<String> = []
    @ObservationIgnored private var loaded: Set<String> = []
    @ObservationIgnored private var lastWarm: Date = .distantPast

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
        items.append(Item(id: e.id, label: label, status: .saving))
        persist(biz.id)
        run(e.id)
    }

    // MARK: Long sends

    /// A website post or any long request: runs now in the background with the same retry policy. The closure
    /// returns the words for success ("Posted to 3 places"); a thrown error is "<label> failed: …". Not kept on disk.
    func post(label: String, _ request: @escaping () async throws -> String) {
        let id = UUID().uuidString
        posts[id] = request
        items.append(Item(id: id, label: label, status: .saving, isPost: true))
        run(id)
    }

    // MARK: Retry

    /// Retry the failed one (the banner's button), or every failed one.
    func retry(_ id: String? = nil) {
        if let id { if failure?.id == id { failure = nil } }
        else { failure = nil }
        for i in items where i.status == .failed && (id == nil || i.id == id) {
            if var e = entries[i.id] { e.attempts = 0; entries[i.id] = e }
            set(i.id, .saving)
            run(i.id)
        }
    }

    func dismissFailure() { failure = nil }
    func clearNotice() { notice = nil }

    /// Back in front: load what a kill left, and try again what had given up waiting.
    func resume() {
        for b in Businesses.shared.list where !loaded.contains(b.id) { load(b.id) }
        for i in items where i.status == .retrying || (i.status == .saving && !running.contains(i.id)) { run(i.id) }
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
        guard running.insert(id).inserted else { return }
        Task { [weak self] in
            guard let self else { return }
            var attempt = self.entries[id]?.attempts ?? 0
            while true {
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

    private func attemptOnce(_ id: String) async throws -> String? {
        if let request = posts[id] { return try await request() }
        guard let e = entries[id] else { return nil }
        let fields = (try? JSONSerialization.jsonObject(with: e.fields)) as? [String: Any] ?? [:]
        let biz = Businesses.shared.business(e.business) ?? House.business
        try await ERPAPI.shared.write(e.op, fields, requestId: e.id, business: biz)
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
            items.append(Item(id: e.id, label: e.label, status: .saving))
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
            .overlay(alignment: .bottom) {
                if let f = outbox.failure {
                    HStack(spacing: 10) {
                        NoteBanner(note: Note(title: f.isPost ? "\(f.label) failed" : "Not saved: \(f.label)", detail: f.message.isEmpty ? "Tap to retry." : f.message + " Tap to retry.", failed: true))
                        Button("Retry") { Motion.run(Motion.exit, reduce: reduce) { outbox.retry(f.id) } }
                            .buttonStyle(.borderedProminent)
                    }
                    .onTapGesture { outbox.retry(f.id) }
                    .frame(maxWidth: 560)
                    .padding(.horizontal)
                    .padding(.bottom, 64)
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
