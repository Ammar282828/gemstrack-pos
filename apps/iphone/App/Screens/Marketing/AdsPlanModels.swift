import Foundation
import ERPCore

// New ad's and the ad set designer's shapes (src/lib/ads/targeting.ts AudienceDraft, plan.ts AdPlan), read
// leniently from the routes and written back as the JSON the routes take. Nothing here decides whether an ad
// can be made or what it costs: that is the server's (/api/ads/plan → lib/ads/phone-plan.ts, then the create
// routes, which check again).

/// JSON for the routes: a missing value is sent as null, as the web sends it.
enum AdsJSON {
    static func orNull(_ v: Any?) -> Any {
        guard let v else { return NSNull() }
        return v
    }
}

/// A place an ad shows in (targeting.ts GeoPick / PinPick): a country, region, city, area, postcode or a pin.
struct AdsPlace: Decodable, Hashable, Identifiable {
    var type: String
    var key: String
    var name: String
    /// "Sindh, Pakistan": tells two Hyderabads apart.
    var detail: String?
    /// Cities (and places): people within this many km of it too.
    var radiusKm: Double?
    var lat: Double?
    var lng: Double?

    var id: String { type == "pin" ? "pin:\(lat ?? 0),\(lng ?? 0)" : "\(type):\(key)" }

    static let pakistan = AdsPlace(type: "country", key: "PK", name: "Pakistan")

    init(type: String, key: String, name: String, detail: String? = nil, radiusKm: Double? = nil, lat: Double? = nil, lng: Double? = nil) {
        self.type = type
        self.key = key
        self.name = name
        self.detail = detail
        self.radiusKm = radiusKm
        self.lat = lat
        self.lng = lng
    }

    private enum K: String, CodingKey { case type, key, name, detail, radiusKm, lat, lng }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        type = c.string(.type, default: "country")
        key = c.string(.key, default: "")
        name = c.string(.name, default: "")
        detail = c.string(.detail)
        radiusKm = c.double(.radiusKm)
        lat = c.double(.lat)
        lng = c.double(.lng)
    }

    var json: [String: Any] {
        var o: [String: Any] = [:]
        o["type"] = type
        o["name"] = name
        if type == "pin" {
            o["lat"] = lat ?? 0
            o["lng"] = lng ?? 0
            o["radiusKm"] = radiusKm ?? 10
        } else {
            o["key"] = key
            if let detail, !detail.isEmpty { o["detail"] = detail }
            if let radiusKm, radiusKm > 0 { o["radiusKm"] = radiusKm }
        }
        return o
    }

    /// Meta's limit for a dropped pin: 1–80 km (targeting.ts pinRadius).
    private static func pinKm(_ km: Double?) -> Int { min(80, max(1, Int((km ?? 10).rounded()))) }

    /// "Karachi +25 km" (targeting.ts placeLabel).
    var label: String {
        if type == "pin" { return "\(name) +\(Self.pinKm(radiusKm)) km" }
        if let r = radiusKm, r > 0, type == "city" || type == "place" { return "\(name) +\(Int(r.rounded())) km" }
        return name
    }
}

/// An interest or one of the house's audiences, by Meta's id.
struct AdsNamed: Decodable, Hashable, Identifiable {
    let id: String
    let name: String

    init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    private enum K: String, CodingKey { case id, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: c.string(.id, default: ""))
    }

    var json: [String: Any] { ["id": id, "name": name] }
}

/// Who an ad is shown to (targeting.ts AudienceDraft); the defaults are defaultDraft()'s.
struct AdsAudience: Decodable, Hashable {
    var places: [AdsPlace] = [AdsPlace.pakistan]
    var ageMin = 18
    var ageMax = 65
    /// "all", "women" or "men".
    var gender = "all"
    var interests: [AdsNamed] = []
    var include: [AdsNamed] = []
    var exclude: [AdsNamed] = []
    /// Advantage+ audience: Meta may go beyond ages, gender and interests; places and "leave out" stay firm.
    var advantage = true
    /// "instagram", "instagram_facebook" or "auto".
    var placements = "instagram"
    var igPositions: [String] = ["stream", "story", "reels"]

