import SwiftUI
import ERPCore

/// Posts → Hub (src/app/posts/page.tsx): what went out today, where Taheri's gold post is, what waits in
/// the queue, and the website's pieces. A queued piece opens natively to be sent, held, timed or removed
/// (PostQueueSheet: where it goes is said in full before it goes); the whole queue is sent at once or spread
/// over the day (PostQueueSpreadSheet). Pick, caption and send is the tray (PostTrayScreen).
struct PostsHub: View {
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var store: PostsStore { PostsStore.shared }
    @State private var showAllToday = false
    @State private var go: Route?
    /// A queued piece opened to send, hold, time or remove (PostQueueSheet).
    @State private var opened: Opened?
    @State private var spreading = false
    @State private var confirmingAll = false
    @State private var sendingAll = false
    @State private var note: Note?

    struct Opened: Identifiable { let id: String }

    // Design and the old Post a piece composer are Posts' tab (Hub · Design · Investments), reached from the title menu, not rows here.
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
        .sheet(isPresented: $spreading) {
            PostQueueSpreadSheet { (n: Note) in Note.show(n, in: $note, reduce: reduceMotion) }
        }
        .confirmationDialog(sendAllTitle, isPresented: $confirmingAll, titleVisibility: .visible) {
            Button(store.failingChecks.isEmpty ? "Send" : "Send anyway") { Task { await sendAll() } }
            Button("Not yet", role: .cancel) {}
        } message: {
            Text(sendAllWords)
        }
        .noteToast($note)
        .task { await store.load(gold: hasInvestments) }
    }

    // MARK: Make a post

    @ViewBuilder
    private var makeSection: some View {
        Section {
            if hasInvestments {
                MarketingLink(title: "Investments", symbol: "chart.line.uptrend.xyaxis", path: "/website/investments")
            }
            MarketingLink(title: "Pick, caption and send", symbol: "paperplane", path: MarketingKit.trayPath())
            if hasWebsite {
                MarketingLink(title: "The website", symbol: "globe", path: MarketingKit.websitePath)
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
                    // The section says what it is; each row's one colour is its title.
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(c.group): \(c.label)").font(.body.weight(.medium)).foregroundStyle(Tone.owed.color).lineLimit(1)
                        Text(c.fix ?? c.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
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
            // The count once, in the header; each row carries its own time.
            LedgerHeading(title: "Today", count: today.isEmpty ? nil : today.count)
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
            TwoLine(title: title, subtitle: places, trailing: MarketingTime.clock(s.at)).lineLimit(1)
        }
    }

    @ViewBuilder
    private func sentPicture(_ s: PostSent, storyOnly: Bool) -> some View {
        if let id = s.sitePiece, let piece = store.piece(id) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
        } else {
            Image(systemName: storyOnly ? "camera.aperture" : "bubble.left.and.bubble.right")
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
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
                let waiting = store.waiting.count
                if waiting > 0 {
                    Button { confirmingAll = true } label: {
                        Label(sendingAll ? "Sending…" : waiting > 1 ? "Send all \(waiting) now" : "Send it now", systemImage: "paperplane")
                    }
                    .disabled(sendingAll)
                    Button { spreading = true } label: { Label("Spread over the day", systemImage: "clock") }
                        .disabled(sendingAll)
                }
            } header: {
                LedgerHeading(title: "In the queue")
            }
        }
    }

    private var sendAllTitle: String {
        let n = store.waiting.count
        return n > 1 ? "Send all \(n) pieces now?" : "Send it now?"
    }

    /// Each piece and where it goes, in the order they go, and what is failing now (queue-panel.tsx's confirm).
    private var sendAllWords: String {
        var out = store.waiting.map { (e: PostQueueEntry) in "• \(e.headline.isEmpty ? "Untitled" : e.headline) → \(store.queueWhere(e))" }.joined(separator: "\n")
        out += "\n\nOne after another, in this order. A post can't be unsent from here."
        let failing = store.failingChecks
        if !failing.isEmpty {
            out += "\n\nThis will probably fail:\n" + failing.map { (c: PostCheck) in "\(c.label): \(c.fix ?? c.detail)" }.joined(separator: "\n")
        }
        return out
    }

    private func sendAll() async {
        sendingAll = true
        defer { sendingAll = false }
        let r = await store.sendAll()
        let whole = r.sent == r.of
        Note.show(Note(title: whole ? "All \(r.of) sent" : "\(r.sent) of \(r.of) sent",
                       detail: whole ? "" : "The ones that failed say why; sending again sends only what didn't go.", failed: !whole), in: $note, reduce: reduceMotion)
    }

    /// Opens the piece: where it goes, word for word, and Send now, Hold, a time or Remove.
    private func queueRow(_ e: PostQueueEntry) -> some View {
        Button { opened = Opened(id: e.id) } label: {
            HStack(spacing: 12) {
                StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                TwoLine(title: e.headline.isEmpty ? "A piece" : e.headline, subtitle: queueNote(e)).lineLimit(1)
                queueBadge(e)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// The row's one quiet line: when it goes (or went) and where. The state is in these words, not a tag.
    private func queueNote(_ e: PostQueueEntry) -> String {
        let places = store.queueWhere(e)
        switch e.status {
        case "scheduled": return "\(ShopDate.say(e.dueAt, withTime: true)) · \(places)"
        case "failed": return e.lastError ?? "It did not all go. \(places)"
        case "sent": return "Sent \(MarketingTime.clock(e.sentAt)) · \(places)"
        case "sending": return "Sending · \(places)"
        case "draft": return "Still arriving · \(places)"
        default: return "Held · \(places)"
        }
    }

    /// Only what needs someone is a tag (CONVENTIONS rule 15): a piece that didn't all go.
    @ViewBuilder
    private func queueBadge(_ e: PostQueueEntry) -> some View {
        if e.status == "failed" { Pill("Failed", tone: .problem) }
    }

    // MARK: The website's pieces

    @ViewBuilder
    private var siteSection: some View {
        switch store.piecesPhase {
        case .off:
            EmptyView()
        case .idle, .loading:
            Section { MarketingReading(text: "Reading the website…") } header: { LedgerHeading(title: "From the website") }
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
            MarketingLink(title: "All \(store.pieces.count) pieces", symbol: "square.grid.2x2", path: MarketingKit.piecesPath)
        } header: {
            LedgerHeading(title: fresh.isEmpty ? "From \(store.siteName)" : "New on \(store.siteName)")
        }
    }
}

/// A website piece as a tile: its photo, its name, and when it last went out (or that it is new, or its collection).
struct PostPieceTile: View {
    let piece: PostPiece
    var posted: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            Text(piece.name).font(.caption.weight(.semibold)).lineLimit(1).multilineTextAlignment(.leading)
            Text(note).font(.caption2).foregroundStyle(noteColor).lineLimit(1)
        }
    }

    /// Amber when it went out today, the web's cue not to send it again.
    private var noteColor: Color {
        if let days = MarketingTime.daysAgo(posted), days < 1 { return .orange }
        return .secondary
    }

    /// When it last went out, else "New" in the quiet line (no tag on the photo), else its collection.
    private var note: String {
        if let ago = MarketingTime.postedAgo(posted) { return ago }
        return piece.newArrival ? ["New", piece.collection].filter { !$0.isEmpty }.joined(separator: " · ") : piece.collection
    }
}
