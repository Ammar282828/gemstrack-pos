import SwiftUI
import PhotosUI
import UIKit
import ERPCore

/// Ads → New ad (src/app/ads/new/page.tsx), in the order a shop thinks of it: what to promote (an Instagram
/// post as it is, new photos from this phone or the ad account's library, or a piece from the website), what
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

    enum Kind: String, Hashable { case post, photos, site }

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
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog(launch == "live" ? "Put this ad live?" : "Make this ad?", isPresented: $confirming, titleVisibility: .visible) {
                Button(launch == "live" ? "Put it live" : "Make it, paused") { Task { await send() } }
                Button("Not yet", role: .cancel) {}
            } message: {
                Text(confirmText)
            }
            .alert("That didn't work", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
    }

    private func sheets<V: View>(_ v: V) -> some View {
        v
            .sheet(isPresented: $editingAudience) {
                AdsAudienceSheet(title: "Who sees it", draft: audience, goal: goal?.optimization ?? "REACH",
                                 positions: lists?.igPositions ?? []) { (a: AdsAudience) in audience = a }
            }
            .sheet(isPresented: $libraryOpen) {
                AdsLibrarySheet(chosen: Set(photos.map { (p: AdsPhoto) in p.hash }), room: max(0, 10 - photos.count)) { (img: AdsLibraryImage) in
                    addLibrary(img)
                }
            }
            .sheet(item: $previewSet) { (s: AdsPreviewSet) in AdsPreviewSheet(previews: s.previews) }
            .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, 10 - photos.count), matching: .images)
            .onChange(of: picked) { _, items in
                if !items.isEmpty { Task { await take(items) } }
            }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: Reading

    private var goal: AdsGoal? { lists?.goal(goalKey) }
    private var readyPhotos: [AdsPhoto] { photos.filter { (p: AdsPhoto) in p.ready } }
    private var stillUploading: Bool { photos.contains { (p: AdsPhoto) in p.uploading } }
    private var currency: String { status?.currency ?? "PKR" }

    /// The goals New ad offers here, for what is being promoted (a boosted post can't carry some, new photos others).
    private func offered(_ l: AdsNewAdLists) -> [AdsGoal] {
        l.goals.filter { (g: AdsGoal) in g.newAd && (kind == .post ? !g.photosOnly : !g.postOnly) }
    }

    /// Steps after the words move up one when a post is promoted (it keeps its own words).
    private func step(_ n: Int) -> Int { kind == .post ? n - 1 : n }

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
        if kind == .post {
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

    /// A goal a boosted post can't carry (or new photos can't) goes back to WhatsApp chats.
    private func fitGoal() {
        guard let l = lists else { return }
        if !offered(l).contains(where: { (g: AdsGoal) in g.key == goalKey }) { goalKey = "whatsapp" }
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
        vertical = nil
        text = ""
        headline = ""
        name = ""
        check = nil
        notice = nil
        previewError = nil
    }

    // MARK: The form

    private func form(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                if let notice {
                    Section { Label(notice, systemImage: "info.circle").font(.subheadline) }
                }
                promoteSections(s, l)
                goalSection(l)
                if kind != .post { wordsSection(l) }
                audienceSection
                budgetSection(s)
                quietSection
                previewSection
                makeSections
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private func promoteSections(_ s: AdsStatusAnswer, _ l: AdsNewAdLists) -> some View {
        Section {
            Picker("What to promote", selection: $kind) {
                Text("A post").tag(Kind.post)
                Text("New photos").tag(Kind.photos)
                if l.sitePieces { Text("Website piece").tag(Kind.site) }
            }
            .pickerStyle(.segmented)
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
        }
    }

    private var postSection: some View {
        Section {
            if let mediaError {
                Label(mediaError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Button("Try again") { Task { await loadMedia(after: nil) } }
            }
            if let post, !(media ?? []).contains(where: { (m: AdsMedia) in m.id == post.id }) {
                HStack(spacing: 10) {
                    StockImage(imageUrl: post.thumb, name: "Post", key: post.id)
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: 10))
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
        } footer: {
            Text("The post runs as it is: its photo, caption, likes and comments. Tap one.")
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
                HStack(spacing: 10) {
                    Button { picking = true } label: {
                        Label(photos.isEmpty ? "From this phone" : "Add more", systemImage: "photo.badge.plus")
                    }
                    .buttonStyle(.glass)
                    Button { libraryOpen = true } label: {
                        Label("Ad account photos", systemImage: "photo.stack")
                    }
                    .buttonStyle(.glass)
                }
            }
            if let v = vertical, readyPhotos.count == 1 {
                HStack(spacing: 10) {
                    StockImage(imageUrl: v.thumb ?? v.url, name: "Story size", key: v.key)
                        .frame(width: 32, height: 56)
                        .clipShape(.rect(cornerRadius: 6))
                    Text("With its 9:16 version for stories, reels and WhatsApp Status: one ad, each place its own size.")
                        .font(.footnote)
                    Spacer(minLength: 4)
                    Button { vertical = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Drop the story size")
                }
            }
        } header: {
            Text(kind == .site ? "The pieces" : "The photos")
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
                Label(piecesError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
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
        return Text(line).foregroundStyle(warn ? Color.orange : Color.secondary)
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
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
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
            if audience.places.isEmpty { Text("Choose where the ad shows.").foregroundStyle(.red) }
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
                HStack(spacing: 8) {
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

    private var previewSection: some View {
        Section {
            Button { Task { await showPreview() } } label: {
                HStack(spacing: 8) {
                    if previewBusy { SkeletonLoading() }
                    Label(previewBusy ? "Asking Meta…" : "See it as Instagram will show it", systemImage: "eye")
                }
            }
            .disabled(previewBusy || (kind == .post ? post == nil : readyPhotos.isEmpty))
            if let previewError {
                Text(previewError).font(.footnote).foregroundStyle(.red)
            }
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
        Section {
            Button { Task { await review() } } label: {
                HStack(spacing: 8) {
                    if checking || sending { SkeletonLoading() }
                    Text(launch == "live" ? "Review and put it live" : "Review and make it, paused")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(checking || sending || stillUploading)
            .listRowBackground(Color.clear)
        } footer: {
            if stillUploading { Text("Wait for the photos to reach Meta.") }
        }
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
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
                        Text(m.live ? "The ad is on its way" : "The ad is made, paused").font(.headline)
                        Text(m.live ? "Meta reviews every ad first (usually within the hour); it starts as soon as it is approved."
                             : "Nothing is spent until it is switched on in Campaigns.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        ForEach(m.warnings, id: \.self) { (w: String) in
                            Text(w).font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                Section {
                    MarketingLink(title: "See it in Campaigns", symbol: "checklist", path: "/ads/campaigns")
                    MarketingLink(title: "Test it on another audience", subtitle: "The same ad in more ad sets, side by side",
                                  symbol: "square.stack.3d.up", path: adSetPath(m))
                    Button { again() } label: { Label("Make another", systemImage: "plus") }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }
}
