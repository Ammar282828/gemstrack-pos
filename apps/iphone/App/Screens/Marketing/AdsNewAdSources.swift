import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import ERPCore

// New ad's other sources and its folded-away bidding (2026-10-16, the web's "Add all the other features"): a new
// video, a creator's post as a partnership ad, the catalogue (Advantage+ catalogue ads), and Ads Manager's bid
// strategy and "run ads on a schedule". As everywhere in New ad, the phone only gathers the choices: the server
// says what stops the plan (/api/ads/plan → planProblems) and builds what Meta is sent (plan.ts creativeSpec).

// MARK: A new video

/// A video picked from Photos, copied where the app can read it in pieces (PhotosPicker hands over a file that
/// lasts only as long as the load).
struct AdsMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { (m: AdsMovie) in SentTransferredFile(m.url) } importing: { (received: ReceivedTransferredFile) in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("ad-video-\(UUID().uuidString).\(ext)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return AdsMovie(url: copy)
        }
    }
}

/// Where a video is on its way to Meta.
struct AdsVideoDraft: Equatable {
    enum Phase: Equatable { case sending, processing, ready, failed }
    var name: String
    var phase = Phase.sending
    /// How much of the file has gone, 0…1.
    var sent = 0.0
    var videoId = ""
    var thumbHash = ""
    var thumb: String?
    var error: String?

    var busy: Bool { phase == .sending || phase == .processing }

    /// plan.ts `{ kind: 'video', videoId, thumbHash, thumb, name }`; the hash is empty until Meta has the cover.
    var json: [String: Any] {
        ["kind": "video", "videoId": videoId, "thumbHash": phase == .ready ? thumbHash : "", "thumb": AdsJSON.orNull(thumb), "name": name]
    }
}