    init() {}

    private enum K: String, CodingKey { case places, ageMin, ageMax, gender, interests, include, exclude, advantage, placements, igPositions }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        // An empty list stays empty (New ad then asks for a place); a missing one is the default's Pakistan.
        places = c.contains(.places) ? c.list(.places, of: AdsPlace.self) : [AdsPlace.pakistan]
        ageMin = min(65, max(18, c.int(.ageMin) ?? 18))
        ageMax = min(65, max(ageMin, c.int(.ageMax) ?? 65))
        let g = c.string(.gender, default: "all")
        gender = ["all", "women", "men"].contains(g) ? g : "all"
        interests = c.list(.interests, of: AdsNamed.self).filter { (n: AdsNamed) in !n.id.isEmpty }
        include = c.list(.include, of: AdsNamed.self).filter { (n: AdsNamed) in !n.id.isEmpty }
        exclude = c.list(.exclude, of: AdsNamed.self).filter { (n: AdsNamed) in !n.id.isEmpty }
        advantage = c.bool(.advantage, default: true)
        let p = c.string(.placements, default: "instagram")
        placements = ["instagram", "instagram_facebook", "auto"].contains(p) ? p : "instagram"
        let ig = c.strings(.igPositions)
        igPositions = ig.isEmpty ? ["stream", "story", "reels"] : ig
    }

    var json: [String: Any] {
        var o: [String: Any] = [:]
        o["places"] = places.map { (p: AdsPlace) in p.json }
        o["ageMin"] = ageMin
        o["ageMax"] = ageMax
        o["gender"] = gender
        o["interests"] = interests.map { (n: AdsNamed) in n.json }
        o["include"] = include.map { (n: AdsNamed) in n.json }
        o["exclude"] = exclude.map { (n: AdsNamed) in n.json }
        o["advantage"] = advantage
        o["placements"] = placements
        o["igPositions"] = igPositions
        return o
    }

    /// One line, as the web writes it under "Who sees it" (targeting.ts describeAudience). Words only.
    var words: String {
        var parts: [String] = []
        parts.append(places.isEmpty ? "Pakistan" : places.map { (p: AdsPlace) in p.label }.joined(separator: ", "))
        parts.append("\(ageMin)–\(ageMax >= 65 ? "65+" : String(ageMax))")
        parts.append(gender == "all" ? "everyone" : gender)
        if !interests.isEmpty { parts.append(interests.map { (n: AdsNamed) in n.name }.joined(separator: ", ")) }
        if !include.isEmpty { parts.append("in " + include.map { (n: AdsNamed) in n.name }.joined(separator: ", ")) }
        if !exclude.isEmpty { parts.append("not " + exclude.map { (n: AdsNamed) in n.name }.joined(separator: ", ")) }
        if advantage { parts.append("Advantage+") }
        parts.append(placements == "auto" ? "all placements" : (placements == "instagram" ? "Instagram only" : "Instagram and Facebook"))
        return parts.joined(separator: " · ")
    }
}

/// A budget and its dates (plan.ts AdPlan.budget). ISO strings, as the routes take them.
struct AdsBudget: Hashable {
    /// "daily" or "total".
    var kind = "daily"
    var amount = 1000.0
    var start: String?
    var end: String?

    var json: [String: Any] {
        var o: [String: Any] = [:]
        o["kind"] = kind
        o["amount"] = amount
        o["start"] = AdsJSON.orNull(start)
        o["end"] = AdsJSON.orNull(end)
        return o
    }
}

// MARK: What New ad offers (GET /api/ads/plan)

