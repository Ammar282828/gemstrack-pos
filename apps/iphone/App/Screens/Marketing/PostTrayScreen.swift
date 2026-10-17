import SwiftUI
import UIKit
import ERPCore

/// Posts → the tray (src/app/posts/page.tsx's tray and ./piece-card.tsx): website pieces picked one or a few, each with
/// its own weight, caption and story, sent together to the chosen groups and the channel, or queued for later. Where it
/// goes is said in full before it goes, because a post to the groups cannot be taken back. `?id=` starts the tray on
/// one piece (a piece's own screen, Send or queue it).
struct PostTrayScreen: View {
    let path: String

    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = PostTrayModel()
    @State private var picking = false
    @State private var confirming = false
    @State private var note: Note?
    @State private var failure: String?
    @State private var working: String?
    @State private var story: Story?
    @State private var started = false

    struct Story: Identifiable {
        let id = UUID()
        let data: Data
        let file: URL?
        let name: String
    }

    private var store: PostsStore { PostsStore.shared }

    var body: some View {
        List {
            Group {
                if store.piecesPhase == .loaded && !model.audience.canSend {
                    Section {
                        Text("No WhatsApp community is set up for this shop yet (WHATSAPP_COMMUNITY_CHAT_ID), so nothing can be sent from here.")
                            .foregroundStyle(Tone.owed.color)
                    }
                }
                if model.cards.isEmpty {
                    emptySection
                } else {
                    stripSection
                    whereSection
                    sendSection
                    if let card = model.activeCard {
                        PostTrayCardSections(card: card, model: model, siteName: store.siteName, posted: store.posted[card.id],
                                             access: access, locked: model.busy != nil, onStory: { Task { await makeStory(card) } },
                                             onAI: { Task { await writeWithAI(card) } }, onSay: say,
                                             onDesign: { Task { await design(card) } },
                                             onDesignAI: { (edit: WebsitePhotoEdit, op: String, params: [String: Any], label: String) in Task { await designAI(edit, op, params, label) } })
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(model.cards.count > 1 ? "\(model.cards.count) to send" : "Send a piece")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { picking = true } label: { Label("Add pieces", systemImage: "plus") }
                    .disabled(model.busy != nil)
            }
        }
        .task { await start() }
        .sheet(isPresented: $picking) {
            NavigationStack {
                PostPiecesScreen(tray: model)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { picking = false } } }
            }
        }
        .sheet(item: $story) { (s: Story) in storySheet(s) }
        .confirmationDialog(confirmTitle, isPresented: $confirming, titleVisibility: .visible) {
            Button(model.blockers.isEmpty ? "Send" : "Send anyway") { Task { await send() } }
            Button("Not yet", role: .cancel) {}
        } message: {
            Text(confirmWords)
        }
        .websiteBusy(working)
        .noteToast($note)
        .failureAlert($failure)
    }

    private var access: PostTrayCardSections.Access {
        .init(design: MarketingKit.has("/design", role: session.role),
              edit: MarketingKit.has("/website/edit", role: session.role),
              promote: MarketingKit.has("/ads/new", role: session.role))
    }

    private func start() async {
        guard !started else { return }
        started = true
        await model.setUp()
        if let id = MarketingKit.pieceId(in: path), !id.isEmpty, !model.has(id), let p = store.piece(id) { model.pick(p) }
    }

    // MARK: Nothing picked

