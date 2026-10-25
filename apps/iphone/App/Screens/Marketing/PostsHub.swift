import SwiftUI
#if os(macOS)
import AppKit
#endif
import ERPCore

/// Posts → Hub (src/app/posts/page.tsx): what went out today, where Taheri's gold post is, what waits in
/// the queue, and the website's pieces. A queued piece opens natively to be sent, held, timed or removed
/// (PostQueueSheet: where it goes is said in full before it goes); the whole queue is sent at once or spread
/// over the day (PostQueueSpreadSheet). Pick, caption and send is the tray (PostTrayScreen).
struct PostsHub: View {
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    private var store: PostsStore { PostsStore.shared }
    @State private var showAllToday = false
    @State private var go: Route?
    /// A queued piece opened to send, hold, time or remove (PostQueueSheet).
    @State private var opened: Opened?
    @State private var spreading = false
    @State private var confirmingAll = false
    @State private var sendingAll = false
    @State private var note: Note?
    /// The connection checks stay folded until tapped, even when something fails (owner, 2026-10-23).
    @State private var checksOpen = false

    struct Opened: Identifiable { let id: String }
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    /// A queued piece the Mac's right-click asked to remove (asks first).
    @State private var removing: Opened?
    @State private var refused: String?
    /// The table: what is picked, how it is sorted, the search; which of the hub's two views shows; the piece waiting for the yes
    /// that sends it, the piece being given a time, and the website piece picked in the gallery.
    @State private var macSelection = Set<String>()
    @State private var macSort = [KeyPathComparator(\MacPostsRow.rank), KeyPathComparator(\MacPostsRow.when)]
    @State private var macQuery = ""
    @State private var macMode = MacPostsMode.posts
    @State private var macSending: Opened?
    @State private var macTiming: Opened?
    @State private var macPiece: String?
    #endif

    // Design and the old Post a piece composer are Posts' tab (Hub · Design · Investments), reached from the title menu, not rows here.
    private var hasInvestments: Bool { MarketingKit.has("/website/investments", role: session.role) }
    private var hasWebsite: Bool { MarketingKit.has("/website/photos", role: session.role) }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
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
        .hubTitleDisplay()
        // An iPad's rows sit in a centred column rather than across the whole window.
        .readableColumn(860)
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        .refreshable { await store.load(gold: hasInvestments) }
        .sheet(item: $opened) { (o: Opened) in PostQueueSheet(id: o.id).presentationSizing(.form) }
        .sheet(isPresented: $spreading) {
            PostQueueSpreadSheet { (n: Note) in Note.show(n, in: $note, reduce: reduceMotion) }
                .presentationSizing(.form)
        }
        .confirmationDialog(sendAllTitle, isPresented: $confirmingAll, titleVisibility: .visible) {
            Button(store.failingChecks.isEmpty ? "Send" : "Send anyway") { Task { await sendAll() } }
            Button("Not yet", role: .cancel) {}
        } message: {
            Text(sendAllWords)
        }
        .noteToast($note)
        .motion(store.queueShown.map(\.id))
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
                DisclosureGroup(isExpanded: $checksOpen) {
                    ForEach(failing) { (c: PostCheck) in
                        HStack(alignment: .top, spacing: pt(10)) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Tone.owed.color)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(c.group): \(c.label)").font(.body.weight(.medium))
                                Text(c.fix ?? c.detail).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                } label: {
                    Label("\(failing.count) \(failing.count == 1 ? "thing needs" : "things need") attention", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Tone.owed.color)
                }
                .motion(checksOpen)
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
        return HStack(spacing: pt(12)) {
            sentPicture(s, storyOnly: storyOnly)
            TwoLine(title: title, subtitle: places, trailing: MarketingTime.clock(s.at))
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
                    Button { spreading = true } label: { Label("Spread over the day", systemImage: "clock") }
                        .disabled(sendingAll)
                    Button { confirmingAll = true } label: {
                        Label(sendingAll ? "Sending…" : waiting > 1 ? "Send all \(waiting) now" : "Send it now", systemImage: "paperplane")
                    }
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
        let n = store.waiting.count
        guard n > 0 else { return }
        Note.show(Note(title: "Sending \(n) \(n == 1 ? "piece" : "pieces")…", detail: "It says here when they have gone."), in: $note, reduce: reduceMotion)
        // In the Outbox: the hub is free at once; "sendNow" only sends what has not gone, so a Retry posts nothing twice.
        Outbox.shared.post(label: "Send \(n) queued \(n == 1 ? "piece" : "pieces")") {
            let r = await PostsStore.shared.sendAll()
            if r.sent == r.of { return "All \(r.of) sent" }
            throw ERPAPI.Failure(status: 400, message: "\(r.sent) of \(r.of) sent. The ones that failed say why; Retry sends only what didn't go.")
        }
    }