/// A goal, in the web's words (plan.ts GOALS through phone-plan.ts phoneGoals).
struct AdsGoal: Decodable, Identifiable, Hashable {
    let key: String
    let label: String
    let hint: String
    let objective: String
    let optimization: String
    let postOnly: Bool
    let photosOnly: Bool
    /// The button opens a page on the house's site.
    let toSite: Bool
    /// New ad offers it in this house.
    let newAd: Bool
    var id: String { key }

    private enum K: String, CodingKey { case key, label, hint, objective, optimization, postOnly, photosOnly, toSite, newAd }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
        hint = c.string(.hint, default: "")
        objective = c.string(.objective, default: "")
        optimization = c.string(.optimization, default: "")
        postOnly = c.bool(.postOnly, default: false)
        photosOnly = c.bool(.photosOnly, default: false)
        toSite = c.bool(.toSite, default: false)
        newAd = c.bool(.newAd, default: true)
    }
}

/// A key and its words: a button, an Instagram placement, a segment, a kind.
struct AdsChoice: Decodable, Identifiable, Hashable {
    let key: String
    let label: String
    var id: String { key }

    init(key: String, label: String) {
        self.key = key
        self.label = label
    }

    /// Where on Instagram, should the server's list not have come (targeting.ts IG_POSITIONS).
    static let instagramPlaces = [
        AdsChoice(key: "stream", label: "Feed"), AdsChoice(key: "story", label: "Stories"),
        AdsChoice(key: "reels", label: "Reels"), AdsChoice(key: "profile_feed", label: "Profile feed"),
    ]

    private enum K: String, CodingKey { case key, label }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
    }
}

/// A day the house keeps free of product ads (Taheri's Bohra calendar).
struct AdsQuietDay: Decodable, Identifiable, Hashable {
    /// "2026-06-17", a Karachi day.
    let date: String
    let hijri: String
    let name: String
    /// One of the days just before it.
    let near: Bool
    var id: String { date }

    private enum K: String, CodingKey { case date, hijri, name, near }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        hijri = c.string(.hijri, default: "")
        name = c.string(.name, default: "")
        near = c.bool(.near, default: false)
    }
}

/// GET /api/ads/plan.
struct AdsNewAdLists: Decodable {
    let goals: [AdsGoal]
    let buttons: [AdsChoice]
    let igPositions: [AdsChoice]
    let website: String
    let shop: String
    let waChannel: String
    /// The house's website pieces can be promoted (STORE_SITE_POSTS and a website).
    let sitePieces: Bool
    let quiet: [AdsQuietDay]

    private enum K: String, CodingKey { case goals, buttons, igPositions, links, sitePieces, quiet }
    private enum L: String, CodingKey { case website, shop, waChannel }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        goals = c.list(.goals, of: AdsGoal.self).filter { (g: AdsGoal) in !g.key.isEmpty }
        buttons = c.list(.buttons, of: AdsChoice.self)
        igPositions = c.list(.igPositions, of: AdsChoice.self)
        if let l = try? c.nestedContainer(keyedBy: L.self, forKey: .links) {
            website = l.string(.website, default: "")
            shop = l.string(.shop, default: "")
            waChannel = l.string(.waChannel, default: "")
        } else {
            website = ""
            shop = ""
            waChannel = ""
        }
        sitePieces = c.bool(.sitePieces, default: false)
        quiet = c.list(.quiet, of: AdsQuietDay.self)
    }

    func goal(_ key: String) -> AdsGoal? { goals.first { (g: AdsGoal) in g.key == key } }
}

/// POST /api/ads/plan { plan }: what stops it, planSummary's lines, the name it will have, and who sees it.
struct AdsPlanCheck: Decodable {
    let problems: [String]
    let summary: [String]
    let name: String
    let audience: String

    private enum K: String, CodingKey { case problems, summary, name, audience }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        problems = c.strings(.problems)
        summary = c.strings(.summary)
        name = c.string(.name, default: "")
        audience = c.string(.audience, default: "")
    }
}

/// POST /api/ads/plan { design }.
struct AdsDesignCheck: Decodable {
    let problems: [String]
    let summary: [String]
    let count: Int