/// /api/ads/videos: Meta's resumable upload, a piece per request (the server's request limit holds for any size),
/// then Meta's processing, then its cover frame put in the image library (a video ad needs a cover).
@MainActor
enum AdsVideoUpload {
    private struct Started: Decodable {
        let session: String
        let videoId: String
        let start: Int
        let end: Int
        private enum K: String, CodingKey { case session, videoId, start, end }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            session = c.string(.session, default: "")
            videoId = c.string(.videoId, default: "")
            start = c.int(.start) ?? 0
            end = c.int(.end) ?? 0
        }
    }

    private struct Range: Decodable {
        let start: Int
        let end: Int
        private enum K: String, CodingKey { case start, end }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            start = c.int(.start) ?? 0
            end = c.int(.end) ?? 0
        }
    }

    struct Status: Decodable {
        let status: String
        let thumbHash: String
        let thumb: String?
        let detail: String?
        private enum K: String, CodingKey { case status, thumbHash, thumb, detail }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            status = c.string(.status, default: "processing")
            thumbHash = c.string(.thumbHash, default: "")
            thumb = c.string(.thumb)
            detail = c.string(.detail)
        }
    }

    /// The whole of it: sends the file in the pieces Meta asks for, then waits for Meta to finish it.
    /// `progress` hears each step; `token` is asked per piece, as a long video can outlast an ID token.
    static func send(_ file: URL, name: String, token: @escaping () async -> String?, progress: @escaping (AdsVideoDraft) -> Void) async {
        var d = AdsVideoDraft(name: name)
        defer { try? FileManager.default.removeItem(at: file) }
        do {
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
            guard size > 0 else { throw ERPAPI.Failure(status: 0, message: "That video is empty.") }
            let s = try await ERPAPI.shared.post("/api/ads/videos", ["phase": "start", "size": size], as: Started.self)
            guard !s.session.isEmpty, !s.videoId.isEmpty else { throw ERPAPI.Failure(status: 0, message: "Meta didn't open the upload.") }
            let handle = try FileHandle(forReadingFrom: file)
            defer { try? handle.close() }
            var start = s.start
            var end = s.end
            while start < end {
                try handle.seek(toOffset: UInt64(start))
                let chunk = try handle.read(upToCount: end - start) ?? Data()
                var next: Range?
                var tries = 0
                while next == nil {
                    do {
                        next = try await piece(session: s.session, start: start, chunk: chunk, token: await token())
                    } catch {
                        tries += 1
                        if tries >= 3 { throw error }
                        try await Task.sleep(for: .seconds(2 * tries))
                    }
                }
                start = next?.start ?? end
                end = next?.end ?? end
                d.sent = min(1, Double(start) / Double(size))
                progress(d)
            }
            _ = try await ERPAPI.shared.send("/api/ads/videos", ["phase": "finish", "session": s.session, "name": name], timeout: 90)
            d.phase = .processing
            d.videoId = s.videoId
            progress(d)
            for _ in 0..<150 {
                try await Task.sleep(for: .seconds(4))
                let st = try await ERPAPI.shared.get("/api/ads/videos?id=\(AdsQuery.escape(s.videoId))", as: Status.self)
                if st.status == "ready" && !st.thumbHash.isEmpty {
                    d.phase = .ready
                    d.thumbHash = st.thumbHash
                    d.thumb = st.thumb
                    progress(d)
                    return
                }
                if st.status == "error" {
                    throw ERPAPI.Failure(status: 0, message: "Meta couldn't process the video (\(st.detail ?? "error")). Try exporting it as an MP4.")
                }
            }
            throw ERPAPI.Failure(status: 0, message: "Meta is still processing the video. Try again in a few minutes.")
        } catch {
            d.phase = .failed
            d.error = error.localizedDescription
            progress(d)
        }
    }

    /// One piece, as a form (`session`, `start`, `chunk`), under ERPAPI's own guards: this ERP over https only,
    /// the sign-in token, no redirect off the host, no cookie or cache kept.
    private static func piece(session: String, start: Int, chunk: Data, token: String?) async throws -> Range {
        if House.isDemo { throw ERPAPI.Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        guard let url = URL(string: "/api/ads/videos", relativeTo: House.serverURL)?.absoluteURL,
              url.scheme == "https", url.host == House.serverURL.host else {
            throw ERPAPI.Failure(status: 0, message: "Not an address of this ERP.")
        }
        let boundary = "ERP-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("session", session)
        field("start", String(start))
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"chunk\"; filename=\"chunk\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8))
        body.append(chunk)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body
        let (data, response) = try await pieces.data(for: request, delegate: StayOnHost.shared)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw ERPAPI.Failure(status: status, message: said ?? "The ERP answered \(status).")
        }
        return try JSONDecoder().decode(Range.self, from: data)
    }

    private static let pieces: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()
}

struct AdsVideoSection: View {
    @Binding var video: AdsVideoDraft?
    let pick: () -> Void

    var body: some View {
        Section {
            if let v = video {
                HStack(spacing: pt(12)) {
                    StockImage(imageUrl: v.thumb, name: v.name, key: v.videoId.isEmpty ? v.name : v.videoId)
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    VStack(alignment: .leading, spacing: pt(4)) {
                        Text(v.name).lineLimit(2)
                        switch v.phase {
                        case .sending:
                            ProgressView(value: v.sent)
                            Text("Sending to Meta… \(Int(v.sent * 100))%").font(.caption).foregroundStyle(.secondary)
                        case .processing:
                            Text("Meta is processing it (a minute or two)…").font(.caption).foregroundStyle(.secondary)
                        case .ready:
                            Text("Ready, with Meta's cover frame").font(.caption).foregroundStyle(.secondary)
                        case .failed:
                            Text(v.error ?? "It didn't reach Meta.").font(.caption).foregroundStyle(Tone.problem.color)
                        }
                    }
                }
            }
            Button(action: pick) {
                Label(video == nil ? "Choose a video" : "A different video", systemImage: "video.badge.plus")
            }
            .disabled(video?.busy == true)
        } header: {
            #if os(macOS)
            Text("The video")
            #else
            LedgerHeading(title: "The video")
            #endif
        } footer: {
            Text("An MP4 or MOV from Photos; vertical 9:16 suits stories and reels, 4:5 the feed. Keep the app open while it sends. Meta is told not to crop, filter or re-word it.")
        }
    }
}