    /// Opens the piece: where it goes, word for word, and Send now, Hold, a time or Remove.
    private func queueRow(_ e: PostQueueEntry) -> some View {
        Button { opened = Opened(id: e.id) } label: {
            HStack(spacing: pt(12)) {
                StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
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

    /// Sent is the expected end: no tag, the line already says when (CONVENTIONS rule 15).
    private func queueBadge(_ e: PostQueueEntry) -> some View {
        let words: (String, Tone)?
        switch e.status {
        case "scheduled": words = ("Scheduled", .working)
        case "sending": words = ("Sending", .owed)
        case "failed": words = ("Failed", .problem)
        case "draft": words = ("Making", .quiet)
        case "sent": words = nil
        default: words = ("Held", .quiet)
        }
        return Group { if let words { Pill(words.0, tone: words.1) } }
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
                Button("Try again") { Task { await store.load(gold: hasInvestments) } }.buttonStyle(.bordered)
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
            if !strip.isEmpty && sizeClass.isPadLayout && !typeSize.isAccessibilitySize {
                // The same tiles as an adaptive grid: all twelve in sight, none behind a swipe.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: pt(12), alignment: .top)], spacing: pt(14)) {
                    ForEach(strip) { (p: PostPiece) in
                        Button { go = Route(path: MarketingKit.piecePath(p.id)) } label: {
                            PostPieceTile(piece: p, posted: store.posted[p.id])
                        }
                        .buttonStyle(.plain)
                        .pointerHover()
                    }
                }
                .padding(.horizontal, pt(16))
                .padding(.vertical, pt(10))
                .listRowInsets(EdgeInsets())
            } else if !strip.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: pt(12)) {
                        ForEach(strip) { (p: PostPiece) in
                            Button { go = Route(path: MarketingKit.piecePath(p.id)) } label: {
                                PostPieceTile(piece: p, posted: store.posted[p.id]).frame(width: 112)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, pt(16))
                    .padding(.vertical, pt(10))
                }
                .listRowInsets(EdgeInsets())
            }
            MarketingLink(title: "All \(store.pieces.count) pieces", symbol: "square.grid.2x2", path: MarketingKit.piecesPath)
        } header: {
            LedgerHeading(title: fresh.isEmpty ? "From \(store.siteName)" : "New on \(store.siteName)")
        }
    }
}

/// A website piece as a tile: its photo, its name, and when it last went out (or its collection).
struct PostPieceTile: View {
    let piece: PostPiece
    var posted: String?

    var body: some View {
        VStack(alignment: .leading, spacing: pt(5)) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if piece.newArrival {
                        Text("New")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.onAccent)
                            .padding(.horizontal, pt(6)).padding(.vertical, pt(2))
                            .background(Theme.accent, in: .capsule)
                            .padding(pt(6))
                    }
                }
            Text(piece.name).font(.caption.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
            Text(note).font(.caption2).foregroundStyle(noteColor).lineLimit(1)
        }
    }

    /// Amber when it went out today, the web's cue not to send it again.
    private var noteColor: Color {
        if let days = MarketingTime.daysAgo(posted), days < 1 { return Tone.owed.color }
        return .secondary
    }

    private var note: String {
        if let ago = MarketingTime.postedAgo(posted) { return ago }
        return piece.collection
    }
}

#if os(macOS)
// MARK: - The Mac's Posts (docs/features/mac-design.md, "Marketing › Posts")
//
// What went out today and what waits in the queue are one table (When, What, Where, Status) with the inspector for the post that is
// picked: its caption, the places and what has gone, Send Now, Hold, Send at… and Remove. The website's pieces are the toolbar's
// other view. The sending, holding, timing and removing are the store's own; the queue's words are PostQueueSheet's.

/// The hub's two views, in the toolbar.
enum MacPostsMode: String, CaseIterable {
    case posts, site
}