    private enum K: String, CodingKey { case problems, summary, count }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        problems = c.strings(.problems)
        summary = c.strings(.summary)
        count = c.int(.count) ?? 0
    }
}

// MARK: What to promote

/// An Instagram post or reel (/api/ads/media).
struct AdsMedia: Decodable, Identifiable, Hashable {
    let id: String
    let caption: String
    /// IMAGE, VIDEO, REEL, CAROUSEL_ALBUM.
    let type: String
    let thumb: String?
    let permalink: String?
    /// Meta's word on whether it can be boosted; nil when it didn't say.
    let boostable: Bool?
    let why: String?

    init(id: String, caption: String, thumb: String?, permalink: String?) {
        self.id = id
        self.caption = caption
        self.type = "IMAGE"
        self.thumb = thumb
        self.permalink = permalink
        self.boostable = true
        self.why = nil
    }

    private enum K: String, CodingKey { case id, caption, type, thumb, permalink, boostable, why }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        caption = c.string(.caption, default: "")
        type = c.string(.type, default: "IMAGE")
        thumb = c.string(.thumb)
        permalink = c.string(.permalink)
        boostable = c.bool(.boostable)
        why = c.string(.why)
    }

    var kindWord: String? {
        switch type {
        case "IMAGE": return nil
        case "REEL": return "Reel"
        case "CAROUSEL_ALBUM": return "Carousel"
        default: return "Video"
        }
    }
}

struct AdsMediaAnswer: Decodable {
    let media: [AdsMedia]
    let after: String?

    private enum K: String, CodingKey { case media, after }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        media = c.list(.media, of: AdsMedia.self).filter { (m: AdsMedia) in !m.id.isEmpty }
        after = c.string(.after)
    }
}

/// A picture already in the ad account's library (/api/ads/library).
struct AdsLibraryImage: Decodable, Identifiable, Hashable {
    let hash: String
    let url: String
    let thumb: String
    let name: String
    var id: String { hash }

    private enum K: String, CodingKey { case hash, url, thumb, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        hash = c.string(.hash, default: "")
        url = c.string(.url, default: "")
        let small = c.string(.thumb, default: "")
        thumb = small.isEmpty ? url : small
        name = c.string(.name, default: "")
    }
}

struct AdsLibraryAnswer: Decodable {
    let images: [AdsLibraryImage]
    let after: String?

    private enum K: String, CodingKey { case images, after }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        images = c.list(.images, of: AdsLibraryImage.self).filter { (i: AdsLibraryImage) in !i.hash.isEmpty }
        after = c.string(.after)
    }
}

/// /api/ads/images: the photo in the ad account's library, by its hash.
struct AdsImageAnswer: Decodable {
    let hash: String
    let url: String?

    private enum K: String, CodingKey { case hash, url }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        hash = c.string(.hash, default: "")
        url = c.string(.url)
    }
}

/// A photo of a new ad, as the screen holds it: on its way to Meta, there with its hash, or refused.
struct AdsPhoto: Identifiable {
    let key: String
    var hash = ""
    /// Meta's copy, once there (the library's, or the template's).
    var url: String?
    /// A small picture to show for it (the library's or the website's thumbnail), when there is no `preview`.
    var thumb: String?
    /// What was picked on this phone, shown while it uploads.
    var preview: Data?
    /// A carousel card's own headline and link.
    var headline = ""
    var link = ""
    var uploading = false
    var error: String?
    var id: String { key }

    var ready: Bool { !hash.isEmpty && error == nil && !uploading }

    var json: [String: Any] {
        var o: [String: Any] = [:]
        o["hash"] = hash
        o["url"] = AdsJSON.orNull(url)
        if !headline.trimmingCharacters(in: .whitespaces).isEmpty { o["headline"] = headline }
        if !link.trimmingCharacters(in: .whitespaces).isEmpty { o["link"] = link }
        return o
    }
}