// MARK: A creator's post

/// /api/ads/partner: a creator's partnership ad code, checked with Meta before it goes into an ad.
struct AdsPartnerCheck: Decodable, Equatable {
    var code = ""
    let ok: Bool
    let mediaId: String?
    let creator: String?
    let permalink: String?
    let thumb: String?
    let why: String?

    private enum K: String, CodingKey { case ok, mediaId, creator, permalink, thumb, why }

    init(code: String, why: String) {
        self.code = code
        ok = false
        mediaId = nil
        creator = nil
        permalink = nil
        thumb = nil
        self.why = why
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ok = c.bool(.ok) ?? false
        mediaId = c.string(.mediaId)
        creator = c.string(.creator)
        permalink = c.string(.permalink)
        thumb = c.string(.thumb)
        why = c.string(.why)
    }

    @MainActor
    static func check(_ code: String) async -> AdsPartnerCheck {
        do {
            var a = try await ERPAPI.shared.get("/api/ads/partner?code=\(AdsQuery.escape(code))", as: AdsPartnerCheck.self)
            a.code = code
            return a
        } catch {
            return AdsPartnerCheck(code: code, why: error.localizedDescription)
        }
    }
}

struct AdsPartnerSection: View {
    @Binding var code: String
    @Binding var checked: AdsPartnerCheck?
    @Binding var link: String
    @Binding var button: String
    let toSite: Bool
    let buttons: [AdsChoice]
    @State private var checking = false

    private var trimmed: String { code.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Section {
            HStack {
                TextField("Paste the ad code", text: $code)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                Button {
                    Task {
                        checking = true
                        checked = await AdsPartnerCheck.check(trimmed)
                        checking = false
                    }
                } label: {
                    if checking { SkeletonLoading() } else { Text("Check") }
                }
                .buttonStyle(.borderless)
                .disabled(trimmed.isEmpty || checking)
            }
            if let c = checked, c.code == trimmed {
                HStack(spacing: pt(10)) {
                    if let thumb = c.thumb {
                        StockImage(imageUrl: thumb, name: c.creator ?? "Post", key: c.mediaId ?? c.code)
                            .frame(width: 48, height: 48)
                            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        if c.ok {
                            Text(c.creator.map { (who: String) in "Ready: @\(who)'s post" } ?? "Ready")
                        } else {
                            Text(c.why ?? "Meta couldn't check the code. It can still be tried.").foregroundStyle(Tone.owed.color)
                        }
                        if let link = c.permalink, let url = URL(string: link) {
                            Link("See the post", destination: url).font(.caption)
                        }
                    }
                    .font(.subheadline)
                }
            }
            if toSite {
                TextField("https://… the page the button opens", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("Button", selection: $button) {
                    ForEach(buttons) { (b: AdsChoice) in Text(b.label).tag(b.key) }
                }
            }
        } header: {
            #if os(macOS)
            Text("The creator's post")
            #else
            LedgerHeading(title: "The creator's post")
            #endif
        } footer: {
            Text("The post runs as it is, under both names (Instagram's partnership ads). The creator makes the code on the post: ⋯ → Partnership label and ads → Get ad code, and sends it to you.")
        }
    }
}

// MARK: The catalogue

/// A catalogue or one of its product sets (/api/ads/catalog).
struct AdsCatalogRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let products: Int?
    private enum K: String, CodingKey { case id, name, products }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        products = c.int(.products)
    }
    var words: String { products.map { (n: Int) in "\(name) · \(n) pieces" } ?? name }
}

struct AdsCatalogsAnswer: Decodable {
    let catalogs: [AdsCatalogRow]
    let sets: [AdsCatalogRow]
    private enum K: String, CodingKey { case catalogs, sets }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        catalogs = c.list(.catalogs, of: AdsCatalogRow.self).filter { (r: AdsCatalogRow) in !r.id.isEmpty }
        sets = c.list(.sets, of: AdsCatalogRow.self).filter { (r: AdsCatalogRow) in !r.id.isEmpty }
    }
}

