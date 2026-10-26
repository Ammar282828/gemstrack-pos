import SwiftUI
import Observation
import ERPCore

/// What the Posts hub and its pieces screens read: the day's sends, the queue, the website's pieces,
/// Taheri's gold post and the posting lines' checks. One copy for the whole app, so the pieces
/// screen opens on what the hub already fetched. Every route here is the web hub's own
/// (src/app/posts/page.tsx), gated by the same `postGate`: owners, staff and marketing accounts.
@MainActor
@Observable
final class PostsStore {
    /// Replaced, not cleared, when the person switches business (Businesses.switch): none of it is the next one's.
    static var shared = PostsStore()
    static func reset() { shared = PostsStore() }

    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
        /// The house does not post its website's pieces (404 from the route): nothing to show, nothing wrong.
        case off
    }

    private(set) var piecesPhase: Phase = .idle
    private(set) var pieces: [PostPiece] = []
    private(set) var site = ""
    /// Set when the list on screen is the one kept on the phone because the website could not be read just now (when that list was read).
    private(set) var shownFrom: Date?
    private(set) var posted: [String: String] = [:]
    /// nil until the first answer; an empty list is "nothing in the last two days".
    private(set) var sent: [PostSent]?
    private(set) var queue: [PostQueueEntry] = []
    private(set) var checks: [PostCheck] = []
    private(set) var gold: PostGold?
    private(set) var goldParts: [String] = []
    private(set) var audience = PostAudience()
    private(set) var sentError: String?

    @ObservationIgnored private var loading = false
    @ObservationIgnored private var checksAt: Date?
    @ObservationIgnored private var audienceAt: Date?

    /// Everything the hub shows. The checks and the audience's names ask WhatsApp and Meta, which can take
    /// a while, so they arrive on their own and never hold the pull-to-refresh.
    func load(gold wantsGold: Bool = false) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if piecesPhase == .idle { piecesPhase = .loading }
        Task { await self.loadAudience() }
        Task { await self.loadChecks() }
        async let a: Void = loadPieces()
        async let b: Void = loadSent()
        async let c: Void = loadQueue()
        async let d: Void = loadGold(wantsGold)
        _ = await (a, b, c, d)
    }

    // MARK: Reads

    private func loadPieces() async {
        let path = "/api/website/site-pieces?lean=1"
        let biz = House.business
        // The last list this business read, kept on the phone: From the website paints at once and is refreshed behind it.
        if pieces.isEmpty, let kept = Self.kept(biz.id), let a = try? JSONDecoder().decode(PostPiecesAnswer.self, from: kept.data) {
            site = a.site
            pieces = a.pieces.filter { (p: PostPiece) in !p.hidden }
            posted = a.posted
            piecesPhase = .loaded
            shownFrom = kept.at
        }
        do {
            // 45 seconds, not 15: a long list on a shop's mobile line (House of Mina's is 85 KB packed, 1.3 MB if the line does not pack it).
            let raw = try await ERPAPI.shared.data(path, timeout: 45)
            let a = try JSONDecoder().decode(PostPiecesAnswer.self, from: raw)
            site = a.site
            pieces = a.pieces.filter { (p: PostPiece) in !p.hidden }
            posted = a.posted
            piecesPhase = .loaded
            shownFrom = nil
            Self.keep(raw, for: biz.id)
        } catch let f as ERPAPI.Failure where f.status == 404 {
            piecesPhase = .off
        } catch {
            // A screen that left mid-read (its task cancelled) is not a failure to show: the next screen reads again.
            let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
            if pieces.isEmpty { piecesPhase = cancelled ? .idle : .failed(Self.said(error)) }
            else if !cancelled, shownFrom == nil { shownFrom = Date() }
        }
    }

    // MARK: The list kept on the phone

    private static func file(_ business: String) -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("erp.sitePieces.\(business).json")
    }

    private static func keep(_ data: Data, for business: String) {
        guard let url = file(business) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private static func kept(_ business: String) -> (data: Data, at: Date)? {
        guard let url = file(business), let data = try? Data(contentsOf: url) else { return nil }
        let at = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
        return (data, at)
    }

    /// The ERP's own words when it gave any (its `error`), else what the phone's line said, never a bare "The data couldn't be read".
    private static func said(_ error: Error) -> String {
        if error is DecodingError { return "The website's pieces came back in a shape this app could not read. Pull to refresh; if it stays, tell the shop." }
        return error.localizedDescription
    }

    private func loadSent() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/post/recent", as: PostSentAnswer.self)
            sent = a.sent
            sentError = nil
        } catch {
            if sent == nil { sentError = error.localizedDescription }
        }
    }

    private func loadQueue() async {
        if let a = try? await ERPAPI.shared.get("/api/website/post/queue", as: PostQueueAnswer.self) { queue = a.items }
    }

    /// The checks reach out to WhatsApp, Instagram, the site and the AI (up to a minute); the web page runs them
    /// when it opens, here they are asked again after ten minutes.
    private func loadChecks() async {
        if let at = checksAt, Date().timeIntervalSince(at) < 600 { return }
        if let a = try? await ERPAPI.shared.get("/api/website/post/health", as: PostChecksAnswer.self) {
            checks = a.checks
            checksAt = Date()
        }
    }

    /// The groups' names change rarely; once an hour is plenty.
    private func loadAudience() async {
        if let at = audienceAt, Date().timeIntervalSince(at) < 3600 { return }
        if let a = try? await ERPAPI.shared.get("/api/website/post", as: PostAudience.self) {
            audience = a
            audienceAt = Date()
        }
    }

    /// Today's gold post and which of its parts this shop sends (the routine files it; the page and the
    /// schedule send it). Where the shop has no Investments the hub never asks.
    private func loadGold(_ wanted: Bool) async {
        guard wanted else { return }
        guard let a = try? await ERPAPI.shared.get("/api/investments", as: PostGoldAnswer.self) else { return }
        gold = a.posts.first { (p: PostGold) in p.date == a.today }
        let parts = try? await ERPAPI.shared.get("/api/investments/schedule", as: PostGoldParts.self)
        // The channel only where WhatsApp's channel is set up (lib/investments-schedule.ts: dest ? dest[t] : t !== 'channel').
        goldParts = PostsStore.goldOrder.filter { (t: String) in
            if let known = parts?.destinations[t] { return known }
            return t != "channel"
        }
    }

    static let goldOrder = ["group", "channel", "teaser", "instagram"]
    static let goldWords = ["group": "Group", "channel": "Channel", "teaser": "Teaser", "instagram": "Story"]

    // MARK: What the screens ask

    func piece(_ id: String) -> PostPiece? { pieces.first { (p: PostPiece) in p.id == id } }

    /// What went out today (Karachi's day), newest first as the server sends it.
    var sentToday: [PostSent] { (sent ?? []).filter { (s: PostSent) in MarketingTime.isToday(s.at) } }

    /// The latest send of an earlier day, for "the last was …" on a quiet day.
    var lastEarlier: PostSent? { (sent ?? []).first { (s: PostSent) in !MarketingTime.isToday(s.at) } }

    /// The queue as the web hub shows it: what is still to go, and what went today. Failed first, then
    /// what is going, then by the time it is due, then what is held.
    var queueShown: [PostQueueEntry] {
        let shown = queue.filter { (e: PostQueueEntry) in
            e.status != "sent" || MarketingTime.isToday(e.sentAt ?? e.createdAt)
        }
        func rank(_ e: PostQueueEntry) -> Int {
            switch e.status {
            case "failed": return 0
            case "sending": return 1
            case "scheduled": return 2
            case "held": return 3
            case "draft": return 4
            default: return 5
            }
        }
        return shown.sorted { (a: PostQueueEntry, b: PostQueueEntry) in
            if rank(a) != rank(b) { return rank(a) < rank(b) }
            return (a.dueAt ?? a.createdAt) < (b.dueAt ?? b.createdAt)
        }
    }

    var failingChecks: [PostCheck] { checks.filter { (c: PostCheck) in c.status == "fail" } }

    /// A send log's name for a place, in the counter's words (page.tsx `placeName`).
    func placeName(_ log: String) -> String {
        switch log {
        case "whatsapp-community":
            return audience.groups.first { (g: PostAudience.Place) in g.name == audience.communityName }?.label ?? "Announcements"
        case "whatsapp-channel":
            return "Channel"
        case "instagram-story":
            return "Instagram story"
        case "instagram-post":
            return "Instagram post"
        default:
            if log.hasPrefix("whatsapp-group:") {
                let key = String(log.dropFirst("whatsapp-group:".count))
                return audience.groups.first { (g: PostAudience.Place) in g.key == key }?.label ?? key
            }
            return log
        }
    }

    // MARK: The queue's actions (the web hub's own routes; the sending itself is the server's, once)

    /// A WhatsApp destination's name, as the counter knows it.
    func placeLabel(_ key: String) -> String {
        if key == "channel" { return "Channel" }
        return audience.groups.first { (g: PostAudience.Place) in g.key == key }?.label ?? key
    }

    func refreshQueue() async { await loadQueue() }

    /// The tray asks again on opening: a group added or renamed since shows at once.
    func refreshAudience() async {
        audienceAt = nil
        await loadAudience()
    }

    /// After the tray sends: the day's list, and the pieces' "posted" and the weights the site now keeps.
    func afterSending() async {
        async let a: Void = loadSent()
        async let b: Void = loadPieces()
        _ = await (a, b)
    }

    /// What Send all and Spread over the day act on (queue-panel.tsx `pending`): held, scheduled or failed, in the queue's order.
    var waiting: [PostQueueEntry] {
        queue.filter { (e: PostQueueEntry) in ["held", "scheduled", "failed"].contains(e.status) }
    }

    /// Spread over the day: each waiting piece its own time (PATCH /queue/:id), the times laid out by `spreadTimes`.
    /// The tick on the server sends them, with every screen closed. Stops at the first the server refuses.
    func spread(_ ids: [String], at times: [Date]) async throws {
        do {
            for (id, at) in zip(ids, times) {
                _ = try await ERPAPI.shared.send("/api/website/post/queue/\(id)", method: "PATCH", ["action": "schedule", "dueAt": at.ISO8601Format()])
            }
        } catch {
            await loadQueue()
            throw error
        }
        await loadQueue()
    }

    /// Send all now: each waiting piece in turn, as Send now sends one. How many went whole, of how many.
    func sendAll() async -> (sent: Int, of: Int) {
        let ids = waiting.map(\.id)
        var sent = 0
        for id in ids {
            if (try? await sendNow(id)) == true { sent += 1 }
        }
        return (sent, ids.count)
    }

    /// "Send now" (POST /queue/:id/send). Only what has not gone is sent, so a second press after a failure
    /// never posts a group twice. The server may take minutes over many groups. True when everything went.
    func sendNow(_ id: String) async throws -> Bool {
        let out = try await ERPAPI.shared.send("/api/website/post/queue/\(id)/send", [:], timeout: 310)
        await loadQueue()
        return (out["ok"] as? Bool) ?? false
    }

    /// Hold it, or give it a time (PATCH /queue/:id).
    func hold(_ id: String) async throws {
        _ = try await ERPAPI.shared.send("/api/website/post/queue/\(id)", method: "PATCH", ["action": "hold"])
        await loadQueue()
    }

    func schedule(_ id: String, at: Date) async throws {
        _ = try await ERPAPI.shared.send("/api/website/post/queue/\(id)", method: "PATCH", ["action": "schedule", "dueAt": at.ISO8601Format()])
        await loadQueue()
    }

    /// Out of the queue, with its photos (DELETE /queue/:id). Nothing that already went is taken back.
    func remove(_ id: String) async throws {
        _ = try await ERPAPI.shared.send("/api/website/post/queue/\(id)", method: "DELETE")
        await loadQueue()
    }

    /// A queued piece's places in words: "Website, Instagram story, Announcements, Channel".
    func queueWhere(_ e: PostQueueEntry) -> String {
        var places: [String] = []
        if e.toWebsite { places.append("Website") }
        if e.toInstagram { places.append("Instagram story") }
        if e.unitKeys.contains("ig-post") { places.append("Instagram post") }
        for key in e.whatsapp {
            if key == "channel" { places.append("Channel") }
            else { places.append(audience.groups.first { (g: PostAudience.Place) in g.key == key }?.label ?? key) }
        }
        return places.joined(separator: ", ")
    }

    var siteName: String {
        guard let host = URL(string: site)?.host else { return "the website" }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
