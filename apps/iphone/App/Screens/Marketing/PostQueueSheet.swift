import SwiftUI
import ERPCore

/// One queued piece, before and after it goes (the web hub's queue row and its menu, src/app/posts/page.tsx):
/// the picture, the caption word for word, and every place it goes with how many photos and what has gone.
/// Send now, Hold, Send at a time and Remove call the queue's own routes. The sending is the server's
/// (lib/social/queue.ts `sendItem`): the phone only asks for it, and only after saying exactly where it goes,
/// because a post to the groups and the channel cannot be taken back.
struct PostQueueSheet: View {
    let id: String

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSend = false
    @State private var confirmingRemove = false
    @State private var picking = false
    @State private var when = Date().addingTimeInterval(3600)
    @State private var busy: String?
    @State private var said: String?
    @State private var failure: String?

    private var store: PostsStore { PostsStore.shared }
    private var entry: PostQueueEntry? { store.queue.first { (e: PostQueueEntry) in e.id == id } }

    var body: some View {
        NavigationStack {
            Group {
                if let e = entry {
                    page(e)
                } else {
                    ContentUnavailableView("No longer in the queue", systemImage: "tray",
                                           description: Text("It was sent, removed, or changed on another device."))
                }
            }
            .navigationTitle("In the queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .task { await store.refreshQueue() }
    }

    // MARK: The page

    private func page(_ e: PostQueueEntry) -> some View {
        List { Group {
            Section { header(e) }
            if let said {
                Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            }
            if let failure {
                Section { Label(failure, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
            Section {
                ForEach(places(e)) { (p: Place) in placeRow(p) }
            } header: {
                Text("Where it goes")
            } footer: {
                Text(e.toWebsite && !e.websiteNames.isEmpty ? "On the website as " + e.websiteNames.joined(separator: ", ") + "." : "")
            }
            if !e.caption.isEmpty {
                Section("Caption") {
                    Text(e.caption).textSelection(.enabled).font(.subheadline)
                }
            }
            actions(e)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .disabled(busy != nil)
        .overlay { if busy != nil { ProgressView(busy ?? "").padding(20).glassEffect(.regular, in: .rect(cornerRadius: 18)) } }
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

    private func header(_ e: PostQueueEntry) -> some View {
        HStack(alignment: .top, spacing: 14) {
            StockImage(imageUrl: e.thumb, name: e.headline, key: e.id, decodeDataURI: true)
                .frame(width: 84, height: 84)
                .clipShape(.rect(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 6) {
                Text(e.headline.isEmpty ? "A piece" : e.headline).font(.headline).lineLimit(3)
                Text(statusWords(e)).font(.subheadline).foregroundStyle(e.status == "failed" ? Color.red : Color.secondary)
                if e.units > 0 {
                    ProgressView(value: Double(e.done), total: Double(e.units))
                        .tint(Theme.accent)
                    Text("\(e.done) of \(e.units) gone").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func statusWords(_ e: PostQueueEntry) -> String {
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

    private func places(_ e: PostQueueEntry) -> [Place] {
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
        for key in e.whatsapp {
            let units = e.unitKeys.filter { $0.hasPrefix("wa:\(key):") }
            guard !units.isEmpty else { continue }
            let photos = "\(units.count) photo\(units.count == 1 ? "" : "s"), the caption on the first"
            out.append(Place(id: "wa:" + key, title: store.placeLabel(key), detail: "WhatsApp · " + photos,
                             symbol: key == "channel" ? "megaphone" : "person.3", units: units))
        }
        return out
    }

    private func placeRow(_ p: Place) -> some View {
        let e = entry
        let gone = p.units.filter { e?.doneKeys.contains($0) ?? false }.count
        let problem = p.units.compactMap { e?.unitErrors[$0] }.first
        return HStack(spacing: 12) {
            Image(systemName: p.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Theme.accent.gradient, in: .rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title)
                Text(problem ?? p.detail)
                    .font(.caption)
                    .foregroundStyle(problem == nil ? Color.secondary : Color.red)
                    .lineLimit(2)
            }
            Spacer(minLength: 6)
            if gone == p.units.count {
                Label("Gone", systemImage: "checkmark.circle.fill").labelStyle(.iconOnly).foregroundStyle(.green)
            } else if problem != nil {
                Label("Failed", systemImage: "exclamationmark.circle.fill").labelStyle(.iconOnly).foregroundStyle(.red)
            } else if gone > 0 {
                Text("\(gone)/\(p.units.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }

    /// What the counter is told before anything goes: every place still to get it.
    private func sendWords(_ e: PostQueueEntry) -> String {
        let left = places(e).filter { (p: Place) in !p.units.allSatisfy { e.doneKeys.contains($0) } }
        let list = left.map { (p: Place) in "\(p.title) (\(p.detail))" }.joined(separator: "\n")
        let already = e.done > 0 ? "\n\nWhat already went is not sent again." : ""
        return "It goes now to:\n" + list + already + "\n\nA post cannot be taken back."
    }

    // MARK: What can be done

    @ViewBuilder
    private func actions(_ e: PostQueueEntry) -> some View {
        let canSend = ["held", "scheduled", "failed"].contains(e.status)
        let canTime = ["held", "scheduled", "failed"].contains(e.status)
        if canSend || canTime || e.status != "sending" {
            Section {
                if canSend {
                    Button { confirmingSend = true } label: {
                        Label(e.status == "failed" ? "Send what is left now" : "Send now", systemImage: "paperplane.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.houseProminent)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
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

    private func run(_ doing: String, _ work: () async throws -> String?) async {
        busy = doing
        failure = nil
        said = nil
        defer { busy = nil }
        do {
            said = try await work()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func send(_ e: PostQueueEntry) async {
        await run("Sending…") {
            let all = try await store.sendNow(e.id)
            if all { return "Sent to every place." }
            failure = "Not all of it went. What failed is marked; Send what is left tries only those."
            return nil
        }
    }

    private func hold(_ e: PostQueueEntry) async {
        await run("Holding…") {
            try await store.hold(e.id)
            return "Held. It waits for you."
        }
    }

    private func schedule(_ e: PostQueueEntry) async {
        await run("Scheduling…") {
            try await store.schedule(e.id, at: when)
            picking = false
            return "It goes " + ShopDate.say(when.ISO8601Format(), withTime: true) + "."
        }
    }

    private func remove(_ e: PostQueueEntry) async {
        await run("Removing…") {
            try await store.remove(e.id)
            dismiss()
            return nil
        }
    }
}