/// The catalogue choice: which catalogue, which set (biggest first, as the server sorts them), and who it finds.
struct AdsCatalogChoice: Equatable {
    var catalogs: [AdsCatalogRow]?
    var catalogId = ""
    var sets: [AdsCatalogRow]?
    var setId = ""
    /// `viewers`: lookers and carters of the last 14 days who didn't buy; `everyone`: new buyers.
    var who = "viewers"
    var problem: String?

    /// plan.ts `{ kind: 'catalog', catalogId, setId, setName, who }`.
    var json: [String: Any] {
        var j: [String: Any] = ["kind": "catalog", "catalogId": catalogId, "setId": setId, "who": who]
        if let name = sets?.first(where: { (s: AdsCatalogRow) in s.id == setId })?.name { j["setName"] = name }
        return j
    }

    /// The house's catalogues (the business's own and its clients').
    @MainActor
    static func catalogs() async throws -> [AdsCatalogRow] {
        try await ERPAPI.shared.get("/api/ads/catalog", as: AdsCatalogsAnswer.self).catalogs
    }

    /// A catalogue's product sets, biggest first, Meta's auto-made ones left out (catalog-sets.ts).
    @MainActor
    static func sets(of catalog: String) async throws -> [AdsCatalogRow] {
        try await ERPAPI.shared.get("/api/ads/catalog?catalog=\(AdsQuery.escape(catalog))", as: AdsCatalogsAnswer.self).sets
    }
}

struct AdsCatalogSection: View {
    @Binding var choice: AdsCatalogChoice

    var body: some View {
        Section {
            if let problem = choice.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
            }
            if let catalogs = choice.catalogs {
                if catalogs.isEmpty {
                    Text("The Meta business has no catalogue yet: connect one in Shopify's Facebook & Instagram app.").foregroundStyle(.secondary)
                } else if catalogs.count > 1 {
                    Picker("Catalogue", selection: $choice.catalogId) {
                        Text("Choose one").tag("")
                        ForEach(catalogs) { (c: AdsCatalogRow) in Text(c.words).tag(c.id) }
                    }
                }
            } else if choice.problem == nil {
                MarketingReading(text: "Reading the catalogues…")
            }
            if !choice.catalogId.isEmpty {
                if let sets = choice.sets {
                    Picker("Pieces", selection: $choice.setId) {
                        ForEach(sets) { (s: AdsCatalogRow) in Text(s.words).tag(s.id) }
                    }
                } else {
                    MarketingReading(text: "Reading its product sets…")
                }
            }
            Picker("Who", selection: $choice.who) {
                Text("Bring back lookers").tag("viewers")
                Text("Find new buyers").tag("everyone")
            }
            #if os(macOS)
            .pickerStyle(.menu)
            #else
            .pickerStyle(.segmented)
            #endif
        } header: {
            #if os(macOS)
            Text("The catalogue")
            #else
            LedgerHeading(title: "The catalogue")
            #endif
        } footer: {
            Text(choice.who == "viewers"
                 ? "People who looked at or carted a piece in the last 14 days and didn't buy see those pieces again."
                 : "Meta finds new people for the pieces; anyone who bought in the last 14 days is left out. Each ad is built from the catalogue's own photos, names and prices.")
        }
    }
}

// MARK: Bidding and hours

/// Ads Manager's bid strategy and "run ads on a schedule" (plan.ts Bidding, AdHours), folded away by default.
struct AdsAdvanced: Equatable {
    var open = false
    /// lowest, cost_cap, bid_cap or min_roas.
    var bid = "lowest"
    var amount = ""
    var roas = "3"
    var hoursOn = false
    /// 0 = Sunday … 6 = Saturday.
    var days: Set<Int> = Set(0...6)
    var from = 10
    var to = 23