    private var emptySection: some View {
        Section {
            Text("Tap pieces: one, or a few to send together. Each gets its own caption.")
                .foregroundStyle(.secondary)
            Button { picking = true } label: {
                Label("Choose pieces", systemImage: "square.grid.2x2").frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            Button { if let why = model.shuffle() { failure = why } } label: { Label("Shuffle a piece", systemImage: "shuffle") }
                .disabled(store.pieces.isEmpty)
        }
    }

    // MARK: The picked pieces

    private var stripSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.cards) { (c: PostTrayCard) in
                        let number = (model.cards.firstIndex { (x: PostTrayCard) in x.id == c.id } ?? 0) + 1
                        Button { model.active = c.id } label: { thumb(c, number: number) }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(number): \(c.piece.name)")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .listRowInsets(EdgeInsets())
            if model.cards.count > 1 {
                Button("Clear all \(model.cards.count)", role: .destructive) { model.clear() }
                    .disabled(model.busy != nil)
            }
        }
    }

    private func thumb(_ c: PostTrayCard, number: Int) -> some View {
        let on = c.id == model.activeCard?.id
        return StockImage(imageUrl: c.piece.thumb, name: c.piece.name, key: c.id)
            .frame(width: 56, height: 56)
            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous)
                    .strokeBorder(on ? Theme.accent : Color.clear, lineWidth: 2)
            }
            .overlay(alignment: .topLeading) {
                Text("\(number)").font(.caption2.weight(.semibold)).monospacedDigit()
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(.ultraThinMaterial, in: .capsule)
                    .padding(3)
            }
            .overlay {
                if c.sending { SkeletonLoading().padding(8).background(.ultraThinMaterial, in: .rect(cornerRadius: Radius.thumb, style: .continuous)) }
            }
            .overlay(alignment: .bottom) {
                if c.failed != nil {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Tone.problem.color).padding(3)
                        .accessibilityLabel("Didn't go")
                }
            }
            .opacity(on ? 1 : 0.8)
    }

    // MARK: Where they go, and the one press that sends them

    @ViewBuilder
    private var whereSection: some View {
        let a = model.audience
        if !a.groups.isEmpty || a.channelName != nil {
            Section {
                ForEach(a.groups, id: \.key) { (g: PostAudience.Place) in
                    placeToggle(g.key, title: g.label, reach: g.size, noun: "members")
                }
                if a.channelName != nil {
                    placeToggle("channel", title: "Channel", reach: a.channelFollowers, noun: "followers")
                }
            } header: {
                LedgerHeading(title: "Where they go")
            }
        }
    }

    private func placeToggle(_ key: String, title: String, reach: Int?, noun: String) -> some View {
        Toggle(isOn: Binding(get: { model.targets.contains(key) }, set: { (_: Bool) in model.toggle(key) })) {
            HStack {
                Text(title)
                if let reach { Text("\(reach.formatted()) \(noun)").font(.subheadline).foregroundStyle(.secondary) }
            }
        }
        .tint(Theme.accent)
        .disabled(model.busy != nil)
    }

    private var sendSection: some View {
        let n = model.cards.count
        return Section {
            HStack(spacing: 10) {
                Button { confirming = true } label: {
                    Label(model.busy == "send" ? "Sending…" : n > 1 ? "Send all \(n)" : "Send it", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                Button { Task { await queue() } } label: {
                    Label(model.busy == "queue" ? "Queuing…" : "Later", systemImage: "clock")
                }
                .buttonStyle(.glass)
            }
            .disabled(!model.canSend)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if model.targets.isEmpty {
                    Text("Choose where they go.")
                } else {
                    Text("To \(PostTrayModel.listOf(model.targets.map(model.label)))\(n > 1 ? ", one after another" : ""). Later puts \(n > 1 ? "them" : "it") in the queue, to send at a time or spread over the day.")
                }
                if !model.blockers.isEmpty {
                    Text(model.blockers.map { (c: PostCheck) in "\(c.label): \(c.fix ?? c.detail)" }.joined(separator: " · "))
                        .foregroundStyle(Tone.problem.color)
                }
            }
        }
    }

    // MARK: Before it goes

    private var confirmTitle: String {
        let n = model.cards.count
        return "Send \(n > 1 ? "these \(n) pieces" : "it") to \(PostTrayModel.listOf(model.targets.map(model.label)))?"
    }

    /// Every piece and what of it goes, every place with how many it reaches, and what is failing now.
    private var confirmWords: String {
        let pieces = model.cards.map { (c: PostTrayCard) -> String in
            let ago = MarketingTime.postedAgo(store.posted[c.id]).map { (s: String) in " · " + s } ?? ""
            return "• \(c.piece.name): \(c.going.lowercasedFirst)\(ago)"
        }
        let places = model.targets.map { (k: String) -> String in
            let name = k == "channel" ? "\(model.audience.channelName ?? "Channel") (channel)" : model.label(k)
            let reach = model.reach(k).map { (r: Int) in " — \(r.formatted()) \(k == "channel" ? "followers" : "members")" } ?? ""
            return name + reach
        }
        var out = pieces.joined(separator: "\n") + "\n\n" + places.joined(separator: "\n")
        out += "\n\nEach with its own caption and link\(model.cards.count > 1 ? ", one after another: it stops at the first that fails" : ""). A post can't be unsent from here."
        if !model.blockers.isEmpty {
            out += "\n\nThis will probably fail:\n" + model.blockers.map { (c: PostCheck) in "\(c.label): \(c.fix ?? c.detail)" }.joined(separator: "\n")
        }
        return out
    }

    // MARK: Doing it

    private func send() async {
        say(await model.send().notes)
    }

    private func queue() async {
        say(await model.queue().notes)
    }

    /// The first thing worth saying, with the rest after it.
    private func say(_ notes: [Note]) {
        guard let first = notes.first(where: { $0.failed }) ?? notes.first else { return }
        let rest = notes.filter { $0 != first }.map { (n: Note) in n.title + (n.detail.isEmpty ? "" : ": " + n.detail) }
        let detail = ([first.detail] + rest).filter { !$0.isEmpty }.joined(separator: " ")
        Note.show(Note(title: first.title, detail: detail, failed: first.failed), in: $note, reduce: reduceMotion)
    }

    private func writeWithAI(_ card: PostTrayCard) async {
        working = "Writing the caption…"
        defer { working = nil }
        do {
            try await model.writeWithAI(card)
            say([Note(title: "Caption written", detail: "Read it over before sending: the link and the closing lines are the house's own.")])
        } catch {
            failure = error.localizedDescription
        }
    }

    // MARK: Crop and design

    private func design(_ card: PostTrayCard) async {
        if let why = await model.startDesign(card) { failure = "Couldn't start the design. " + why }
    }

    private func designAI(_ edit: WebsitePhotoEdit, _ op: String, _ params: [String: Any], _ label: String) async {
        working = "The AI is working on the photo (about a minute)…"
        defer { working = nil }
        do {
            if let warning = try await edit.runAI(op, params: params, label: label) { say([Note(title: "Check this one closely", detail: warning, failed: true)]) }
        } catch {
            failure = "Couldn't change the photo. " + error.localizedDescription
        }
    }

    // MARK: The story

    private func makeStory(_ card: PostTrayCard) async {
        working = "Making the story…"
        defer { working = nil }
        do {
            let data = try await model.story(card)
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(PostTrayModel.slug(card.piece) + "-story.jpg")
            try? data.write(to: file, options: .atomic)
            story = Story(data: data, file: FileManager.default.fileExists(atPath: file.path) ? file : nil, name: card.piece.name)
        } catch {
            failure = "Couldn't make the story. " + error.localizedDescription
        }
    }

    private func storySheet(_ s: Story) -> some View {
        let connected = model.instagram["connected"].bool
        let user = model.instagram.s("username")
        return NavigationStack {
            List {
                Group {
                    Section {
                        if let image = UIImage(data: s.data) {
                            Image(uiImage: image).resizable().scaledToFit()
                                .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                                .frame(maxHeight: 460)
                                .frame(maxWidth: .infinity)
                                .accessibilityLabel("The story")
                        }
                    } footer: {
                        Text(connected
                             ? "It goes up on Instagram at once and can't be taken down from here. Instagram's API can't add a link sticker: add one by hand in the app if you want it."
                             : model.instagram["configured"].bool ? "Instagram isn't connected on this ERP (Design → Publish → Instagram connects it), so save it and post it from the Instagram app."
                             : "This ERP doesn't post to Instagram by itself: save it and post it from the Instagram app.")
                    }
                    Section {
                        if connected {
                            Button { Task { await postStory(s, user: user) } } label: {
                                Label(user.isEmpty ? "Post story" : "Post story to @\(user)", systemImage: "camera.aperture").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.houseProminent)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                        }
                        if let file = s.file {
                            ShareLink(item: file) { Label("Save or share", systemImage: "square.and.arrow.up") }
                        }
                    }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .navigationTitle("The story")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { story = nil } } }
            .websiteBusy(working)
        }
        .interactiveDismissDisabled(working != nil)
    }

    private func postStory(_ s: Story, user: String) async {
        working = "Posting the story…"
        defer { working = nil }
        do {
            _ = try await DesignSend.story(s.data)
            story = nil
            say([Note(title: user.isEmpty ? "Story posted" : "Story posted to @\(user)", detail: s.name)])
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// The piece in view, as the web's card: its photo as it goes, the weight on it, its words and caption, and what else
/// can be done with it. The other cards keep their words while this one is shown.
struct PostTrayCardSections: View {
    struct Access {
        let design: Bool
        let edit: Bool
        let promote: Bool
    }

    @Bindable var card: PostTrayCard
    let model: PostTrayModel
    let siteName: String
    let posted: String?
    let access: Access
    let locked: Bool
    let onStory: () -> Void
    let onAI: () -> Void
    let onSay: ([Note]) -> Void
    /// Crop & design: start it (the photo is fetched once), and the AI on its photo.
    let onDesign: () -> Void
    let onDesignAI: (_ edit: WebsitePhotoEdit, _ op: String, _ params: [String: Any], _ label: String) -> Void

    var body: some View {
        Group {
            photoSection
                // A weight or its colour changed: the caption (while untouched) and the stamped photo follow, as the web's do.
                // On one section only: a modifier on the Group would run once for each.
                .task(id: "\(card.id)|\(card.weight)|\(card.overlay)|\(card.ink)") {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    await model.refresh(card)
                }
            weightSection
            captionSection
            moreSection
        }
    }

    private var p: PostPiece { card.piece }

    private var metal: String { model.posting.s("metal") }

    @ViewBuilder
    private var photoSection: some View {
        if let edit = card.design, edit.ready {
            designSection(edit)
        } else {
            plainPhotoSection
        }
    }

    /// The design in place of the photo (piece-card.tsx: PieceDesignPanel), always square.
    private func designSection(_ edit: WebsitePhotoEdit) -> some View {
        Section {
            WebsitePhotoEditRows(edit: edit, fields: card.designFields(metal: metal), busy: locked, shapes: false) { (op: String, params: [String: Any], label: String) in
                onDesignAI(edit, op, params, label)
            }
            TextField("Name on the photo", text: $card.designName)
            if let note = designNote { Text(note).font(.footnote).foregroundStyle(.secondary) }
            Button { model.dropDesign(card) } label: { Label("Use the photo as it is", systemImage: "arrow.counterclockwise") }
                .disabled(locked)
            pieceRows
        } header: {
            LedgerHeading(title: "Crop and design")
        }
    }

    /// piece-design.tsx's note beside the layouts.
    private var designNote: String? {
        if House.bundledArt == "mina" && p.photoSource != nil {
            return p.sourceMarked ? "This photo carries the house's mark already: add nothing more."
                : "The photo from before the catalogue put the MINA mark on: the mark goes back top right, as on every catalogue photo."
        }
        return p.weightOnPhoto ? "This photo already shows its weight and logo: a stamp would show them twice." : nil
    }

    private var plainPhotoSection: some View {
        Section {
            Group {
                if let image = card.preview {
                    Image(uiImage: image).resizable().scaledToFit()
                } else {
                    StockImage(imageUrl: p.image, name: p.name, key: p.id).aspectRatio(1, contentMode: .fit)
                }
            }
            .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
            .frame(maxHeight: 380)
            .frame(maxWidth: .infinity)
            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            .accessibilityLabel(card.going)
            Button(action: onDesign) {
                Label(card.design != nil ? "Fetching the photo…" : "Crop and design", systemImage: "crop")
            }
            .disabled(locked || card.design != nil)
            pieceRows
        }
    }

    /// What the piece is, whatever photo goes.
    @ViewBuilder
    private var pieceRows: some View {
            if let failed = card.failed {
                Label("Didn't go: \(failed)", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(.headline)
                Text([p.collection, p.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) + "g" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let ago = MarketingTime.postedAgo(posted) {
                Text("Already went out: \(ago).").foregroundStyle(Tone.owed.color)
            }
            if let url = URL(string: p.url), !p.url.isEmpty {
                Link(destination: url) { Label("Open on \(siteName)", systemImage: "safari") }
            }
    }

    private var weightSection: some View {
        Section {
            if card.design == nil {
                Toggle("Weight on the photo", isOn: $card.overlay).tint(Theme.accent)
            }
            HStack {
                Text("Weight")
                Spacer()
                TextField("0.00", text: Binding(get: { card.weight }, set: { (v: String) in card.weight = v.filter { (ch: Character) in ch.isNumber || ch == "." } }))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(maxWidth: 110)
                Text("g").foregroundStyle(.secondary)
            }
            if card.overlay && card.design == nil {
                Picker("Colour", selection: $card.ink) {
                    Text("Auto colour").tag("auto")
                    Text("White").tag("white")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            }
            if let site = p.weightGrams, card.postOnly {
                Button("Use \(WebsiteNumber.grams(site))g, as \(siteName) has it") { card.weight = WebsiteNumber.grams(site) }
            }
        } header: {
            LedgerHeading(title: "Weight")
        } footer: {
            Text(weightNote)
        }
        .disabled(locked)
    }

    /// What the weight does here (piece-card.tsx's lines under the weight).
    private var weightNote: String {
        var lines: [String] = []
        if card.designed {
            lines.append(card.designShowsWeight ? "Your design carries the weight. It also goes in the caption."
                         : "Your design has no weight on it: pick a layout with the weight to add it. It goes in the caption.")
        } else if p.weightOnPhoto {
            lines.append(card.overlay ? "This photo already shows its weight: with this on it shows twice." : "This photo already shows its weight.")
        } else if card.overlay && !card.weightOK {
            lines.append("Type the weight to put it on.")
        } else {
            lines.append("Top left, in the catalogue's own lettering. It also goes in the caption.")
        }
        if let keep = card.newWeight { lines.append("\(siteName) has no weight for this piece: sending saves \(WebsiteNumber.grams(keep))g to it too.") }
        if let site = p.weightGrams, site > 0 {
            lines.append(card.postOnly ? "For this post only: \(siteName) keeps \(WebsiteNumber.grams(site))g." : "From \(siteName): \(WebsiteNumber.grams(site))g. Change it here for this post only.")
        }
        return lines.joined(separator: " ")
    }

    private var captionSection: some View {
        Section {
            TextField("Caption", text: Binding(get: { card.caption }, set: { (v: String) in card.caption = v; card.edited = true }), axis: .vertical)
                .font(.footnote.monospaced())
                .lineLimit(6...16)
                .disabled(locked)
            Button(action: onAI) { Label("Write with AI", systemImage: "sparkles") }
                .disabled(locked)
            if card.edited || card.aiLine != nil {
                Button { Task { await model.houseWords(card) } } label: { Label("The house's caption", systemImage: "arrow.uturn.backward") }
                    .disabled(locked)
            }
        } header: {
            LedgerHeading(title: "Caption")
        }
    }

    private var moreSection: some View {
        Section {
            Button(action: onStory) {
                Label(model.instagram["connected"].bool && !model.instagram.s("username").isEmpty ? "Instagram story · @\(model.instagram.s("username"))" : "Instagram story",
                      systemImage: "camera.aperture")
            }
            .disabled(locked)
            if access.design {
                MarketingLink(title: "Design", symbol: "wand.and.stars",
                              path: "/design?v=make&site=" + AdsQuery.escape(p.id))
            }
            if access.edit {
                MarketingLink(title: "Edit on \(siteName)", symbol: "pencil.line", path: "/website/edit?id=" + AdsQuery.escape(p.id))
            }
            if access.promote {
                MarketingLink(title: "Promote", symbol: "megaphone", path: "/ads/new?piece=" + AdsQuery.escape(p.id))
            }
            Button { if let why = model.another(card) { onSay([Note(title: why, failed: true)]) } } label: { Label("Another piece", systemImage: "shuffle") }
                .disabled(locked)
            Button(role: .destructive) { model.take(card.id) } label: { Label("Take it out", systemImage: "xmark") }
                .disabled(locked)
        } footer: {
            Text("\(card.going).")
        }
    }
}

private extension String {
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}
