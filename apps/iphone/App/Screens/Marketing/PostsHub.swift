import SwiftUI
import ERPCore

/// Posts → Hub (src/app/posts/page.tsx): what went out today, where Taheri's gold post is, what waits in
/// the queue, and the website's pieces. A queued piece opens natively to be sent, held, timed or removed
/// (PostQueueSheet: where it goes is said in full before it goes). What makes a post (Post a piece's
/// designer and story editor, the tray with its captions, Investments) and spreading the queue over a day
/// are the ERP's own pages, opened in the app.
struct PostsHub: View {
    @Environment(Session.self) private var session
    private var store: PostsStore { PostsStore.shared }
    @State private var showAllToday = false
    @State private var go: Route?
    /// A queued piece opened to send, hold, time or remove (PostQueueSheet).
    @State private var opened: Opened?

    struct Opened: Identifiable { let id: String }

    private var hasPostPiece: Bool { MarketingKit.has("/website/post", role: session.role) }
    private var hasInvestments: Bool { MarketingKit.has("/website/investments", role: session.role) }
    private var hasWebsite: Bool { MarketingKit.has("/website/photos", role: session.role) }

    var body: some View {
        List {
            Group {
                makeSection
                failingSection
                todaySection
                goldSection
                queueSection
                siteSection
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Posts")
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        .refreshable { await store.load(gold: hasInvestments) }
        .sheet(item: $opened) { (o: Opened) in PostQueueSheet(id: o.id) }
        .task { await store.load(gold: hasInvestments) }
    }

    // MARK: Make a post

    @ViewBuilder
    private var makeSection: some View {
        Section {
            if hasPostPiece {
                MarketingLink(title: "New piece", subtitle: "Post a piece: new photographs, a story, a caption", symbol: "camera", path: "/website/post?new=1")
            }
            if hasInvestments {
                MarketingLink(title: "Investments", subtitle: "The day's gold post", symbol: "chart.line.uptrend.xyaxis", path: "/website/investments")
            }
            MarketingLink(title: "Pick, caption and send", subtitle: "Website pieces to the groups and the channel, or into the queue", symbol: "paperplane", path: MarketingKit.postsWeb)
            if hasWebsite {
                MarketingLink(title: "The website", subtitle: "Add photos, edit a piece, photo weights", symbol: "globe", path: MarketingKit.websitePath)
            }
        }
    }

    // MARK: The posting lines

    /// A broken line is seen before anything is sent (the web's checks strip): only what has failed.
    @ViewBuilder
    private var failingSection: some View {
        let failing = store.failingChecks
        if !failing.isEmpty {
            Section {
                ForEach(failing) { (c: PostCheck) in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(c.group): \(c.label)").font(.body.weight(.medium))
                            Text(c.fix ?? c.detail).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                LedgerHeading(title: "Needs a look")
            }
        }
    }

    // MARK: Today

    @ViewBuilder
    private var todaySection: some View {
        let today = store.sentToday
        Section {
            if store.sent == nil {
                if let problem = store.sentError {
                    Text(problem).foregroundStyle(.secondary)
                } else {
                    MarketingReading(text: "Reading what went out…")
                }
            } else if today.isEmpty {
                quietDay
            } else {
                ForEach(showAllToday ? today : Array(today.prefix(4))) { (s: PostSent) in sentRow(s) }
                if today.count > 4 {
                    Button(showAllToday ? "Fewer" : "\(today.count - 4) more today") { showAllToday.toggle() }
                }
            }
        } header: {
            LedgerHeading(title: "Today")
        } footer: {
            if let latest = today.first {
                Text("\(today.count) out · last \(MarketingTime.clock(latest.at))")
            }
        }
    }

    private var quietDay: some View {
        Group {
            if let earlier = store.lastEarlier {
                let what = earlier.title.isEmpty ? "a post" : earlier.title
                Label("Nothing out yet. The last was \(what), \(MarketingTime.weekday(earlier.at)) at \(MarketingTime.clock(earlier.at)).", systemImage: "clock")
                    .foregroundStyle(.secondary)
            } else {
                Label("Nothing in the last two days.", systemImage: "clock").foregroundStyle(.secondary)
            }
        }
    }

    private func sentRow(_ s: PostSent) -> some View {
        let places = s.destinations.map { (d: String) in store.placeName(d) }.joined(separator: ", ")
        let storyOnly = s.destinations.contains("instagram-story") && !s.destinations.contains { (d: String) in d.hasPrefix("whatsapp") }
        let title = s.title.isEmpty ? (storyOnly ? "A story" : "A post") : s.title
        return HStack(spacing: 12) {
            sentPicture(s, storyOnly: storyOnly)
            TwoLine(title: title, subtitle: places, trailing: MarketingTime.clock(s.at))
        }
    }

    @ViewBuilder
    private func sentPicture(_ s: PostSent, storyOnly: Bool) -> some View {
        if let id = s.sitePiece, let piece = store.piece(id) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: 10))
        } else {
            Image(systemName: storyOnly ? "camera.aperture" : "bubble.left.and.bubble.right")
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: .rect(cornerRadius: 10))
        }
    }

    // MARK: Taheri's gold post

    @ViewBuilder
    private var goldSection: some View {
        if hasInvestments {
            Section {
                NavigationLink(value: Route(path: "/website/investments")) {
                    VStack(alignment: .leading, spacing: 3) {
                        Label("Gold post", systemImage: "chart.line.uptrend.xyaxis")
                        Text(goldLine).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            } header: {
                LedgerHeading(title: "Investments")
            }
        }
    }

    /// Each part sent (at what time) or waiting; before the routine files it, the web's own line.
    private var goldLine: String {
        guard let post = store.gold else { return "Not here yet: the routine files it after 11:00." }
        let parts = store.goldParts.map { (t: String) -> String in
            let name = PostsStore.goldWords[t] ?? t
            if let at = post.sent[t] { return "\(name) \(MarketingTime.clock(at))" }
            return "\(name) waiting"
        }
        return parts.joined(separator: " · ")
    }

    // MARK: The queue

    @ViewBuilder
    private var queueSection: some View {
        let items = store.queueShown
        if !items.isEmpty {
            Section {
                ForEach(items) { (e: PostQueueEntry) in queueRow(e) }
                MarketingLink(title: "Spread the queue over the day", subtitle: "In the ERP", symbol: "clock", path: MarketingKit.postsWeb)
            } header: {
                LedgerHeading(title: "In the queue")
            }
        }
    }

    /// Opens the piece: where it goes, word for word, and Send now, Hold, a time or Remove.
    private func queueRow(_ e: PostQueueEntry) -> some View {
        Button { opened = Opened(id: e.id) } label: {
            HStack(spacing: 12) {
                StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: 10))
                TwoLine(title: e.headline.isEmpty ? "A piece" : e.headline, subtitle: queueNote(e))
                queueBadge(e)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func queueNote(_ e: PostQueueEntry) -> String {
        let places = store.queueWhere(e)
        switch e.status {
        case "scheduled": return "\(ShopDate.say(e.dueAt, withTime: true)) · \(places)"
        case "failed": return e.lastError ?? "It did not all go. \(places)"
        case "sent": return "Sent \(MarketingTime.clock(e.sentAt)) · \(places)"
        default: return places
        }
    }

    private func queueBadge(_ e: PostQueueEntry) -> some View {
        let words: (String, Color)
        switch e.status {
        case "scheduled": words = ("Scheduled", .blue)
        case "sending": words = ("Sending", .orange)
        case "sent": words = ("Sent", .green)
        case "failed": words = ("Failed", .red)
        case "draft": words = ("Making", .secondary)
        default: words = ("Held", .secondary)
        }
        return StatusBadge(words.0, color: words.1)
    }

    // MARK: The website's pieces

    @ViewBuilder
    private var siteSection: some View {
        switch store.piecesPhase {
        case .off:
            EmptyView()
        case .idle, .loading:
            Section { MarketingReading(text: "Reading the website…") } header: { Text("From the website") }
        case .failed(let message):
            Section {
                Text(message).foregroundStyle(.secondary)
                Button("Try again") { Task { await store.load(gold: hasInvestments) } }
            } header: {
                LedgerHeading(title: "From the website")
            }
        case .loaded:
            loadedSite
        }
    }

    @ViewBuilder
    private var loadedSite: some View {
        let fresh = store.pieces.filter { (p: PostPiece) in p.newArrival }
        let strip = Array((fresh.isEmpty ? store.pieces : fresh).prefix(12))
        Section {
            if !strip.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(strip) { (p: PostPiece) in
                            Button { go = Route(path: MarketingKit.piecePath(p.id)) } label: {
                                PostPieceTile(piece: p, posted: store.posted[p.id]).frame(width: 112)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
                .listRowInsets(EdgeInsets())
            }
            MarketingLink(title: "All \(store.pieces.count) pieces", subtitle: "Search by name or collection", symbol: "square.grid.2x2", path: MarketingKit.piecesPath)
        } header: {
            Text(fresh.isEmpty ? "From \(store.siteName)" : "New on \(store.siteName)")
        }
    }
}

/// A website piece as a tile: its photo, its name, and when it last went out (or its collection).
struct PostPieceTile: View {
    let piece: PostPiece
    var posted: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 12))
                .overlay(alignment: .topLeading) {
                    if piece.newArrival {
                        Text("New")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.ultraThinMaterial, in: .capsule)
                            .padding(6)
                    }
                }
            Text(piece.name).font(.caption.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
            Text(note).font(.caption2).foregroundStyle(noteColor).lineLimit(1)
        }
    }

    /// Amber when it went out today, the web's cue not to send it again.
    private var noteColor: Color {
        if let days = MarketingTime.daysAgo(posted), days < 1 { return .orange }
        return .secondary
    }

    private var note: String {
        if let ago = MarketingTime.postedAgo(posted) { return ago }
        return piece.collection
    }
}
