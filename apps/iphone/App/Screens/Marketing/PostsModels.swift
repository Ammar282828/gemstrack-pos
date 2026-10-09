import Foundation
import ERPCore

// The Posts hub's answers, read as leniently as the web reads them (src/app/posts/page.tsx): a
// missing or odd field gives a default, never an error that would empty the hub (CONVENTIONS.md rule 2).

/// A piece on the house's own website (src/lib/website/site-pieces.ts `SitePiece`), with what the phone shows.
struct PostPiece: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// The piece's page on the site.
    let url: String
    let image: String
    let thumb: String
    let collection: String
    let weightGrams: Double?
    let facts: [String]
    let about: String
    /// When it went on the site, epoch milliseconds, if the site says.
    let added: Double?
    let newArrival: Bool
    let hidden: Bool

    private enum K: String, CodingKey {
        case id, name, url, image, thumb, collection, weightGrams, facts, about, added, newArrival, hidden
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        url = c.string(.url, default: "")
        image = c.string(.image, default: "")
        let small = c.string(.thumb, default: "")
        thumb = small.isEmpty ? c.string(.image, default: "") : small
        collection = c.string(.collection, default: "")
        weightGrams = c.double(.weightGrams)
        facts = c.strings(.facts)
        about = c.string(.about, default: "")
        added = c.double(.added)
        newArrival = c.bool(.newArrival, default: false)
        hidden = c.bool(.hidden, default: false)
    }
}

/// /api/website/site-pieces: the site, its pieces, and when each last went to WhatsApp.
struct PostPiecesAnswer: Decodable {
    let site: String
    let pieces: [PostPiece]
    let posted: [String: String]

    private enum K: String, CodingKey { case site, pieces, posted }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        site = c.string(.site, default: "")
        pieces = c.list(.pieces, of: PostPiece.self).filter { (p: PostPiece) in !p.id.isEmpty }
        let raw = (try? c.decodeIfPresent([String: Lossy<LenientString>].self, forKey: .posted)) ?? [:]
        var out: [String: String] = [:]
        for (key, value) in raw { if let v = value.value?.value { out[key] = v } }
        posted = out
    }
}

/// One thing that went out (src/lib/social/sent-log.ts `Sent`): a piece and the places it went.
struct PostSent: Decodable, Identifiable, Hashable {
    let key: String
    let at: String
    let title: String
    let sitePiece: String?
    /// Log names ("whatsapp-community", "whatsapp-channel", "whatsapp-group:diamonds", "instagram-story").
    let destinations: [String]
    var id: String { key + "|" + at }

    private enum K: String, CodingKey { case key, at, title, sitePiece, destinations }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        at = c.string(.at, default: "")
        title = c.string(.title, default: "")
        sitePiece = c.string(.sitePiece)
        destinations = c.strings(.destinations)
    }
}

struct PostSentAnswer: Decodable {
    let sent: [PostSent]
    private enum K: String, CodingKey { case sent }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sent = c.list(.sent, of: PostSent.self).filter { (s: PostSent) in !s.at.isEmpty }
    }
}

/// A piece waiting to go, scheduled, or lately sent (src/lib/social/queue.ts `QueueItemView`).
struct PostQueueEntry: Decodable, Identifiable, Hashable {
    let id: String
    /// draft, held, scheduled, sending, sent, failed.
    let status: String
    let dueAt: String?
    let createdAt: String
    let sentAt: String?
    let headline: String
    /// A small JPEG as a data address.
    let thumb: String?
    let toWebsite: Bool
    let toInstagram: Bool
    /// WhatsApp destination keys.
    let whatsapp: [String]
    /// How many single sends it makes, and how many have gone.
    let units: Int
    let done: Int
    let lastError: String?
    /// What the send sheet shows before anything goes: the caption, the website's collection and photo names,
    /// how many photos each place gets, and each send ("site-0", "featured", "instagram", "wa:<key>:<n>"), with
    /// what has gone and what failed (queue.ts `units`, `done`, `errors`).
    let caption: String
    let websiteCollection: String
    let websiteNames: [String]
    let websiteFeatured: Bool
    let sitePhotos: Int
    let waPhotos: Int
    let unitKeys: [String]
    let doneKeys: Set<String>
    let unitErrors: [String: String]

    private enum K: String, CodingKey {
        case id, status, dueAt, createdAt, sentAt, headline, thumb, website, instagram, whatsapp, units, done, errors, caption, counts
    }

