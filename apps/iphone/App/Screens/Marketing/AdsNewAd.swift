import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore
#if os(macOS)
import UniformTypeIdentifiers
#endif

/// Ads → New ad (src/app/ads/new/page.tsx), in the order a shop thinks of it: what to promote (an Instagram
/// post as it is, new photos from this phone or the ad account's library, a piece from the website, a new video, a
/// creator's post as a partnership ad, or the catalogue: AdsNewAdSources.swift), what
/// it's for, the words, who sees it, budget and dates, Meta's own preview, then make it, paused or live.
///
/// Every call is the web's own route; nothing goes to Meta from the phone. Photos from this phone go to
/// /api/ads/images as the web sends them. Before anything is made the server checks the ad and says, in New
/// ad's own lines (/api/ads/plan → planSummary), what will happen and what it can cost; only after a yes is it
/// sent to /api/ads/create, which checks again. `?piece=<id>` starts from a website piece, `?from=<ad>` from an
/// existing ad ("Make one like this"). The last audience and budget are remembered on this phone.
struct AdsNewAdScreen: View {
    let path: String

    @Environment(Session.self) private var session

    enum Kind: String, Hashable { case post, photos, site, video, partner, catalog }

    // The account and what the house offers
    @State private var status: AdsStatusAnswer?
    @State private var lists: AdsNewAdLists?
    @State private var problem: String?
    @State private var started = false
    @State private var notice: String?

    // 1 · What to promote
    @State private var kind = Kind.post
    @State private var post: AdsMedia?
    @State private var media: [AdsMedia]?
    @State private var mediaAfter: String?
    @State private var mediaBusy = false
    @State private var mediaError: String?
    @State private var photos: [AdsPhoto] = []
    /// A 9:16 version of a single photo (from "Make one like this"): one ad, each place its own size.
    @State private var vertical: AdsPhoto?
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var libraryOpen = false
    @State private var pieces: [PostPiece]?
    @State private var piecesError: String?
    @State private var pieceQ = ""
    @State private var video: AdsVideoDraft?
    @State private var pickingVideo = false
    @State private var videoItem: PhotosPickerItem?
    @State private var partnerCode = ""
    @State private var partnerCheck: AdsPartnerCheck?
    @State private var catalog = AdsCatalogChoice()
    @State private var advanced = AdsAdvanced()

    // 2–5 · The goal, the words, who, the budget
    @State private var goalKey = "whatsapp"
    @State private var text = ""
    @State private var headline = ""
    @State private var link = ""
    @State private var button = "SHOP_NOW"
    @State private var audience = AdsAudience()
    @State private var editingAudience = false
    @State private var budgetKind = "daily"
    @State private var amount = "1000"
    @State private var days: Int? = 7
    @State private var startLater = false
    @State private var start = Date().addingTimeInterval(3600)
    @State private var pixel: AdsPixelState?

