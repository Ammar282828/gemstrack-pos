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
    static let shared = PostsStore()

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
        do {
            let a = try await ERPAPI.shared.get("/api/website/site-pieces", as: PostPiecesAnswer.self)
            site = a.site
            pieces = a.pieces.filter { (p: PostPiece) in !p.hidden }
            posted = a.posted
            piecesPhase = .loaded
        } catch let f as ERPAPI.Failure where f.status == 404 {
            piecesPhase = .off
        } catch {
            if pieces.isEmpty { piecesPhase = .failed(error.localizedDescription) }
        }
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
        default:
            if log.hasPrefix("whatsapp-group:") {
                let key = String(log.dropFirst("whatsapp-group:".count))
                return audience.groups.first { (g: PostAudience.Place) in g.key == key }?.label ?? key
            }
            return log
        }
    }

    /// A queued piece's places in words: "Website, Instagram story, Announcements, Channel".
    func queueWhere(_ e: PostQueueEntry) -> String {
        var places: [String] = []
        if e.toWebsite { places.append("Website") }
        if e.toInstagram { places.append("Instagram story") }
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