/// Meta's own rendering of an unsaved ad (/api/ads/preview): a facebook.com frame per format.
struct AdsPreview: Decodable, Identifiable, Hashable {
    let format: String
    let src: String
    var id: String { format }

    private enum K: String, CodingKey { case format, src }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        format = c.string(.format, default: "")
        src = c.string(.src, default: "")
    }

    var label: String {
        switch format {
        case "INSTAGRAM_STANDARD": return "Feed"
        case "INSTAGRAM_STORY": return "Story"
        default: return "Reels"
        }
    }
}

struct AdsPreviewAnswer: Decodable {
    let previews: [AdsPreview]

    private enum K: String, CodingKey { case previews }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        previews = c.list(.previews, of: AdsPreview.self).filter { (p: AdsPreview) in !p.src.isEmpty }
    }
}

// MARK: Make one like this (/api/ads/template)

struct AdsTemplate: Decodable {
    let goal: String
    /// "post" or "photos".
    let kind: String
    let mediaId: String
    let permalink: String?
    let thumb: String?
    let caption: String
    let photos: [AdsTemplatePhoto]
    let vertical: AdsTemplatePhoto?
    let text: String
    let headline: String
    let link: String
    let button: String
    let audience: AdsAudience
    let budgetKind: String
    let budgetAmount: Double
    let name: String

    struct AdsTemplatePhoto: Decodable {
        let hash: String
        let url: String?
        let headline: String
        let link: String

        private enum K: String, CodingKey { case hash, url, headline, link }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            hash = c.string(.hash, default: "")
            url = c.string(.url)
            headline = c.string(.headline, default: "")
            link = c.string(.link, default: "")
        }
    }

    private enum Outer: String, CodingKey { case template }
    private enum K: String, CodingKey { case goal, source, text, headline, link, button, audience, budget, name }
    private enum S: String, CodingKey { case kind, mediaId, permalink, thumb, caption, photos, vertical }
    private enum B: String, CodingKey { case kind, amount }

    init(from decoder: Decoder) throws {
        let outer = try decoder.container(keyedBy: Outer.self)
        let c = try outer.nestedContainer(keyedBy: K.self, forKey: .template)
        goal = c.string(.goal, default: "whatsapp")
        if let s = try? c.nestedContainer(keyedBy: S.self, forKey: .source) {
            kind = s.string(.kind, default: "photos")
            mediaId = s.string(.mediaId, default: "")
            permalink = s.string(.permalink)
            thumb = s.string(.thumb)
            caption = s.string(.caption, default: "")
            photos = s.list(.photos, of: AdsTemplatePhoto.self).filter { (p: AdsTemplatePhoto) in !p.hash.isEmpty }
            vertical = s.object(.vertical, of: AdsTemplatePhoto.self).flatMap { (p: AdsTemplatePhoto) -> AdsTemplatePhoto? in p.hash.isEmpty ? nil : p }
        } else {
            kind = "photos"
            mediaId = ""
            permalink = nil
            thumb = nil
            caption = ""
            photos = []
            vertical = nil
        }
        text = c.string(.text, default: "")
        headline = c.string(.headline, default: "")
        link = c.string(.link, default: "")
        button = c.string(.button, default: "SHOP_NOW")
        audience = c.object(.audience, of: AdsAudience.self) ?? AdsAudience()
        if let b = try? c.nestedContainer(keyedBy: B.self, forKey: .budget) {
            budgetKind = b.string(.kind, default: "daily")
            budgetAmount = b.double(.amount, default: 0)
        } else {
            budgetKind = "daily"
            budgetAmount = 0
        }
        name = c.string(.name, default: "")
    }
}

// MARK: Who sees it

/// Search results (/api/ads/search), read leniently.
struct AdsResults<T: Decodable>: Decodable {
    let results: [T]

    private enum K: String, CodingKey { case results }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        results = c.list(.results, of: T.self)
    }
}