    private struct Site: Decodable {
        let collection: String
        let names: [String]
        let featured: Bool
        private enum S: String, CodingKey { case collection, names, featured }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: S.self)
            collection = c.string(.collection, default: "")
            names = c.strings(.names)
            featured = c.bool(.featured, default: false)
        }
    }

    private struct Counts: Decodable {
        let site: Int
        let wa: Int
        private enum N: String, CodingKey { case site, wa }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: N.self)
            site = Int(c.double(.site, default: 0))
            wa = Int(c.double(.wa, default: 0))
        }
    }

    private struct Failed: Decodable {
        let message: String
        private enum E: String, CodingKey { case message }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: E.self)
            message = c.string(.message, default: "")
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        status = c.string(.status, default: "")
        dueAt = c.string(.dueAt)
        createdAt = c.string(.createdAt, default: "")
        sentAt = c.string(.sentAt)
        headline = c.string(.headline, default: "")
        thumb = c.string(.thumb)
        toWebsite = ((try? c.decodeNil(forKey: .website)) ?? true) == false
        toInstagram = c.bool(.instagram, default: false)
        whatsapp = c.strings(.whatsapp)
        unitKeys = c.list(.units, of: LenientString.self).map { (u: LenientString) in u.value }
        units = unitKeys.count
        let finished = (try? c.decodeIfPresent([String: Lossy<LenientString>].self, forKey: .done)) ?? [:]
        doneKeys = Set(finished.keys)
        done = finished.count
        let problems = (try? c.decodeIfPresent([String: Lossy<Failed>].self, forKey: .errors)) ?? [:]
        var said: [String: String] = [:]
        for (unit, f) in problems { if let m = f.value?.message, !m.isEmpty { said[unit] = m } }
        unitErrors = said
        lastError = problems.values.compactMap { (f: Lossy<Failed>) in f.value?.message }.first
        caption = c.string(.caption, default: "")
        let site = c.object(.website, of: Site.self)
        websiteCollection = site?.collection ?? ""
        websiteNames = site?.names ?? []
        websiteFeatured = site?.featured ?? false
        let counts = c.object(.counts, of: Counts.self)
        sitePhotos = counts?.site ?? 0
        waPhotos = counts?.wa ?? 0
    }
}

struct PostQueueAnswer: Decodable {
    let items: [PostQueueEntry]
    private enum K: String, CodingKey { case items }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        items = c.list(.items, of: PostQueueEntry.self).filter { (e: PostQueueEntry) in !e.id.isEmpty }
    }
}

/// One check of the posting lines (src/lib/social/health.ts `Check`).
struct PostCheck: Decodable, Identifiable, Hashable {
    let id: String
    let group: String
    let label: String
    /// ok, warn, fail, off.
    let status: String
    let detail: String
    let fix: String?

    private enum K: String, CodingKey { case id, group, label, status, detail, fix }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        group = c.string(.group, default: "")
        label = c.string(.label, default: "")
        status = c.string(.status, default: "")
        detail = c.string(.detail, default: "")
        fix = c.string(.fix)
    }
}

struct PostChecksAnswer: Decodable {
    let checks: [PostCheck]
    private enum K: String, CodingKey { case checks }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        checks = c.list(.checks, of: PostCheck.self)
    }
}

/// Today's gold post, as the routine filed it (Taheri's Investments; src/lib/investments.ts).
struct PostGold: Decodable, Hashable {
    let date: String
    /// Part (group, channel, teaser, instagram) → when it went.
    let sent: [String: String]

    private enum K: String, CodingKey { case date, sent }

    private struct Went: Decodable {
        let at: String
        private enum E: String, CodingKey { case at }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: E.self)
            at = c.string(.at, default: "")
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        let raw = (try? c.decodeIfPresent([String: Lossy<Went>].self, forKey: .sent)) ?? [:]
        var out: [String: String] = [:]
        for (part, went) in raw { if let at = went.value?.at { out[part] = at } }
        sent = out
    }
}

struct PostGoldAnswer: Decodable {
    let posts: [PostGold]
    let today: String
    private enum K: String, CodingKey { case posts, today }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        posts = c.list(.posts, of: PostGold.self)
        today = c.string(.today, default: "")
    }
}

/// /api/investments/schedule: which parts of the gold post this shop can send at all.
struct PostGoldParts: Decodable {
    let destinations: [String: Bool]
    private enum K: String, CodingKey { case destinations }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let raw = (try? c.decodeIfPresent([String: Lossy<Bool>].self, forKey: .destinations)) ?? [:]
        var out: [String: Bool] = [:]
        for (part, on) in raw { out[part] = on.value ?? false }
        destinations = out
    }
}

/// /api/website/post: where a post goes, to name the places in the day's list.
struct PostAudience: Decodable {
    struct Place: Decodable, Hashable {
        let key: String
        let label: String
        let name: String
        private enum K: String, CodingKey { case key, label, name }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            key = c.string(.key, default: "")
            label = c.string(.label, default: "")
            name = c.string(.name, default: "")
        }
    }

    let communityName: String?
    let groups: [Place]

    private enum K: String, CodingKey { case community, groups }
    private struct Named: Decodable {
        let name: String
        private enum E: String, CodingKey { case name }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: E.self)
            name = c.string(.name, default: "")
        }
    }

    init() { communityName = nil; groups = [] }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        communityName = c.object(.community, of: Named.self)?.name
        groups = c.list(.groups, of: Place.self)
    }
}