    var bidding: [String: Any] {
        switch bid {
        case "cost_cap", "bid_cap": return ["kind": bid, "amount": AdsAmount.parse(amount) ?? 0]
        case "min_roas": return ["kind": "min_roas", "roas": ShopNumber.parse(roas) ?? 0]
        default: return ["kind": "lowest"]
        }
    }

    /// Minutes from midnight in the viewer's own time, as plan.ts AdHours.
    var hours: Any {
        if !hoursOn { return NSNull() }
        let h: [String: Any] = ["days": days.sorted(), "from": from * 60, "to": to * 60]
        return h
    }

    var isSet: Bool { bid != "lowest" || hoursOn }
}

struct AdsAdvancedSection: View {
    @Binding var advanced: AdsAdvanced
    /// Ticking hours moves the budget to a total one (Meta runs set hours only on a lifetime budget).
    let needsTotal: () -> Void
    let sales: Bool
    let currency: String

    private static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var body: some View {
        Section {
            DisclosureGroup(isExpanded: $advanced.open) {
                Picker("Bidding", selection: $advanced.bid) {
                    Text("Most results").tag("lowest")
                    Text("Cost per result about…").tag("cost_cap")
                    Text("Never bid more than…").tag("bid_cap")
                    if sales { Text("Sales of at least … × spend").tag("min_roas") }
                }
                if advanced.bid == "cost_cap" || advanced.bid == "bid_cap" {
                    LabeledContent(advanced.bid == "cost_cap" ? "Per result (\(currency))" : "Highest bid (\(currency))") {
                        TextField("Amount", text: $advanced.amount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                }
                if advanced.bid == "min_roas" {
                    LabeledContent("Sales ×") {
                        TextField("3", text: $advanced.roas)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                }
                Toggle("Run only on set days and hours", isOn: hoursBinding).tint(Theme.accent)
                if advanced.hoursOn {
                    #if os(macOS)
                    HStack(spacing: 6) {
                        ForEach(0..<7, id: \.self) { (d: Int) in
                            Toggle(Self.dayNames[d], isOn: Binding(get: { advanced.days.contains(d) }, set: { (on: Bool) in
                                if on { advanced.days.insert(d) } else { advanced.days.remove(d) }
                            }))
                        }
                    }
                    .controlSize(.small)
                    #else
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: pt(6)) {
                            ForEach(0..<7, id: \.self) { (d: Int) in
                                MarketingChip(title: Self.dayNames[d], selected: advanced.days.contains(d)) {
                                    if advanced.days.contains(d) { advanced.days.remove(d) } else { advanced.days.insert(d) }
                                }
                            }
                        }
                    }
                    #endif
                    Picker("From", selection: $advanced.from) {
                        ForEach(0..<24, id: \.self) { (h: Int) in Text(String(format: "%02d:00", h)).tag(h) }
                    }
                    Picker("Until", selection: $advanced.to) {
                        ForEach(1..<25, id: \.self) { (h: Int) in Text(h == 24 ? "Midnight" : String(format: "%02d:00", h)).tag(h) }
                    }
                }
            } label: {
                Text(advanced.isSet ? "Advanced: bidding and hours · set" : "Advanced: bidding and hours")
            }
        } footer: {
            if advanced.open { Text(note) }
        }
    }

    private var hoursBinding: Binding<Bool> {
        Binding(get: { advanced.hoursOn }, set: { (on: Bool) in
            advanced.hoursOn = on
            if on { needsTotal() }
        })
    }

    private var note: String {
        var lines: [String] = []
        switch advanced.bid {
        case "cost_cap": lines.append("Meta keeps the average cost per result near your figure; it may spend less of the budget.")
        case "bid_cap": lines.append("A hard ceiling on each auction bid; for people who know their numbers.")
        case "min_roas": lines.append("Meta aims for purchases worth at least this many times what it spends, and optimises for order value.")
        default: lines.append("Meta spends the budget for as many results as it can (the usual choice).")
        }
        if advanced.hoursOn { lines.append("Hours are each viewer's own time; Meta runs set hours only with a total budget.") }
        return lines.joined(separator: " ")
    }
}