/// One line of the table: a piece in the queue, or something that went out today.
struct MacPostsRow: Identifiable {
    let id: String
    let entry: PostQueueEntry?
    let sent: PostSent?
    let title: String
    let place: String
    let status: String
    let tone: Tone
    /// Failed first, then what is going, what is timed, what is held; what went last.
    let rank: Int
    let when: Date
    let whenText: String
}

/// "Send at…": the time a held or timed piece goes. A short task, so a sheet; its button says what it does.
struct MacPostsTimeSheet: View {
    let title: String
    let schedule: (Date) -> Void
    @State private var when: Date
    @Environment(\.dismiss) private var dismiss

    init(title: String, schedule: @escaping (Date) -> Void) {
        self.title = title
        self.schedule = schedule
        _when = State(initialValue: Date().addingTimeInterval(3600))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Send “\(title)” at").font(.headline)
            DatePicker("Send at", selection: $when, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                .environment(\.timeZone, ERPDate.karachi)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Schedule for \(ShopDate.stamp(when, withTime: true))") { schedule(when); dismiss() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}

extension PostsHub {
    @ViewBuilder
    var macBody: some View {
        macDialogs(
            macLayout
                .navigationTitle("Posts")
                .navigationSubtitle(macSubtitle)
                .toolbar { macToolbar }
                .macRecordMenu(macMenu)
                .macRefresh { Task { await store.load(gold: hasInvestments) } }
                .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
                .task { await store.load(gold: hasInvestments) }
        )
    }

    private func macDialogs<Content: View>(_ content: Content) -> some View {
        content
            .sheet(isPresented: $spreading) {
                PostQueueSpreadSheet { (n: Note) in Note.show(n, in: $note, reduce: reduceMotion) }
                    .presentationSizing(.form)
            }
            .sheet(item: $macTiming) { (o: Opened) in
                MacPostsTimeSheet(title: store.queue.first(where: { $0.id == o.id })?.headline ?? "the piece") { (at: Date) in macSchedule(o.id, at) }
            }
            .confirmationDialog(sendAllTitle, isPresented: $confirmingAll, titleVisibility: .visible) {
                Button(store.failingChecks.isEmpty ? "Send" : "Send anyway") { Task { await sendAll() } }
                Button("Not yet", role: .cancel) {}
            } message: {
                Text(sendAllWords)
            }
            .confirmationDialog("Send this now?", isPresented: Binding(get: { macSending != nil }, set: { if !$0 { macSending = nil } }), titleVisibility: .visible) {
                Button("Send Now") { if let id = macSending?.id, let e = store.queue.first(where: { $0.id == id }) { macSend(e) }; macSending = nil }
                Button("Not yet", role: .cancel) { macSending = nil }
            } message: {
                if let id = macSending?.id, let e = store.queue.first(where: { $0.id == id }) { Text(PostQueueSheet(id: id).sendWords(e)) }
            }
            .confirmDestructive(isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                                title: "Remove it from the queue?", message: "It will not go out.",
                                action: "Remove") {
                if let id = removing?.id { Task { do { try await store.remove(id) } catch { refused = error.localizedDescription } } }
                removing = nil
            }
            .failureAlert($refused, title: "Not now")
            .noteToast($note)
            .motion(store.queueShown.map(\.id))
    }

    // MARK: The window

    @ViewBuilder
    private var macLayout: some View {
        if macMode == .site {
            macPieces.macSummaryBar(macSiteSummary)
        } else {
            VStack(spacing: 0) {
                macChecks
                macTable
            }
            .macSummaryBar(macSummaryParts)
            .macSearchable(text: $macQuery, prompt: "Search posts")
            .macInspector { macInspectorBody }
        }
    }

    private var macSubtitle: String {
        let out = store.sentToday.count
        let waiting = store.waiting.count
        var parts: [String] = []
        if out > 0 { parts.append("\(out) out today") }
        if waiting > 0 { parts.append("\(waiting) in the queue") }
        return parts.joined(separator: " · ")
    }

    private var macSummaryParts: [String] {
        var parts: [String] = []
        let out = store.sentToday.count
        let waiting = store.waiting.count
        parts.append("\(out) out today")
        parts.append("\(waiting) waiting in the queue")
        if hasInvestments { parts.append("Gold post: " + goldLine) }
        return parts
    }

    private var macSiteSummary: [String] {
        guard store.piecesPhase == .loaded else { return [] }
        let fresh = store.pieces.filter { (p: PostPiece) in p.newArrival }
        return fresh.isEmpty ? ["\(store.pieces.count) pieces on \(store.siteName)"] : ["\(fresh.count) new on \(store.siteName)", "\(store.pieces.count) pieces in all"]
    }

    @ToolbarContentBuilder
    private var macToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $macMode) {
                Text("Today and Queue").tag(MacPostsMode.posts)
                Text("From the Website").tag(MacPostsMode.site)
            }
            .pickerStyle(.segmented)
            .help("What went out and what waits, or the website's pieces to post")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            MacToolbarAction(action: macNewPost)
            if macMode == .posts {
                MacToolbarAction(action: macSendNow(macSelectedEntries.first, count: macSelectedEntries.count))
                MacToolbarAction(action: macHold(macSelectedEntries.first, count: macSelectedEntries.count))
                MacToolbarAction(action: macSendAt(macSelectedEntries.first, count: macSelectedEntries.count))
                Menu {
                    Button("Spread Over the Day…", systemImage: "clock") { spreading = true }.disabled(store.waiting.isEmpty)
                    Button(store.waiting.count > 1 ? "Send All \(store.waiting.count) Now…" : "Send It Now…", systemImage: "paperplane") { confirmingAll = true }
                        .disabled(store.waiting.isEmpty || sendingAll)
                } label: { Label("Queue", systemImage: "tray.full") }
                .help("Send what waits in the queue, or spread it over the day")
            }
        }
    }