    // 6–7 · Preview and make it
    @State private var previewSet: AdsPreviewSet?
    @State private var previewBusy = false
    @State private var previewError: String?
    @State private var launch = "paused"
    @State private var name = ""
    @State private var checking = false
    @State private var check: AdsPlanCheck?
    @State private var confirming = false
    @State private var sending = false
    @State private var made: AdsMade?
    @State private var failure: String?
    #if os(macOS)
    @State private var importing = false
    @State private var dropping = false
    #endif

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        sheets(dialogs(page))
    }

    private var page: some View {
        Group {
            if !mayUse {
                AdsOwnersOnly()
            } else if let made {
                madeView(made)
            } else if let status, status.ready, let lists {
                form(status, lists)
            } else {
                AdsNotReady(status: status, problem: problem, retry: load)
            }
        }
        .navigationTitle("New ad")
        .navigationBarTitleDisplayMode(.inline)
        .task { if mayUse && status == nil { await load() } }
        .task(id: "\(kind.rawValue)|\(lists != nil)") { await sourceNeeds() }
        .task(id: goalKey) { await goalNeeds() }
        .onChange(of: kind) { _, _ in fitGoal() }
        .task(id: catalog.catalogId) { await loadSets() }
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog(launch == "live" ? "Put this ad live?" : "Make this ad?", isPresented: $confirming, titleVisibility: .visible) {
                Button(launch == "live" ? "Put it live" : "Make it, paused") { Task { await send() } }
                Button("Not yet", role: .cancel) {}
            } message: {
                Text(confirmText)
            }
            .failureAlert($failure, title: "That didn't work")
            .failureAlert($previewError, title: "No preview")
            .sensoryFeedback(.success, trigger: made != nil) { _, now in now }
    }

    private func sheets<V: View>(_ v: V) -> some View {
        v
            .sheet(isPresented: $editingAudience) {
                AdsAudienceSheet(title: "Who sees it", draft: audience, goal: goal?.optimization ?? "REACH",
                                 positions: lists?.igPositions ?? []) { (a: AdsAudience) in audience = a }
                    .presentationSizing(.form)
            }
            .sheet(isPresented: $libraryOpen) {
                AdsLibrarySheet(chosen: Set(photos.map { (p: AdsPhoto) in p.hash }), room: max(0, 10 - photos.count)) { (img: AdsLibraryImage) in
                    addLibrary(img)
                }
                .presentationSizing(.page)
            }
            .sheet(item: $previewSet) { (s: AdsPreviewSet) in AdsPreviewSheet(previews: s.previews).presentationSizing(.page) }
            .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, 10 - photos.count), matching: .images)
            .onChange(of: picked) { _, items in
                if !items.isEmpty { Task { await take(items) } }
            }
            .photosPicker(isPresented: $pickingVideo, selection: $videoItem, matching: .videos)
            .onChange(of: videoItem) { _, item in
                if let item { Task { await takeVideo(item) } }
            }
    }


    // MARK: Reading

    private var goal: AdsGoal? { lists?.goal(goalKey) }
    private var readyPhotos: [AdsPhoto] { photos.filter { (p: AdsPhoto) in p.ready } }
    private var stillUploading: Bool { photos.contains { (p: AdsPhoto) in p.uploading } || video?.busy == true }
    /// The post or the creator's post runs as it is: no words of the shop's own.
    private var asIs: Bool { kind == .post || kind == .partner }
    private var currency: String { status?.currency ?? "PKR" }

    /// The goals New ad offers here, for what is being promoted (a boosted post can't carry some, new photos others).
    private func offered(_ l: AdsNewAdLists) -> [AdsGoal] {
        l.goals.filter { (g: AdsGoal) in
            guard g.newAd else { return false }
            switch kind {
            case .post: return !g.photosOnly
            case .partner: return !g.photosOnly && g.key != "profile" && g.key != "engagement"
            case .video: return !g.postOnly && !g.photosOnly
            case .catalog: return g.key == "sales"
            case .photos, .site: return !g.postOnly
            }
        }
    }

    /// Steps after the words move up one when a post is promoted (it keeps its own words).
    private func step(_ n: Int) -> Int { asIs ? n - 1 : n }

    private var budget: AdsBudget {
        var b = AdsBudget()
        b.kind = budgetKind
        b.amount = AdsAmount.parse(amount) ?? 0
        let from = startLater ? start : Date()
        b.start = startLater ? start.ISO8601Format() : nil
        if let days { b.end = from.addingTimeInterval(Double(days) * 86_400).ISO8601Format() }
        return b
    }

    /// The ad as the routes take it (plan.ts AdPlan).
    private var plan: [String: Any] {
        var source: [String: Any] = [:]
        if kind == .video {
            source = video?.json ?? ["kind": "video", "videoId": "", "thumbHash": ""]
        } else if kind == .partner {
            let code = partnerCode.trimmingCharacters(in: .whitespacesAndNewlines)
            source = ["kind": "partner", "adCode": code]
            if let c = partnerCheck, c.code == code {
                if let m = c.mediaId { source["mediaId"] = m }
                if let who = c.creator { source["creator"] = who }
            }
        } else if kind == .catalog {
            source = catalog.json
        } else if kind == .post {
            source["kind"] = "post"
            source["mediaId"] = post?.id ?? ""
            if let permalink = post?.permalink { source["permalink"] = permalink }
            source["thumb"] = AdsJSON.orNull(post?.thumb)
            source["caption"] = post?.caption ?? ""
        } else {
            let ready = readyPhotos
            source["kind"] = "photos"
            source["photos"] = ready.map { (p: AdsPhoto) in p.json }
            if let v = vertical, ready.count == 1 { source["vertical"] = v.json } else { source["vertical"] = NSNull() }
        }
        var p: [String: Any] = [:]
        p["goal"] = goalKey
        p["source"] = source
        p["text"] = text
        p["headline"] = headline
        p["link"] = link
        p["button"] = button
        p["audience"] = audience.json
        p["budget"] = budget.json
        p["launch"] = launch
        p["bidding"] = advanced.bidding
        p["hours"] = advanced.hours
        p["name"] = name.trimmingCharacters(in: .whitespaces)
        return p
    }

    /// The days it would run through that the house keeps free of product ads (Taheri's Bohra calendar).
    private var quietInRange: [AdsQuietDay] {
        guard let l = lists, !l.quiet.isEmpty else { return [] }
        let from = startLater ? start : Date()
        let to = days.map { (d: Int) in from.addingTimeInterval(Double(d) * 86_400) } ?? Date().addingTimeInterval(30 * 86_400)
        let a = ERPDate.karachiDay(from)
        let b = ERPDate.karachiDay(to)
        return l.quiet.filter { (q: AdsQuietDay) in q.date >= a && q.date <= b }
    }

    private var confirmText: String {
        guard let c = check else { return "" }
        var lines = c.summary
        lines.append("Name: \(c.name)")
        let q = quietInRange
        if let firstDay = q.first {
            lines.append("It would run through \(q.count) day\(q.count == 1 ? "" : "s") the house keeps free of product ads, from \(ShopDate.say(firstDay.date)).")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: Asking the ERP

    private func load() async {
        do {
            let s = try await AdsAPI.status()
            status = s
            problem = nil
            if s.ready && lists == nil { lists = try await AdsAPI.newAdLists() }
            if s.ready { await begin() }
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Once: the house's link, the last audience and budget, then `?from=` or `?piece=`.
    private func begin() async {
        guard !started, let l = lists else { return }
        started = true
        if link.isEmpty { link = l.website }
        if let last = AdsLastChoice.read() {
            if let a = last.audience, !a.places.isEmpty { audience = a }
            if let v = last.amount, v > 0 { amount = AdsAmount.field(v) }
            if let k = last.budgetKind, k == "daily" || k == "total" { budgetKind = k }
            if last.hasDays { days = last.days }
            if budgetKind == "total" && days == nil { days = 7 }
            if let g = last.goal, l.goal(g)?.newAd == true { goalKey = g }
        }
        if let key = AdsQuery.value("studio", in: path), let handoff = StudioHandoffs.shared.ads.removeValue(forKey: key) {
            kind = .photos
            photos = handoff["photos"].array.enumerated().map { i, p in AdsPhoto(key: "studio-\(i)", hash: p.s("hash"), url: p.s("url"), thumb: p.s("url"), headline: p.s("headline"), link: p.s("link")) }
            let v = handoff["vertical"]
            if !v.s("hash").isEmpty { vertical = AdsPhoto(key: "studio-vertical", hash: v.s("hash"), url: v.s("url"), thumb: v.s("url")) }
            text = handoff.s("text"); headline = handoff.s("headline"); link = handoff.s("link"); goalKey = handoff.s("goal", "whatsapp")
        } else if let from = AdsQuery.value("from", in: path) {
            await startFrom(ad: from)
        } else if let piece = AdsQuery.value("piece", in: path), l.sitePieces {
            kind = .site
            await loadPieces()
            if let p = pieces?.first(where: { (x: PostPiece) in x.id == piece }) { await addPiece(p) }
        }
        fitGoal()
    }

    /// "Make one like this": the same photos or post, words, button, link, audience and budget, all changeable.
    private func startFrom(ad id: String) async {
        do {
            let t = try await AdsAPI.template(ad: id)
            goalKey = t.goal
            text = t.text
            headline = t.headline
            if !t.link.isEmpty { link = t.link }
            button = t.button
            audience = t.audience
            if t.budgetAmount > 0 {
                budgetKind = t.budgetKind == "total" ? "total" : "daily"
                amount = AdsAmount.field(t.budgetAmount)
                if budgetKind == "total" && days == nil { days = 7 }
            }
            if t.kind == "post" {
                kind = .post
                post = AdsMedia(id: t.mediaId, caption: t.caption, thumb: t.thumb, permalink: t.permalink)
            } else {
                kind = .photos
                var list: [AdsPhoto] = []
                for (i, ph) in t.photos.enumerated() {
                    list.append(AdsPhoto(key: "from\(i)\(ph.hash)", hash: ph.hash, url: ph.url, thumb: ph.url, headline: ph.headline, link: ph.link))
                }
                photos = list
                if let v = t.vertical { vertical = AdsPhoto(key: "vertical", hash: v.hash, url: v.url, thumb: v.url) }
            }
            notice = "Started from “\(t.name)”: change anything, then make it."
        } catch {
            failure = "Couldn't copy that ad: \(error.localizedDescription)"
        }
    }

    /// What the chosen source needs read: the Instagram posts, or the website's pieces.
    private func sourceNeeds() async {
        guard status?.ready == true, lists != nil else { return }
        if kind == .post && media == nil && !mediaBusy { await loadMedia(after: nil) }
        if kind == .site && pieces == nil { await loadPieces() }
        if kind == .catalog && catalog.catalogs == nil {
            do {
                let list = try await AdsCatalogChoice.catalogs()
                catalog.catalogs = list
                catalog.problem = nil
                if catalog.catalogId.isEmpty, list.count == 1 { catalog.catalogId = list[0].id }
            } catch {
                catalog.problem = error.localizedDescription
            }
        }
    }

    /// A catalogue's sets once it is chosen; the biggest is the default (the server sorts them).
    private func loadSets() async {
        let id = catalog.catalogId
        guard !id.isEmpty else { return }
        catalog.sets = nil
        catalog.setId = ""
        do {
            let list = try await AdsCatalogChoice.sets(of: id)
            guard catalog.catalogId == id else { return }
            catalog.sets = list
            catalog.setId = list.first?.id ?? ""
        } catch {
            catalog.problem = error.localizedDescription
        }
    }

    /// A video from Photos, sent to Meta in the pieces it asks for, then waited on until Meta has a cover for it.
    private func takeVideo(_ item: PhotosPickerItem) async {
        videoItem = nil
        guard let movie = try? await item.loadTransferable(type: AdsMovie.self) else {
            failure = "Couldn't read that video. Try another, or save it to Photos first."
            return
        }
        let name = "Video \(ShopDate.stamp(Date(), withTime: true))"
        video = AdsVideoDraft(name: name)
        await AdsVideoUpload.send(movie.url, name: name, token: { await session.idToken() }) { (d: AdsVideoDraft) in
            video = d
        }
    }

    /// "Online orders" says what the pixel recorded this week; the channel goal opens the shop's channel; orders
    /// go where the checkout is (the online shop when the house has one).
    private func goalNeeds() async {
        guard let l = lists else { return }
        if goalKey == "channel" && !AdsNewAdWords.isChannelLink(link) && !l.waChannel.isEmpty { link = l.waChannel }
        if goalKey == "sales" {
            let shop = l.shop.isEmpty ? l.website : l.shop
            let trimmed = link.trimmingCharacters(in: .whitespaces)
            if !shop.isEmpty && (trimmed.isEmpty || link == l.website || AdsNewAdWords.isChannelLink(link)) { link = shop }
            if pixel == nil { pixel = try? await AdsAPI.pixel().state }
        }
    }

    /// A goal what is promoted can't carry goes back to WhatsApp chats, or the first one it can (the catalogue
    /// runs for online orders only).
    private func fitGoal() {
        guard let l = lists else { return }
        let can = offered(l)
        if !can.contains(where: { (g: AdsGoal) in g.key == goalKey }) {
            goalKey = can.contains(where: { (g: AdsGoal) in g.key == "whatsapp" }) ? "whatsapp" : (can.first?.key ?? "whatsapp")
        }
    }

    private func loadMedia(after: String?) async {
        mediaBusy = true
        mediaError = nil
        defer { mediaBusy = false }
        do {
            let a = try await AdsAPI.media(after: after)
            media = (after == nil ? [] : (media ?? [])) + a.media
            mediaAfter = a.after
        } catch {
            mediaError = error.localizedDescription
        }
    }

    private func loadPieces() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/site-pieces", as: PostPiecesAnswer.self)
            pieces = a.pieces.filter { (p: PostPiece) in !p.hidden }
            piecesError = nil
        } catch {
            piecesError = error.localizedDescription
        }
    }

    // MARK: Photos

    private func update(_ key: String, _ change: (inout AdsPhoto) -> Void) {
        guard let i = photos.firstIndex(where: { (p: AdsPhoto) in p.key == key }) else { return }
        change(&photos[i])
    }

    /// Photos picked on this phone: each made a JPEG of at most 2048 px and sent to /api/ads/images, side by side.
    private func take(_ items: [PhotosPickerItem]) async {
        picked = []
        let room = max(0, 10 - photos.count)
        let chosen = Array(items.prefix(room))
        guard !chosen.isEmpty else { return }
        let token = await session.idToken()
        for item in chosen {
            let key = UUID().uuidString
            photos.append(AdsPhoto(key: key, uploading: true))
            Task { await sendPhoto(item, key: key, token: token) }
        }
    }

    private func sendPhoto(_ item: PhotosPickerItem, key: String, token: String?) async {
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            update(key) { (p: inout AdsPhoto) in
                p.uploading = false
                p.error = "Couldn't read that photo. Try another."
            }
            return
        }
        await uploadImage(image, key: key, token: token)
    }

    /// A picture made a JPEG of at most 2048 px and sent to Meta through the ERP, the entry `key` showing its state.
    func uploadImage(_ image: UIImage, key: String, token: String?) async {
        let coded = await Task.detached(priority: .userInitiated) { () -> (Data?, Data?) in
            (AdsPhotoCodec.jpeg(from: image), AdsPhotoCodec.thumbnail(from: image))
        }.value
        guard let jpeg = coded.0 else {
            update(key) { (p: inout AdsPhoto) in
                p.uploading = false
                p.error = "Couldn't use that photo."
            }
            return
        }
        let small = coded.1
        update(key) { (p: inout AdsPhoto) in p.preview = small }
        do {
            let a = try await AdsAPI.upload(jpeg, token: token)
            update(key) { (p: inout AdsPhoto) in
                p.hash = a.hash
                p.url = a.url
                p.uploading = false
            }
        } catch {
            let message = error.localizedDescription
            update(key) { (p: inout AdsPhoto) in
                p.uploading = false
                p.error = message
            }
        }
    }

    private func addLibrary(_ img: AdsLibraryImage) {
        guard photos.count < 10, !photos.contains(where: { (p: AdsPhoto) in p.hash == img.hash }) else { return }
        photos.append(AdsPhoto(key: "lib\(img.hash)", hash: img.hash, url: img.url, thumb: img.thumb))
    }

    /// A website piece as a photo of the ad: the server fetches it from the house's own site for Meta. The first
    /// one also fills the words, the headline and the link when they are empty.
    private func addPiece(_ p: PostPiece) async {
        guard photos.count < 10 else { return }
        let key = "piece\(p.id)\(UUID().uuidString.prefix(6))"
        let wasEmpty = photos.isEmpty
        photos.append(AdsPhoto(key: key, thumb: p.thumb, headline: p.name, link: p.url, uploading: true))
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            text = AdsNewAdWords.pieceText(p, goal: goalKey, toSite: goal?.toSite ?? false)
        }
        if headline.trimmingCharacters(in: .whitespaces).isEmpty { headline = p.name }
        if wasEmpty { link = p.url }
        do {
            let a = try await AdsAPI.image(pieceId: p.id)
            update(key) { (x: inout AdsPhoto) in
                x.hash = a.hash
                x.url = a.url
                x.uploading = false
            }
        } catch {
            let message = error.localizedDescription
            update(key) { (x: inout AdsPhoto) in
                x.uploading = false
                x.error = message
            }
        }
    }

    private func move(_ key: String, by: Int) {
        guard let i = photos.firstIndex(where: { (p: AdsPhoto) in p.key == key }) else { return }
        let j = max(0, min(photos.count - 1, i + by))
        guard i != j else { return }
        let p = photos.remove(at: i)
        photos.insert(p, at: j)
    }

    // MARK: Preview, check, make

    private func showPreview() async {
        previewBusy = true
        previewError = nil
        defer { previewBusy = false }
        do {
            let list = try await AdsAPI.preview(plan: plan)
            if list.isEmpty { previewError = "Meta gave no preview." } else { previewSet = AdsPreviewSet(previews: list) }
        } catch {
            previewError = error.localizedDescription
        }
    }

    /// The server's word first: what stops it, else what it will do and cost, for the counter to agree to.
    private func review() async {
        checking = true
        defer { checking = false }
        do {
            let c = try await AdsAPI.check(plan: plan)
            check = c
            if c.problems.isEmpty { confirming = true }
        } catch {
            failure = error.localizedDescription
        }
    }

    private func send() async {
        guard let c = check else { return }
        sending = true
        defer { sending = false }
        var p = plan
        p["name"] = c.name
        do {
            let m = try await AdsAPI.create(plan: p)
            AdsLastChoice.keep(audience: audience, amount: AdsAmount.parse(amount) ?? 0, budgetKind: budgetKind, days: days, goal: goalKey)
            made = m
        } catch {
            failure = "The ad wasn't made. \(error.localizedDescription)"
        }
    }

    private func again() {
        made = nil
        post = nil
        photos = []
        video = nil
        partnerCode = ""
        partnerCheck = nil
        vertical = nil
        text = ""
        headline = ""
        name = ""
        check = nil
        notice = nil
        previewError = nil
        // The next ad starts paused again, as every new ad does; the last one's previews and errors go.
        launch = "paused"
        previewSet = nil
        mediaError = nil
        failure = nil
    }

    // MARK: The form

    private func form(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        #if os(macOS)
        macForm(s, l)
        #else
        phoneForm(s, l)
        #endif
    }

    private func phoneForm(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                if let notice {
                    Section { Label(notice, systemImage: "info.circle").font(.subheadline) }
                }
                promoteSections(s, l)
                goalSection(l)
                if !asIs { wordsSection(l) }
                audienceSection
                budgetSection(s)
                AdsAdvancedSection(advanced: $advanced, needsTotal: { budgetKindChoice.wrappedValue = "total" },
                                   sales: goalKey == "sales", currency: s.currency)
                quietSection
                previewSection
                makeSections
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .safeAreaBar(edge: .bottom, spacing: 0) { reviewBar }
    }

    @ViewBuilder
    private func promoteSections(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        Section {
            Picker("What to promote", selection: $kind) {
                Text("A post").tag(Kind.post)
                Text("New photos").tag(Kind.photos)
                if l.sitePieces { Text("Website piece").tag(Kind.site) }
                Text("New video").tag(Kind.video)
                Text("A creator's post").tag(Kind.partner)
                if !(l.shop.isEmpty && l.website.isEmpty) { Text("Catalogue").tag(Kind.catalog) }
            }
            .pickerStyle(.menu)
        } header: {
            LedgerHeading(title: "1 · What to promote")
        } footer: {
            if let ig = s.settings?.instagramUsername { Text("It runs as @\(ig).") }
        }
        switch kind {
        case .post:
            postSection
        case .photos:
            photosSection
        case .site:
            siteSection
            if !photos.isEmpty { photosSection }
        case .video:
            AdsVideoSection(video: $video) { pickingVideo = true }
        case .partner:
            AdsPartnerSection(code: $partnerCode, checked: $partnerCheck, link: $link, button: $button,
                              toSite: goal?.toSite ?? false, buttons: l.buttons)
        case .catalog:
            AdsCatalogSection(choice: $catalog)
        }
    }

    private var postSection: some View {
        Section {
            if let mediaError {
                Label(mediaError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                Button("Try again") { Task { await loadMedia(after: nil) } }.buttonStyle(.bordered)
            }
            if let post, !(media ?? []).contains(where: { (m: AdsMedia) in m.id == post.id }) {
                HStack(spacing: pt(10)) {
                    StockImage(imageUrl: post.thumb, name: "Post", key: post.id)
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    Text("The post of the ad this started from").font(.subheadline)
                }
            }
            if let media {
                AdsMediaGrid(media: media, chosen: post?.id) { (m: AdsMedia) in
                    post = post?.id == m.id ? nil : m
                }
                if let after = mediaAfter {
                    Button(mediaBusy ? "Reading…" : "Older posts") { Task { await loadMedia(after: after) } }
                        .disabled(mediaBusy)
                }
            } else if mediaError == nil {
                MarketingReading(text: "Reading Instagram…")
            }
            if let post {
                Text(post.caption.isEmpty ? "No caption." : post.caption)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
    }

    private var photosSection: some View {
        Section {
            ForEach($photos) { (p: Binding<AdsPhoto>) in
                let key = p.wrappedValue.key
                AdsPhotoRow(photo: p, carousel: photos.count > 1, ownLinks: goal?.toSite == true,
                            first: photos.first?.key == key, last: photos.last?.key == key,
                            move: { (by: Int) in move(key, by: by) },
                            remove: { photos.removeAll { (x: AdsPhoto) in x.key == key } })
            }
            if kind == .photos && photos.count < 10 {
                HStack(spacing: pt(10)) {
                    Button { picking = true } label: {
                        #if os(macOS)
                        Label(photos.isEmpty ? "From Photos" : "Add more", systemImage: "photo.badge.plus")
                        #else
                        Label(photos.isEmpty ? "From this phone" : "Add more", systemImage: "photo.badge.plus")
                        #endif
                    }
                    .buttonStyle(.bordered)
                    #if os(macOS)
                    Button { importing = true } label: { Label("From files…", systemImage: "folder") }
                        .buttonStyle(.bordered)
                    #endif
                    Button { libraryOpen = true } label: {
                        Label("Ad account photos", systemImage: "photo.stack")
                    }
                    .buttonStyle(.bordered)
                }
            }
            if let v = vertical, readyPhotos.count == 1 {
                HStack(spacing: pt(10)) {
                    StockImage(imageUrl: v.thumb ?? v.url, name: "Story size", key: v.key)
                        .frame(width: 32, height: 56)
                        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    Text("With its 9:16 version for stories, reels and WhatsApp Status: one ad, each place its own size.")
                        .font(.footnote)
                    Spacer(minLength: 4)
                    Button { vertical = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Drop the story size")
                }
            }
        } header: {
            LedgerHeading(title: kind == .site ? "The pieces" : "The photos")
        } footer: {
            Text(photosNote)
        }
    }

    private var photosNote: String {
        let count = photos.count > 1 ? "\(photos.count) photos make a carousel, in this order." : "One photo, or up to ten for a carousel."
        return count + " Meta is told not to retouch, crop, animate or re-word anything."
    }

    /// The website's pieces, new arrivals first; a search reaches the rest.
    private func shownPieces(_ all: [PostPiece]) -> [PostPiece] {
        let words = pieceQ.lowercased().split(separator: " ").map(String.init)
        let hits = all.filter { (p: PostPiece) in
            let hay = "\(p.name) \(p.collection) \(p.facts.joined(separator: " "))".lowercased()
            return words.allSatisfy { (w: String) in hay.contains(w) }
        }
        let ordered = words.isEmpty ? hits.filter { (p: PostPiece) in p.newArrival } + hits.filter { (p: PostPiece) in !p.newArrival } : hits
        return Array(ordered.prefix(30))
    }

    private var siteSection: some View {
        Section {
            TextField("Search the website: ruby, kara, jhumka…", text: $pieceQ)
                .autocorrectionDisabled()
            if let piecesError {
                Label(piecesError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
            } else if let pieces {
                AdsPieceGrid(pieces: shownPieces(pieces), full: photos.count >= 10) { (p: PostPiece) in
                    Task { await addPiece(p) }
                }
            } else {
                MarketingReading(text: "Reading the website…")
            }
        } footer: {
            Text("Each piece is added as a photo below (several make a carousel), with its own link.")
        }
    }

    // MARK: What it's for

    private func goalSection(_ l: AdsNewAdLists) -> some View {
        Section {
            ForEach(offered(l)) { (g: AdsGoal) in
                Button { goalKey = g.key } label: { AdsGoalLabel(goal: g, chosen: g.key == goalKey) }
            }
        } header: {
            LedgerHeading(title: "2 · What it's for")
        } footer: {
            goalNote
        }
    }

    @ViewBuilder
    private var goalNote: some View {
        if goalKey == "whatsapp" || goalKey == "messages" {
            Text(chatNote)
        } else if goalKey == "sales" {
            salesNote
        } else if goalKey == "channel" {
            Text("Meta has no \"follow a channel\" goal yet, so this is a link ad to the channel: it buys taps on the link; follows show in WhatsApp, not here.")
        }
    }

    private var chatNote: String {
        let opens = status?.settings?.whatsappGreeting == nil ? "a hello" : "the message set on Setup"
        var line = "Needs a WhatsApp number linked to the Facebook Page. The chat opens with \(opens) and three tap-to-ask questions."
        if goalKey == "messages" { line += " Someone who lives in Instagram gets Instagram Direct instead: answer both." }
        return line
    }

    /// Whether the pixel has orders for Meta to learn from (pixel-read.ts salesReadiness; Meta learns from about 50 a week).
    private var salesNote: some View {
        var line = "Reading what the pixel recorded this week…"
        var warn = false
        if status?.settings?.pixelId == nil {
            line = "Choose the website's pixel on Setup first: Meta counts orders through it."
            warn = true
        } else if let px = pixel {
            let site = px.site ?? "the site"
            if let n = px.purchases {
                if n == 0 {
                    line = "The pixel recorded no order this week, so Meta has nothing to learn from yet: \"Website visits\" buys better until orders come through \(site)."
                    warn = true
                } else if n < 50 {
                    line = "The pixel recorded \(AdsFormat.count(n)) order\(n == 1 ? "" : "s") this week. Meta learns from about 50 a week, so the ad set may stay in learning: run it two weeks without edits and judge it by cost per order."
                } else {
                    line = "The pixel recorded \(AdsFormat.count(n)) orders this week: enough for Meta to learn from."
                }
            } else {
                line = "Meta didn't say what the pixel recorded this week."
            }
        }
        return Text(line).foregroundStyle(warn ? Tone.owed.color : Color.secondary)
    }

    // MARK: The words

    private func wordsSection(_ l: AdsNewAdLists) -> some View {
        Section {
            TextField("What the ad says: the piece, its weight, why it's special.", text: $text, axis: .vertical)
                .lineLimit(3...8)
            TextField("Headline (short)", text: $headline)
            if goalKey == "channel" {
                TextField("https://whatsapp.com/channel/…", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if goal?.toSite == true {
                TextField("https://… the page the button opens", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("Button", selection: $button) {
                    ForEach(l.buttons) { (b: AdsChoice) in Text(b.label).tag(b.key) }
                }
            }
        } header: {
            LedgerHeading(title: "3 · The words")
        }
    }

    // MARK: Who sees it

    private var audienceSection: some View {
        Section {
            Button { editingAudience = true } label: {
                HStack(spacing: pt(10)) {
                    VStack(alignment: .leading, spacing: pt(4)) {
                        Text("Who sees it").foregroundStyle(.primary)
                        Text(audience.words).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
            }
        } header: {
            LedgerHeading(title: "\(step(4)) · Who sees it")
        } footer: {
            if audience.places.isEmpty { Text("Choose where the ad shows.").foregroundStyle(Tone.problem.color) }
        }
    }

    // MARK: Budget and dates

    private var budgetKindChoice: Binding<String> {
        Binding(get: { budgetKind }, set: { (k: String) in
            budgetKind = k
            if k == "total" && days == nil { days = 7 }
        })
    }

    /// The run's length in days; 0 is "until I stop it" (a day's budget only).
    private var daysChoice: Binding<Int> {
        Binding(get: { days ?? 0 }, set: { (d: Int) in days = d > 0 ? d : nil })
    }

    private func budgetSection(_ s: AdsStatusAnswer) -> some View {
        let quick: [Double] = budgetKind == "daily" ? [500, 1000, 2000, 3000, 5000] : [3000, 5000, 10000, 20000, 50000]
        return Section {
            Picker("Budget", selection: budgetKindChoice) {
                Text("Per day").tag("daily")
                Text("In total").tag("total")
            }
            .pickerStyle(.segmented)
            LabeledContent(budgetKind == "daily" ? "A day" : "In total") {
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: pt(8)) {
                    ForEach(quick, id: \.self) { (v: Double) in
                        MarketingChip(title: AdsFormat.money(v, s.currency), selected: AdsAmount.parse(amount) == v) {
                            amount = AdsAmount.field(v)
                        }
                    }
                }
            }
            Picker("How long", selection: daysChoice) {
                ForEach([3, 7, 14, 30], id: \.self) { (d: Int) in Text("\(d) days").tag(d) }
                if budgetKind == "daily" { Text("Until I stop it").tag(0) }
            }
            Toggle("Start later", isOn: $startLater).tint(Theme.accent)
            if startLater {
                DatePicker("Starts", selection: $start, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    .environment(\.timeZone, ERPDate.karachi)
            }
        } header: {
            LedgerHeading(title: "\(step(5)) · Budget and dates (\(s.currency))")
        } footer: {
            Text(budgetNote(s))
        }
    }

    /// What the budget can spend, as the web says it under the budget (the server's lines come at Review).
    private func budgetNote(_ s: AdsStatusAnswer) -> String {
        guard let v = AdsAmount.parse(amount) else { return "A budget above zero." }
        let cur = s.currency
        var line: String
        if budgetKind == "daily" {
            if let days {
                line = "At most about \(AdsFormat.money(v * Double(days), cur)) over \(days) days (Meta may spend a little more on a good day and less on others)."
            } else {
                line = "About \(AdsFormat.money(v * 30, cur)) a month until it's paused."
            }
            if let floor = s.account?.minDailyBudget, floor > 0, v < floor {
                line += " Meta's smallest daily budget for this account is \(AdsFormat.money(floor, cur))."
            }
        } else {
            line = "About \(AdsFormat.money(v / Double(max(1, days ?? 1)), cur)) a day over \(days ?? 1) days."
        }
        return line
    }

    @ViewBuilder
    private var quietSection: some View {
        let q = quietInRange
        if !q.isEmpty {
            Section {
                ForEach(Array(q.prefix(6))) { (d: AdsQuietDay) in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(ShopDate.say(d.date)) · \(d.hijri)").font(.subheadline.weight(.medium))
                        Text(d.name + (d.near ? " (the days before)" : "")).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if q.count > 6 {
                    Text("…and \(q.count - 6) more.").font(.caption).foregroundStyle(.secondary)
                }
            } header: {
                Label(days == nil ? "Left running, it would reach days kept free of product ads" : "It would run through days kept free of product ads",
                      systemImage: "calendar.badge.exclamationmark")
            } footer: {
                Text("End it before, or start after. Ads → Studio → Guide has the calendar.")
            }
        }
    }

    // MARK: Preview and make it

    /// Enough of the ad for Meta to draw it.
    private var previewable: Bool {
        switch kind {
        case .post: return post != nil
        case .video: return video?.phase == .ready
        case .partner: return !partnerCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .catalog: return !catalog.setId.isEmpty
        case .photos, .site: return !readyPhotos.isEmpty
        }
    }

    private var previewSection: some View {
        Section {
            Button { Task { await showPreview() } } label: {
                HStack(spacing: pt(8)) {
                    if previewBusy { SkeletonLoading() }
                    Label(previewBusy ? "Asking Meta…" : "See it as Instagram will show it", systemImage: "eye")
                }
            }
            .disabled(previewBusy || !previewable)
        } header: {
            LedgerHeading(title: "\(step(6)) · Preview")
        }
    }

    @ViewBuilder
    private var makeSections: some View {
        Section {
            TextField("Name in Ads Manager (made for you)", text: $name)
            Picker("Launch", selection: $launch) {
                Text("Save it paused").tag("paused")
                Text("Put it live").tag("live")
            }
            .pickerStyle(.segmented)
        } header: {
            LedgerHeading(title: "\(step(7)) · Make it")
        } footer: {
            Text(launch == "paused" ? "Look it over in Campaigns and switch it on there: nothing is spent until then."
                 : "It starts once Meta approves it (usually within the hour) and spends its budget from then.")
        }
        AdsProblemsSection(problems: check?.problems ?? [])
    }

    /// The page's one action, pinned: the server's check opens the confirmation.
    var reviewBar: some View {
        ActionBar(primary: .init(launch == "live" ? "Review and put it live" : "Review and make it, paused",
                                 isBusy: checking || sending, isDisabled: stillUploading) { Task { await review() } },
                  summary: stillUploading ? (kind == .video ? "Wait for the video to reach Meta." : "Wait for the photos to reach Meta.") : nil)
    }

    // MARK: Made

    private func adSetPath(_ m: AdsMade) -> String {
        var q: [String] = []
        if !m.campaignId.isEmpty { q.append("campaign=\(m.campaignId)") }
        if !m.adId.isEmpty { q.append("ads=\(m.adId)") }
        return "/ads/adset" + (q.isEmpty ? "" : "?" + q.joined(separator: "&"))
    }

    private func madeView(_ m: AdsMade) -> some View {
        List {
            Group {
                Section {
                    VStack(spacing: pt(10)) {
                        Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(Tone.settled.color)
                        Text(m.live ? "The ad is on its way" : "The ad is made, paused").font(.headline)
                        Text(m.live ? "Meta reviews every ad first (usually within the hour); it starts as soon as it is approved."
                             : "Nothing is spent until it is switched on in Campaigns.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        ForEach(m.warnings, id: \.self) { (w: String) in
                            Text(w).font(.footnote).foregroundStyle(Tone.owed.color)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, pt(8))
                }
                Section {
                    MarketingLink(title: "See it in Campaigns", symbol: "checklist", path: "/ads/campaigns")
                    MarketingLink(title: "Test it on another audience",
                                  symbol: "square.stack.3d.up", path: adSetPath(m))
                    Button { again() } label: { Label("Make another", systemImage: "plus") }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
    }
}

#if os(macOS)
extension AdsNewAdScreen {
    /// One window: the steps as sections of a form on the left, the ad as it will look in a column on the right that
    /// follows what is typed. Return reviews it; the footer holds the one action.
    func macForm(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        HStack(spacing: 0) {
            List {
                Group {
                    AdsAlertsSection(status: s)
                    if let notice {
                        Section { Label(notice, systemImage: "info.circle").font(.subheadline) }
                    }
                    promoteSections(s, l)
                    goalSection(l)
                    if !asIs { wordsSection(l) }
                    audienceSection
                    budgetSection(s)
                    AdsAdvancedSection(advanced: $advanced, needsTotal: { budgetKind = "total"; if days == nil { days = 7 } },
                                       sales: goalKey == "sales", currency: s.currency)
                    quietSection
                    makeSections
                }
                .houseRows()
            }
            .listStyle(.inset)
            .frame(minWidth: 520)
            Divider()
            macPreviewColumn(s, l)
                .frame(width: 360)
        }
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 3, dash: [8]))
                    .padding(8)
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { (urls: [URL], _) in
            guard kind == .photos, photos.count < 10 else { return false }
            Task { await takeFiles(urls) }
            return true
        } isTargeted: { dropping = $0 }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { (result: Result<[URL], Error>) in
            if case .success(let urls) = result { Task { await takeFiles(urls) } }
        }
        .actionBar(primary: .init(launch == "live" ? "Review and put it live" : "Review and make it, paused",
                                  isBusy: checking || sending, isDisabled: stillUploading) { Task { await review() } },
                   summary: stillUploading ? (kind == .video ? "Wait for the video to reach Meta." : "Wait for the photos to reach Meta.") : nil)
    }

    /// Picture files from the Mac, each sent to Meta like a photo from Photos.
    private func takeFiles(_ urls: [URL]) async {
        let room = max(0, 10 - photos.count)
        let chosen = Array(urls.prefix(room))
        guard !chosen.isEmpty else { return }
        let token = await session.idToken()
        for url in chosen {
            let key = UUID().uuidString
            photos.append(AdsPhoto(key: key, uploading: true))
            let scoped = url.startAccessingSecurityScopedResource()
            let data = try? Data(contentsOf: url)
            if scoped { url.stopAccessingSecurityScopedResource() }
            guard let data, let image = UIImage(data: data) else {
                update(key) { (p: inout AdsPhoto) in
                    p.uploading = false
                    p.error = "Couldn't read that picture. Try another."
                }
                continue
            }
            Task { await uploadImage(image, key: key, token: token) }
        }
    }

    /// The ad as the first photo, headline, words and button will show it, and Meta's own preview behind a button.
    private func macPreviewColumn(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        let picture: String? = {
            switch kind {
            case .post: return post?.thumb
            case .photos, .site: return readyPhotos.first.flatMap { (p: AdsPhoto) in p.thumb ?? p.url } ?? photos.first.flatMap { (p: AdsPhoto) in p.thumb ?? p.url }
            default: return nil
            }
        }()
        let words = asIs ? (post?.caption ?? "") : text
        let buttonLabel = l.buttons.first { (b: AdsChoice) in b.key == button }?.label ?? ""
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                LedgerHeading(title: "How it will look")
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
                        Text(s.settings?.instagramUsername.map { (u: String) in "@" + u } ?? "Your page").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text("Sponsored").font(.caption).foregroundStyle(.secondary)
                    }
                    if picture == nil, kind == .photos || kind == .site, let data = photos.first?.preview, let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFill()
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                    } else if let picture {
                        StockImage(imageUrl: picture, name: headline, key: "preview-" + picture)
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                    } else {
                        RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).fill(.quaternary)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay { Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary) }
                    }
                    if !words.isEmpty { Text(words).font(.callout).lineLimit(6) }
                    if !headline.isEmpty || (goal?.toSite == true && !buttonLabel.isEmpty) {
                        HStack {
                            Text(headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                            Spacer(minLength: 8)
                            if goal?.toSite == true, !buttonLabel.isEmpty {
                                Text(buttonLabel).font(.caption.weight(.semibold))
                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(.quaternary, in: .capsule)
                            }
                        }
                    }
                }
                .padding(14)
                .background(Theme.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
                Button { Task { await showPreview() } } label: {
                    Label(previewBusy ? "Asking Meta…" : "See it as Instagram will show it", systemImage: "eye")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(previewBusy || !previewable)
                Text("This is a sketch from what is typed. Meta's own preview shows feed, stories and reels exactly.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(20)
        }
        .background(Theme.ground)
    }
}
#endif
