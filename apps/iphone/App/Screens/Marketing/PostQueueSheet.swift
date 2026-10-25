import SwiftUI
import ERPCore

/// One queued piece, before and after it goes (the web hub's queue row and its menu, src/app/posts/page.tsx):
/// the picture, the caption word for word, and every place it goes with how many photos and what has gone.
/// Send now, Hold, Send at a time and Remove call the queue's own routes. The sending is the server's
/// (lib/social/queue.ts `sendItem`): the phone only asks for it, and only after saying exactly where it goes,
/// because a post to the groups and the channel cannot be taken back.
struct PostQueueSheet: View {
    let id: String
    var embedded = false

    @Environment(\.dismiss) private var dismiss
    @State var confirmingSend = false
    @State var confirmingRemove = false
    @State private var picking = false
    @State private var when = Date().addingTimeInterval(3600)
    @State var busy: String?
    @State var said: String?
    @State var failure: String?

    private var store: PostsStore { PostsStore.shared }
    private var entry: PostQueueEntry? { store.queue.first { (e: PostQueueEntry) in e.id == id } }

    var body: some View {
        Group {
            if embedded { content }
            else {
                NavigationStack {
                    content.toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                    }
                }
                // Not swiped away mid-send: the answer (or the error) is shown here.
                
            }
        }.task { await store.refreshQueue() }
    }

    private var content: some View {
        Group {
            if let e = entry { page(e) }
            else { EmptyState("No longer in the queue", symbol: "tray", message: "It was sent, removed, or changed on another device.") }
        }
        .modifier(HouseGround())
        .navigationTitle("In the queue")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: The page

    private func page(_ e: PostQueueEntry) -> some View {
        #if os(macOS)
        macPage(e)
        #else
        phonePage(e)
        #endif
    }

    private func phonePage(_ e: PostQueueEntry) -> some View {
        List { Group {
            Section { header(e) }
            if let said {
                Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
            }
            Section {
                ForEach(places(e)) { (p: Place) in placeRow(p) }
            } header: {
                LedgerHeading(title: "Where it goes")
            } footer: {
                Text(e.toWebsite && !e.websiteNames.isEmpty ? "On the website as " + e.websiteNames.joined(separator: ", ") + "." : "")
            }
            if !e.caption.isEmpty {
                LedgerSection("Caption") {
                    Text(e.caption).textSelection(.enabled).font(.subheadline)
                }
            }
            actions(e)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .websiteBusy(busy)
        .failureAlert($failure)
        .sensoryFeedback(.success, trigger: said) { _, now in now != nil }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if ["held", "scheduled", "failed"].contains(e.status) {
                ActionBar(primary: .init(e.status == "failed" ? "Send what is left now" : "Send now", systemImage: "paperplane.fill",
                                         isBusy: busy != nil) { confirmingSend = true })
            }
        }
        .confirmationDialog("Send this now?", isPresented: $confirmingSend, titleVisibility: .visible) {
            Button("Send now") { Task { await send(e) } }
        } message: {
            Text(sendWords(e))
        }
        .confirmationDialog("Take it out of the queue?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await remove(e) } }
        } message: {
            Text(e.done > 0 ? "What already went stays where it is; the rest will not go." : "Nothing of it has gone. Its photos are deleted with it.")
        }
    }

    func header(_ e: PostQueueEntry) -> some View {
        HStack(alignment: .top, spacing: pt(14)) {
            StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
                .frame(width: 84, height: 84)
                .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
            VStack(alignment: .leading, spacing: pt(6)) {
                Text(e.headline.isEmpty ? "A piece" : e.headline).font(.headline)
                Text(statusWords(e)).font(.subheadline).foregroundStyle(e.status == "failed" ? Tone.problem.color : Color.secondary)
                if e.units > 0 {
                    ProgressView(value: Double(e.done), total: Double(e.units))
                        .tint(Theme.accent)
                    Text("\(e.done) of \(e.units) gone").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
        }
        .padding(.vertical, pt(4))
    }

    func statusWords(_ e: PostQueueEntry) -> String {
        switch e.status {
        case "scheduled": return "Goes " + ShopDate.say(e.dueAt, withTime: true)
        case "held": return "Held: it waits for you"
        case "sending": return "Sending now"
        case "sent": return "Sent " + ShopDate.say(e.sentAt, withTime: true)
        case "failed": return "Not all of it went"
        case "draft": return "Still arriving from the device that made it"
        default: return e.status
        }
    }

    // MARK: Where it goes

    struct Place: Identifiable {
        let id: String
        let title: String
        let detail: String
        let symbol: String
        /// The sends that make it up.
        let units: [String]
    }

    func places(_ e: PostQueueEntry) -> [Place] {
        var out: [Place] = []
        let site = e.unitKeys.filter { $0.hasPrefix("site-") || $0 == "featured" }
        if e.toWebsite && !site.isEmpty {
            let photos = "\(e.sitePhotos) photo\(e.sitePhotos == 1 ? "" : "s")"
            let shelf = e.websiteCollection.isEmpty ? store.siteName : "\(store.siteName) · \(e.websiteCollection)"
            out.append(Place(id: "website", title: "Website", detail: shelf + " · " + photos + (e.websiteFeatured ? " · featured" : ""), symbol: "globe", units: site))
        }
        if e.unitKeys.contains("instagram") {
            out.append(Place(id: "instagram", title: "Instagram story", detail: "The story picture", symbol: "camera", units: ["instagram"]))
        }
        if e.unitKeys.contains("ig-post") {
            // The WhatsApp photos as one carousel, the first ten (album.ts); its own send, so its own line.
            let n = Swift.min(e.waPhotos, Album.igCarouselMax)
            let cut = e.waPhotos > Album.igCarouselMax ? " · the first \(Album.igCarouselMax) of \(e.waPhotos)" : ""
            out.append(Place(id: "ig-post", title: "Instagram (\(Album.photosLabel(n)))", detail: "One post, the caption once" + cut,
                             symbol: "square.stack", units: ["ig-post"]))
        }
        for key in e.whatsapp {
            let units = e.unitKeys.filter { $0.hasPrefix("wa:\(key):") }
            guard !units.isEmpty else { continue }
            let photos = "\(units.count) photo\(units.count == 1 ? "" : "s"), the caption on the first"
            out.append(Place(id: "wa:" + key, title: store.placeLabel(key), detail: "WhatsApp · " + photos,
                             symbol: key == "channel" ? "megaphone" : "person.3", units: units))
        }
        return out
    }

    func placeRow(_ p: Place) -> some View {
        let e = entry
        let gone = p.units.filter { e?.doneKeys.contains($0) ?? false }.count
        let problem = p.units.compactMap { e?.unitErrors[$0] }.first
        // Gone is the expected end: a quiet word; only a failure is coloured (CONVENTIONS rule 15).
        return HStack(spacing: pt(12)) {
            Image(systemName: p.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .frame(width: 32, height: 32)
                .background(Theme.accent, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title)
                Text(problem ?? p.detail)
                    .font(.caption)
                    .foregroundStyle(problem == nil ? Color.secondary : Tone.problem.color)

            }
            Spacer(minLength: 6)
            if gone == p.units.count {
                Text("Gone").font(.caption).foregroundStyle(.secondary)
            } else if problem != nil {
                Label("Failed", systemImage: "exclamationmark.circle.fill").labelStyle(.iconOnly).foregroundStyle(Tone.problem.color)
            } else if gone > 0 {
                Text("\(gone)/\(p.units.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }

    /// What the counter is told before anything goes: every place still to get it.
    func sendWords(_ e: PostQueueEntry) -> String {
        let left = places(e).filter { (p: Place) in !p.units.allSatisfy { e.doneKeys.contains($0) } }
        let list = left.map { (p: Place) in "\(p.title) (\(p.detail))" }.joined(separator: "\n")
        let already = e.done > 0 ? "\n\nWhat already went is not sent again." : ""
        return "It goes now to:\n" + list + already + "\n\nA post cannot be taken back."
    }

    // MARK: What can be done

    @ViewBuilder
    func actions(_ e: PostQueueEntry) -> some View {
        let canTime = ["held", "scheduled", "failed"].contains(e.status)
        if canTime || e.status != "sending" {
            Section {
                if canTime {
                    if picking {
                        DatePicker("Send at", selection: $when, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                            .environment(\.timeZone, ERPDate.karachi)
                        Button("Schedule for this time") { Task { await schedule(e) } }
                    } else {
                        Button { picking = true } label: { Label("Send at a time…", systemImage: "clock") }
                    }
                    if e.status == "scheduled" {
                        Button { Task { await hold(e) } } label: { Label("Hold it", systemImage: "pause.circle") }
                    }
                }
                if e.status != "sent" {
                    Button(role: .destructive) { confirmingRemove = true } label: {
                        Label("Remove from the queue", systemImage: "trash")
                    }
                }
            }
        }
    }

    /// Handed to the Outbox: the sheet is free at once, and the words (or the failure, with Retry) come back from there.
    private func hand(_ label: String, saying: String, close: Bool = false, _ work: @escaping () async throws -> String) {
        said = saying
        failure = nil
        Outbox.shared.post(label: label, work)
        if close && !embedded { dismiss() }
    }

    func send(_ e: PostQueueEntry) async {
        let n = places(e).filter { (p: Place) in !p.units.allSatisfy { e.doneKeys.contains($0) } }.count
        let id = e.id
        hand("Send “\(e.headline.isEmpty ? "a piece" : e.headline)”", saying: "Sending to \(n) \(n == 1 ? "place" : "places")…", close: true) {
            // A refusal is not retried by itself (a post must not go twice); the banner's Retry sends only what is left.
            let all: Bool
            do { all = try await PostsStore.shared.sendNow(id) } catch { throw ERPAPI.Failure(status: 400, message: error.localizedDescription) }
            if all { return "Posted to \(n) \(n == 1 ? "place" : "places")" }
            throw ERPAPI.Failure(status: 400, message: "Not all of it went. What failed is marked; Send what is left tries only those.")
        }
    }

    private func hold(_ e: PostQueueEntry) async {
        let id = e.id
        hand("Hold the piece", saying: "Holding…") { try await PostsStore.shared.hold(id); return "Held. It waits for you." }
    }

    private func schedule(_ e: PostQueueEntry) async {
        let id = e.id, at = when
        picking = false
        hand("Schedule the piece", saying: "Scheduling…") {
            try await PostsStore.shared.schedule(id, at: at)
            return "It goes " + ShopDate.say(at.ISO8601Format(), withTime: true) + "."
        }
    }

    func remove(_ e: PostQueueEntry) async {
        let id = e.id
        hand("Remove the piece from the queue", saying: "Removing…", close: true) { try await PostsStore.shared.remove(id); return "Removed from the queue" }
    }
}

#if os(macOS)
extension PostQueueSheet {
    /// The piece and where it goes on the left; the caption word for word and what can be done on the right.
    func macPage(_ e: PostQueueEntry) -> some View {
        MacTwoPane(sideWidth: 420) {
            List {
                Group {
                    Section { header(e) }
                    if let said {
                        Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
                    }
                    Section {
                        ForEach(places(e)) { (p: Place) in placeRow(p) }
                    } header: {
                        Text("Where it goes")
                    } footer: {
                        Text(e.toWebsite && !e.websiteNames.isEmpty ? "On the website as " + e.websiteNames.joined(separator: ", ") + "." : "")
                    }
                }
                .houseRows()
            }
            .listStyle(.inset)
        } main: {
            List {
                Group {
                    if !e.caption.isEmpty {
                        Section("Caption") {
                            Text(e.caption).textSelection(.enabled).font(.body)
                        }
                    }
                    actions(e)
                }
                .houseRows()
            }
            .listStyle(.inset)
        }
        .websiteBusy(busy)
        .failureAlert($failure)
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                if !e.caption.isEmpty {
                    Button { MacClipboard.copy(e.caption) } label: { Label("Copy the caption", systemImage: "doc.on.doc") }
                        .help("Copy the caption")
                }
            }
        }
        .actionBar(primary: .init(e.status == "failed" ? "Send what is left now" : "Send now", systemImage: "paperplane.fill",
                                  isBusy: busy != nil, isDisabled: !["held", "scheduled", "failed"].contains(e.status)) { confirmingSend = true },
                   summary: statusWords(e))
        .confirmationDialog("Send this now?", isPresented: $confirmingSend, titleVisibility: .visible) {
            Button("Send now") { Task { await send(e) } }
        } message: {
            Text(sendWords(e))
        }
        .confirmationDialog("Take it out of the queue?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await remove(e) } }
        } message: {
            Text(e.done > 0 ? "What already went stays where it is; the rest will not go." : "Nothing of it has gone. Its photos are deleted with it.")
        }
        .frame(minWidth: 600, minHeight: 480)
    }
}
#endif