    // MARK: Actions

    private var macSelectedEntries: [PostQueueEntry] {
        macRows.filter { (r: MacPostsRow) in macSelection.contains(r.id) }.compactMap { (r: MacPostsRow) in r.entry }
    }

    private var macNewPost: MacAction {
        MacAction("New Post…", symbol: "square.and.pencil", shortcut: KeyboardShortcut("n", modifiers: [.command, .control])) {
            macOpenWindow(MarketingKit.trayPath())
        }
    }

    private func macSendNow(_ e: PostQueueEntry?, count: Int) -> MacAction {
        let can = count == 1 && ["held", "scheduled", "failed"].contains(e?.status ?? "")
        return MacAction(e?.status == "failed" ? "Send What Is Left" : "Send Now", symbol: "paperplane.fill",
                         shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: can, isDefault: true, id: "send") {
            if let e { macSending = Opened(id: e.id) }
        }
    }

    private func macHold(_ e: PostQueueEntry?, count: Int) -> MacAction {
        MacAction("Hold", symbol: "pause.circle", enabled: count == 1 && e?.status == "scheduled") {
            if let e { macHoldIt(e.id) }
        }
    }

    private func macSendAt(_ e: PostQueueEntry?, count: Int) -> MacAction {
        MacAction("Send at…", symbol: "clock", enabled: count == 1 && ["held", "scheduled", "failed"].contains(e?.status ?? ""), id: "send-at") {
            if let e { macTiming = Opened(id: e.id) }
        }
    }

    private func macRemove(_ e: PostQueueEntry?, count: Int) -> MacAction {
        MacAction("Remove…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive,
                  enabled: count == 1 && !["sent", "sending"].contains(e?.status ?? "sent"), id: "remove") {
            if let e { removing = Opened(id: e.id) }
        }
    }

    private var macSpread: MacAction {
        MacAction("Spread Over the Day…", symbol: "clock", enabled: !store.waiting.isEmpty) { spreading = true }
    }

    private var macSendAll: MacAction {
        MacAction("Send All Now…", symbol: "paperplane", enabled: !store.waiting.isEmpty && !sendingAll) { confirmingAll = true }
    }

    private func macGroups(_ entries: [PostQueueEntry]) -> [[MacAction]] {
        let one = entries.first
        let n = entries.count
        return [[macSendNow(one, count: n), macHold(one, count: n), macSendAt(one, count: n), macRemove(one, count: n)],
                [macSpread, macSendAll],
                [macNewPost]]
    }

    private var macMenu: MacRecordMenu { MacRecordMenu(title: "Post", groups: macGroups(macSelectedEntries)) }

    private func macOpenWindow(_ path: String) {
        if let openPlace { openPlace(Route(path: path)) } else { go = Route(path: path) }
    }

    /// Hold, send at a time and send now: the store's own calls, handed to the Outbox so the table is free at once.
    private func macHoldIt(_ id: String) {
        Outbox.shared.post(label: "Hold the piece") { try await PostsStore.shared.hold(id); return "Held. It waits for you." }
    }