/// An interest Meta can target, and about how many people it covers.
struct AdsInterestHit: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let size: Double?
    let path: String?

    private enum K: String, CodingKey { case id, name, size, path }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        let range: [Double] = c.list(.size, of: Double.self)
        size = range.count == 2 ? range[1] : nil
        path = c.string(.path)
    }
}

/// Meta's estimate of the audience (/api/ads/estimate).
struct AdsEstimate: Decodable, Hashable {
    let lower: Double?
    let upper: Double?

    private enum K: String, CodingKey { case lower, upper }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        lower = c.double(.lower)
        upper = c.double(.upper)
    }
}

// MARK: Made

/// /api/ads/create.
struct AdsMade: Decodable, Hashable {
    let adId: String
    let campaignId: String
    let live: Bool
    let warnings: [String]

    private enum K: String, CodingKey { case adId, campaignId, live, warnings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        adId = c.string(.adId, default: "")
        campaignId = c.string(.campaignId, default: "")
        live = c.bool(.live, default: false)
        warnings = c.strings(.warnings)
    }
}

/// /api/ads/adsets POST.
struct AdsDesignMade: Decodable {
    struct Made: Decodable, Identifiable {
        let id: String
        let name: String
        let ads: [String]

        private enum K: String, CodingKey { case id, name, ads }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            id = c.string(.id, default: "")
            name = c.string(.name, default: "")
            ads = c.strings(.ads)
        }
    }

    let campaignId: String
    let adsets: [Made]
    let live: Bool
    let warnings: [String]

    private enum K: String, CodingKey { case campaignId, adsets, live, warnings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        campaignId = c.string(.campaignId, default: "")
        adsets = c.list(.adsets, of: Made.self)
        live = c.bool(.live, default: false)
        warnings = c.strings(.warnings)
    }
}

/// GET /api/ads/adsets: the campaign an ad set would join, or an ad set to start from.
struct AdsAdsetsInfo: Decodable {
    struct Campaign: Decodable, Hashable {
        let id: String
        let name: String
        let objective: String
        /// The campaign holds the budget, so its ad sets carry none.
        let budgeted: Bool

        init(id: String, name: String, objective: String, budgeted: Bool) {
            self.id = id
            self.name = name
            self.objective = objective
            self.budgeted = budgeted
        }

        private enum K: String, CodingKey { case id, name, objective, budgeted }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            id = c.string(.id, default: "")
            name = c.string(.name, default: "")
            objective = c.string(.objective, default: "")
            budgeted = c.bool(.budgeted, default: false)
        }
    }

    struct Draft: Decodable {
        let name: String
        let goal: String
        let audience: AdsAudience
        let budget: AdsBudget

        private enum K: String, CodingKey { case name, goal, audience, budget }
        private enum B: String, CodingKey { case kind, amount, start, end }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            name = c.string(.name, default: "Ad set")
            goal = c.string(.goal, default: "whatsapp")
            audience = c.object(.audience, of: AdsAudience.self) ?? AdsAudience()
            var b = AdsBudget()
            if let n = try? c.nestedContainer(keyedBy: B.self, forKey: .budget) {
                b.kind = n.string(.kind, default: "daily") == "total" ? "total" : "daily"
                b.amount = n.double(.amount, default: 0)
                b.start = n.string(.start)
                b.end = n.string(.end)
            }
            budget = b
        }
    }

    let campaign: Campaign?
    let draft: Draft?
    let ads: [String]
    let currency: String
    let minDaily: Double?
    let pixelId: String?

    private enum K: String, CodingKey { case campaign, draft, ads, currency, minDaily, pixelId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        campaign = c.object(.campaign, of: Campaign.self).flatMap { (x: Campaign) -> Campaign? in x.id.isEmpty ? nil : x }
        draft = c.object(.draft, of: Draft.self)
        ads = c.strings(.ads)
        currency = c.string(.currency, default: "PKR")
        minDaily = c.double(.minDaily)
        pixelId = c.string(.pixelId)
    }
}