    private func macSchedule(_ id: String, _ at: Date) {
        Outbox.shared.post(label: "Schedule the piece") {
            try await PostsStore.shared.schedule(id, at: at)
            return "It goes " + ShopDate.say(at.ISO8601Format(), withTime: true) + "."
        }
    }

    private func macSend(_ e: PostQueueEntry) {
        let n = PostQueueSheet(id: e.id).places(e).filter { (p: PostQueueSheet.Place) in !p.units.allSatisfy { e.doneKeys.contains($0) } }.count
        let id = e.id
        Note.show(Note(title: "Sending to \(n) \(n == 1 ? "place" : "places")…", detail: "It says here when it has gone."), in: $note, reduce: reduceMotion)
        Outbox.shared.post(label: "Send “\(e.headline.isEmpty ? "a piece" : e.headline)”") {
            // A refusal is not retried by itself (a post must not go twice); the banner's Retry sends only what is left.
            let all: Bool
            do { all = try await PostsStore.shared.sendNow(id) } catch { throw ERPAPI.Failure(status: 400, message: error.localizedDescription) }
            if all { return "Posted to \(n) \(n == 1 ? "place" : "places")" }
            throw ERPAPI.Failure(status: 400, message: "Not all of it went. What failed is marked; Send what is left tries only those.")
        }
    }

    // MARK: The rows

    /// A queued piece's status in words, its tone, and where it sorts (failed first, what is going, what is timed, what is held; sent last).
    private func macStatusWords(_ status: String) -> (String, Tone, Int) {
        switch status {
        case "failed": return ("Failed", .problem, 0)
        case "sending": return ("Sending", .owed, 1)
        case "scheduled": return ("Scheduled", .working, 2)
        case "held": return ("Held", .quiet, 3)
        case "draft": return ("Making", .quiet, 4)
        case "sent": return ("Sent", .settled, 6)
        default: return (status.capitalized, .quiet, 5)
        }
    }

    private func macEntryRow(_ e: PostQueueEntry) -> MacPostsRow {
        let (word, tone, rank) = macStatusWords(e.status)
        let at: String? = e.status == "sent" ? e.sentAt : (e.status == "scheduled" ? e.dueAt : e.createdAt)
        return MacPostsRow(id: e.id, entry: e, sent: nil, title: e.headline.isEmpty ? "A piece" : e.headline, place: store.queueWhere(e),
                           status: word, tone: tone, rank: rank, when: ERPDate.parse(at) ?? Date.distantFuture, whenText: ShopDate.say(at, withTime: true))
    }

    private func macSentRow(_ s: PostSent) -> MacPostsRow {
        let storyOnly = s.destinations.contains("instagram-story") && !s.destinations.contains { (d: String) in d.hasPrefix("whatsapp") }
        let places = s.destinations.map { (d: String) in store.placeName(d) }.joined(separator: ", ")
        return MacPostsRow(id: "sent:" + s.id, entry: nil, sent: s, title: s.title.isEmpty ? (storyOnly ? "A story" : "A post") : s.title, place: places,
                           status: "Sent", tone: .settled, rank: 6, when: ERPDate.parse(s.at) ?? Date.distantPast, whenText: ShopDate.say(s.at, withTime: true))
    }

    /// The queue and what went out today. A piece the queue sent today that the day's log also has is shown once.
    private var macRows: [MacPostsRow] {
        let today = store.sentToday
        let went = Set(today.map { (s: PostSent) in s.title }.filter { (t: String) in !t.isEmpty })
        var out: [MacPostsRow] = []
        for e in store.queueShown {
            if e.status == "sent", went.contains(e.headline) { continue }
            out.append(macEntryRow(e))
        }
        for s in today { out.append(macSentRow(s)) }
        return out
    }

    private var macVisibleRows: [MacPostsRow] {
        let words = macQuery.lowercased().split(separator: " ").map(String.init)
        let rows = macRows.filter { (r: MacPostsRow) in
            words.isEmpty || words.allSatisfy { (w: String) in "\(r.title) \(r.place) \(r.status)".lowercased().contains(w) }
        }
        return rows.sorted(using: macSort)
    }

    // MARK: The table

    @ViewBuilder
    private var macChecks: some View {
        let failing = store.failingChecks
        if !failing.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Button { checksOpen.toggle() } label: {
                    Label("\(failing.count) \(failing.count == 1 ? "thing needs" : "things need") attention", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Tone.owed.color)
                }
                .buttonStyle(.plain)
                if checksOpen {
                    ForEach(failing) { (c: PostCheck) in
                        Text("\(c.group): \(c.label). \(c.fix ?? c.detail)").font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            Divider()
        }
    }

    private var macTable: some View {
        let rows = macVisibleRows
        return Table(rows, selection: $macSelection, sortOrder: $macSort) {
            TableColumn("When", value: \.when) { (r: MacPostsRow) in Text(r.whenText).monospacedDigit() }
                .width(min: 120, ideal: 150)
            TableColumn("What", value: \.title) { (r: MacPostsRow) in macWhat(r) }
            TableColumn("Where", value: \.place) { (r: MacPostsRow) in Text(r.place).foregroundStyle(.secondary).lineLimit(1) }
            TableColumn("Status", value: \.rank) { (r: MacPostsRow) in MacStatus(r.status, tone: r.tone) }
                .width(min: 90, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let entries = macRows.filter { (r: MacPostsRow) in ids.contains(r.id) }.compactMap { (r: MacPostsRow) in r.entry }
            MacActionItems(groups: macGroups(entries))
        } primaryAction: { (ids: Set<String>) in
            macOpen(ids)
        }
        .overlay {
            if rows.isEmpty {
                if store.sent == nil && store.sentError == nil {
                    MarketingReading(text: "Reading what went out…")
                } else {
                    ContentUnavailableView("Nothing out and nothing waiting", systemImage: "paperplane",
                                           description: Text(macQuiet))
                }
            }
        }
    }

    private var macQuiet: String {
        if let earlier = store.lastEarlier {
            let what = earlier.title.isEmpty ? "a post" : earlier.title
            return "The last was \(what), \(MarketingTime.weekday(earlier.at)) at \(MarketingTime.clock(earlier.at))."
        }
        return "Nothing in the last two days."
    }

    private func macWhat(_ r: MacPostsRow) -> some View {
        HStack(spacing: 8) {
            macThumb(r)
                .frame(width: 26, height: 26)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            Text(r.title).lineLimit(1)
        }
    }

    @ViewBuilder
    private func macThumb(_ r: MacPostsRow) -> some View {
        if let e = r.entry {
            StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
        } else if let id = r.sent?.sitePiece, let piece = store.piece(id) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
        } else {
            Image(systemName: "bubble.left.and.bubble.right").foregroundStyle(.secondary)
        }
    }

    /// Return or a double-click: the queued piece opens whole in a window of its own; a sent piece opens its page on the site's list.
    private func macOpen(_ ids: Set<String>) {
        for id in ids.prefix(3) {
            guard let r = macRows.first(where: { $0.id == id }) else { continue }
            if let e = r.entry {
                macOpenWindow("/marketing/queue?id=" + (e.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""))
            } else if let piece = r.sent?.sitePiece, !piece.isEmpty {
                macOpenWindow(MarketingKit.piecePath(piece))
            }
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private var macInspectorBody: some View {
        let picked = macRows.filter { (r: MacPostsRow) in macSelection.contains(r.id) }
        if picked.count > 1 {
            MacInspectorEmpty(title: "\(picked.count) posts picked", detail: "Pick one to see where it goes.")
        } else if let r = picked.first {
            macInspect(r)
        } else {
            MacInspectorEmpty(title: "No post picked", detail: "Pick a post to see its caption and where it goes.")
        }
    }

    private func macInspect(_ r: MacPostsRow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                macPicture(r)
                MacInspectorHeader(title: r.title, subtitle: macStatusLine(r), status: MacStatus(r.status, tone: r.tone))
                if let e = r.entry {
                    MacActionButtons(actions: [macSendNow(e, count: 1), macHold(e, count: 1)])
                    MacActionButtons(actions: [macSendAt(e, count: 1), macRemove(e, count: 1)])
                    if e.units > 0 {
                        ProgressView(value: Double(e.done), total: Double(e.units))
                        Text("\(e.done) of \(e.units) gone").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    macPlaces(e)
                    if !e.caption.isEmpty {
                        Text("Caption").font(.headline)
                        Text(e.caption).textSelection(.enabled)
                    }
                    if e.toWebsite && !e.websiteNames.isEmpty {
                        Text("On the website as " + e.websiteNames.joined(separator: ", ") + ".").font(.callout).foregroundStyle(.secondary)
                    }
                } else if let s = r.sent {
                    Text("Where it went").font(.headline)
                    ForEach(s.destinations, id: \.self) { (d: String) in
                        Label(store.placeName(d), systemImage: d.hasPrefix("instagram") ? "camera" : "bubble.left.and.bubble.right")
                    }
                    if let piece = s.sitePiece, !piece.isEmpty {
                        Button("Open the Piece") { macOpenWindow(MarketingKit.piecePath(piece)) }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func macPicture(_ r: MacPostsRow) -> some View {
        if let e = r.entry, let thumb = e.thumb, !thumb.isEmpty {
            StockImage(imageUrl: thumb, name: e.headline, key: e.id, decodeDataURI: true)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        } else if let id = r.sent?.sitePiece, let piece = store.piece(id) {
            StockImage(imageUrl: piece.thumb, name: piece.name, key: piece.id)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        }
    }

    private func macStatusLine(_ r: MacPostsRow) -> String {
        if let e = r.entry { return PostQueueSheet(id: e.id).statusWords(e) }
        return "Sent " + ShopDate.say(r.sent?.at, withTime: true)
    }

    private func macPlaces(_ e: PostQueueEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Where it goes").font(.headline)
            ForEach(PostQueueSheet(id: e.id).places(e)) { (p: PostQueueSheet.Place) in
                let gone = p.units.filter { (u: String) in e.doneKeys.contains(u) }.count
                let problem = p.units.compactMap { (u: String) in e.unitErrors[u] }.first
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: p.symbol).frame(width: 18).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.title)
                        Text(problem ?? p.detail).font(.caption).foregroundStyle(problem == nil ? Color.secondary : Tone.problem.color)
                    }
                    Spacer(minLength: 4)
                    if gone == p.units.count { Text("Gone").font(.caption).foregroundStyle(.secondary) }
                    else if problem != nil { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Tone.problem.color) }
                    else if gone > 0 { Text("\(gone)/\(p.units.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                }
            }
        }
    }

    // MARK: The website's pieces

    /// The website's pieces as a gallery: all the new arrivals, or the latest. A click picks, a double-click or Return opens the
    /// piece in a window, right-click gives the rest.
    @ViewBuilder
    private var macPieces: some View {
        switch store.piecesPhase {
        case .off:
            ContentUnavailableView("No website pieces", systemImage: "globe",
                                   description: Text("This shop's website has no pieces for the ERP to post from."))
        case .idle, .loading:
            MarketingReading(text: "Reading the website…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            VStack(spacing: 10) {
                Text(message).foregroundStyle(.secondary)
                Button("Try Again") { Task { await store.load(gold: hasInvestments) } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            macGallery
        }
    }

    private var macGallery: some View {
        let fresh = store.pieces.filter { (p: PostPiece) in p.newArrival }
        let shown = Array((fresh.isEmpty ? store.pieces : fresh).prefix(60))
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(fresh.isEmpty ? "From \(store.siteName)" : "New on \(store.siteName)").font(.headline)
                    Spacer()
                    Button("All \(store.pieces.count) Pieces") { macOpenWindow(MarketingKit.piecesPath) }.buttonStyle(.link)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)], spacing: 14) {
                    ForEach(shown) { (p: PostPiece) in macPieceCell(p) }
                }
            }
            .padding(20)
        }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.return) {
            guard let id = macPiece else { return .ignored }
            macOpenWindow(MarketingKit.piecePath(id))
            return .handled
        }
    }

    private func macPieceCell(_ p: PostPiece) -> some View {
        let on = macPiece == p.id
        return PostPieceTile(piece: p, posted: store.posted[p.id])
            .padding(6)
            .background(on ? Theme.accent.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
            .contentShape(Rectangle())
            .onTapGesture { macPiece = p.id }
            .simultaneousGesture(TapGesture(count: 2).onEnded { macOpenWindow(MarketingKit.piecePath(p.id)) })
            .pointerHover()
            .contextMenu {
                Button("Open", systemImage: "arrow.up.forward.square") { macOpenWindow(MarketingKit.piecePath(p.id)) }
                Divider()
                Button("Send or Queue It…", systemImage: "paperplane") { macOpenWindow(MarketingKit.trayPath(p.id)) }
                if let url = URL(string: p.url), !p.url.isEmpty {
                    Button("Open on \(store.siteName)", systemImage: "safari") { NSWorkspace.shared.open(url) }
                }
            }
    }
}
#endif
