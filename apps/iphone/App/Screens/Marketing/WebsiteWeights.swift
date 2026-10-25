import SwiftUI
import ERPCore

/// Website → Photo weights (src/app/website/weights/page.tsx): the weight of each catalogue photograph that
/// doesn't carry it in its corner, one photo at a time, for a person at the counter with a scale. Save & next
/// records it and shows the next one that needs a weight; a strip shows what is coming. The same route as the
/// web (/api/website/pieces, PUT { key, weightGrams }).
///
/// The site draws a weight recorded here on the photograph and prices the piece from it, for every visitor, so
/// the first save of a visit says so and asks; "don't ask again here" lasts until the screen is left.
struct WebsiteWeightsScreen: View {
    private var site: WebsiteStore { WebsiteStore.shared }

    @State private var pieces: [WebsiteWeightPiece]?
    @State private var problem: String?
    @State private var collection = ""
    @State private var onlyMissing = true
    @State private var search = ""
    @State private var index = 0
    @State private var value = ""
    @State private var saving = false
    @State private var confirming: Pending?
    /// The counter said not to ask again until the screen is left.
    @State private var trusted = false
    @State private var failure: String?
    @State private var savedTick = 0
    /// Weights that went through the Outbox and came back (the row under the progress bar ticks).
    @State private var done = WeightsDone()
    @FocusState private var typing: Bool

    @MainActor @Observable final class WeightsDone { var count = 0 }

    private var outbox: Outbox { Outbox.shared }
    private static let labelPrefix = "Weight: "
    /// The weights still on their way (or that failed): label "Weight: <file>".
    private var weightItems: [Outbox.Item] { outbox.items.filter { (i: Outbox.Item) in i.label.hasPrefix(Self.labelPrefix) } }

    /// A weight about to go to the site, waiting for the counter's yes.
    struct Pending: Identifiable {
        let id = UUID()
        let key: String
        let file: String
        let grams: Double?
        let label: Double?
        let advance: Bool
    }

    var body: some View {
        Group {
            if let s = site.settings, !s.weights {
                NotAvailableState("This shop's website prices pieces without weights", symbol: "scalemass")
            } else if let pieces {
                page(pieces)
            } else if let problem {
                ErrorState(problem) { Task { await load() } }
            } else {
                SkeletonLoading("Loading the catalogue…").controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Photo weights")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Find a photo…")
        .task {
            await site.loadSettings()
            if pieces == nil { await load() }
        }
        .onChange(of: collection) { _, _ in index = 0 }
        .onChange(of: onlyMissing) { _, _ in index = 0 }
        .onChange(of: search) { _, _ in index = 0 }
        .onChange(of: queue.count) { _, n in index = min(index, max(0, n - 1)) }
        .onChange(of: current?.key) { _, _ in prefill() }
        .confirmationDialog("Put this on \(site.siteName)?", isPresented: confirmingShown, titleVisibility: .visible, presenting: confirming) { (p: Pending) in
            Button("Save") { save(p) }
            Button("Save, and don't ask again here") {
                trusted = true
                save(p)
            }
        } message: { (p: Pending) in
            Text(words(p))
        }
        .failureAlert($failure, title: "Not saved")
    }

    private var confirmingShown: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { (on: Bool) in if !on { confirming = nil } })
    }


    // MARK: The list being worked through

    private var collections: [String] {
        Array(Set((pieces ?? []).map { (p: WebsiteWeightPiece) in p.collection }.filter { (c: String) in !c.isEmpty })).sorted()
    }

    private var queue: [WebsiteWeightPiece] {
        var q = pieces ?? []
        if !collection.isEmpty { q = q.filter { (p: WebsiteWeightPiece) in p.collection == collection } }
        if onlyMissing { q = q.filter { (p: WebsiteWeightPiece) in p.weightGrams == nil } }
        let s = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !s.isEmpty { q = q.filter { (p: WebsiteWeightPiece) in p.key.lowercased().contains(s) } }
        return q
    }

    private var current: WebsiteWeightPiece? {
        let q = queue
        return q.indices.contains(index) ? q[index] : nil
    }

    private var counts: (total: Int, withWeight: Int) {
        let all = pieces ?? []
        let scoped = collection.isEmpty ? all : all.filter { (p: WebsiteWeightPiece) in p.collection == collection }
        return (scoped.count, scoped.filter { (p: WebsiteWeightPiece) in p.weightGrams != nil }.count)
    }

    struct Upcoming: Identifiable {
        let at: Int
        let piece: WebsiteWeightPiece
        var id: String { piece.key }
    }

    private var upcoming: [Upcoming] {
        let q = queue
        guard index + 1 < q.count else { return [] }
        return (index + 1..<min(q.count, index + 13)).map { (i: Int) in Upcoming(at: i, piece: q[i]) }
    }

    // MARK: The page

    private func page(_ all: [WebsiteWeightPiece]) -> some View {
        #if os(macOS)
        macPage(all)
        #else
        phonePage(all)
        #endif
    }

    private func phonePage(_ all: [WebsiteWeightPiece]) -> some View {
        let c = counts
        let q = queue
        return List {
            Group {
                Section {
                    VStack(alignment: .leading, spacing: pt(8)) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(c.withWeight)").font(.system(.title2, design: .serif).weight(.semibold)).monospacedDigit().contentTransition(.numericText(value: Double(c.withWeight)))
                            Text("of \(c.total) weighed").foregroundStyle(.secondary)
                            Spacer()
                            Text(c.total - c.withWeight > 0 ? "\(c.total - c.withWeight) to go" : "all weighed")
                                .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        }
                        ProgressView(value: Double(c.withWeight), total: Double(max(1, c.total))).tint(Theme.accent)
                    }
                    .padding(.vertical, pt(4))
                    savingRow
                    Picker("Collection", selection: $collection) {
                        Text("All collections").tag("")
                        ForEach(collections, id: \.self) { (name: String) in Text(name).tag(name) }
                    }
                    .pickerStyle(.menu)
                    Toggle("Only photos without a weight", isOn: $onlyMissing).tint(Theme.accent)
                } footer: {
                    Text("\(site.siteName) shows it in the corner and prices from it.")
                }
                WebsiteSetOfTheDay(withNote: true)
                if let p = current {
                    photoSection(p, of: q.count)
                    weightSection(p)
                    if !upcoming.isEmpty { upcomingSection }
                } else {
                    Section {
                        Label(onlyMissing ? "Every photo here has a weight. Switch off “Only photos without a weight” to review or correct any of them." : "Nothing matches. Clear the search or choose another collection.",
                              systemImage: "checkmark.circle")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .savedFeedback(trigger: savedTick)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if current != nil {
                ActionBar(primary: .init("Save & next", systemImage: "checkmark") { ask(advance: true) })
            }
        }
    }

    /// "Saving…" while weights go, a warning if one failed (the banner has Retry), then a tick.
    @ViewBuilder
    private var savingRow: some View {
        let items = weightItems
        if let bad = items.first(where: { (i: Outbox.Item) in i.status == .failed }) {
            Label("Not saved: \(bad.label.dropFirst(Self.labelPrefix.count))", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote).foregroundStyle(Tone.problem.color)
        } else if !items.isEmpty {
            Label("Saving \(items.count)…", systemImage: "arrow.triangle.2.circlepath").font(.footnote).foregroundStyle(.secondary)
        } else if done.count > 0 {
            Label("\(done.count) saved", systemImage: "checkmark.circle.fill").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func photoSection(_ p: WebsiteWeightPiece, of total: Int) -> some View {
        Section {
            StockImage(imageUrl: p.thumb, name: p.file, key: p.key)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                .overlay(alignment: .topLeading) {
                    // As the site draws it (WeightLabel.jsx): Futura LT Light (bundled, App/Resources/Fonts) at 143/3000 of
                    // the photo's width, 120/3000 in, its baseline at (100 + 143 × 1.1)/3000 — so what is typed shows
                    // where it lands, at its size, in its face.
                    if p.source != "label", let shown = preview(p) {
                        GeometryReader { geo in
                            let w = geo.size.width
                            Text(shown + "g")
                                .font(.custom("FuturaLT-Light", fixedSize: w * 143 / 3000))
                                .tracking(w * 2 / 3000)
                                .foregroundStyle(.white)
                                .offset(x: w * 120 / 3000, y: w * 114 / 3000)
                        }
                        .allowsHitTesting(false)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if p.source == "label", let g = p.labelWeightGrams {
                        Text("Weight on the photo: \(WebsiteNumber.grams(g))g")
                            .font(.caption)
                            .foregroundStyle(.primary)
                            .padding(.horizontal, pt(8)).padding(.vertical, pt(4))
                            .background(Theme.card, in: .capsule)
                            .padding(pt(8))
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            HStack {
                Button { index = max(index - 1, 0) } label: { Label("Previous", systemImage: "chevron.left") }
                    .disabled(index == 0)
                Spacer()
                Text("\(index + 1) of \(total)").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                Spacer()
                Button { index = min(index + 1, total - 1) } label: { Label("Next", systemImage: "chevron.right") }
                    .disabled(index >= total - 1)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
        } header: {
            LedgerHeading(title: p.collection)
        } footer: {
            Text(p.file)
        }
    }

    private func weightSection(_ p: WebsiteWeightPiece) -> some View {
        Section {
            HStack(alignment: .firstTextBaseline, spacing: pt(6)) {
                TextField("0.00", text: $value)
                    .keyboardType(.decimalPad)
                    .keyboardDone()
                    .focused($typing)
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                    .monospacedDigit()
                Text("g").font(.title).foregroundStyle(.secondary)
            }
            Button("Skip") { index = min(index + 1, max(0, queue.count - 1)) }
                .disabled(index >= queue.count - 1)
            WebsiteFeatureButton(key: p.key, name: p.file)
        } header: {
            LedgerHeading(title: "Weight")
        } footer: {
            if p.source == "label", let g = p.labelWeightGrams {
                Text("The photo already shows \(WebsiteNumber.grams(g))g. A weight typed here is used for pricing instead; the photo keeps its own label.")
            } else if p.source == "pos", let at = p.enteredAt {
                let who = (p.enteredBy ?? "").isEmpty || p.enteredBy == "counter" ? "" : " by \(p.enteredBy ?? "")"
                Text("Recorded \(ShopDate.say(at, withTime: true))\(who). Clear the field and save to remove it.")
            }
        }
    }

    private var upcomingSection: some View {
        LedgerSection("Coming up") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: pt(8)) {
                    ForEach(upcoming) { (u: Upcoming) in
                        Button { index = u.at } label: {
                            StockImage(imageUrl: u.piece.thumb, name: u.piece.file, key: u.piece.key)
                                .frame(width: 64, height: 64)
                                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    if let st = outbox.status(of: Self.labelPrefix + u.piece.file) {
                                        Image(systemName: st == .failed ? "exclamationmark.circle.fill" : "ellipsis.circle.fill")
                                            .font(.caption).foregroundStyle(st == .failed ? Tone.problem.color : Color.secondary).padding(pt(2))
                                    }
                                }
                                .overlay(alignment: .bottom) {
                                    if let g = u.piece.weightGrams {
                                        Text("\(WebsiteNumber.grams(g))g")
                                            .font(.caption2)
                                            .foregroundStyle(.primary)
                                            .frame(maxWidth: .infinity)
                                            .background(Theme.card.opacity(0.85))
                                    }
                                }
                                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, pt(4))
            }
        }
    }

    /// What the site would draw: what is typed, else the weight already recorded.
    private func preview(_ p: WebsiteWeightPiece) -> String? {
        if let v = ShopNumber.parse(value) { return WebsiteNumber.grams(v) }
        let typed = value.filter { (ch: Character) in ch.isNumber || ch == "." || ch == "," }
        if !typed.isEmpty { return typed }
        return p.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) }
    }

    // MARK: Reading and saving

    private func load() async {
        if pieces == nil, let cached = SWR.peek("/api/website/pieces", as: WebsiteWeightsAnswer.self) { pieces = cached.pieces; prefill() }
        do {
            let a = try await SWR.get("/api/website/pieces", as: WebsiteWeightsAnswer.self)
            pieces = a.pieces
            problem = nil
            prefill()
        } catch {
            if pieces == nil { problem = error.localizedDescription } else { failure = error.localizedDescription }
        }
    }

    /// The field starts with the weight typed here before (never the photo's own label).
    private func prefill() {
        guard let p = current else { value = ""; return }
        value = p.source == "pos" ? (p.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) } ?? "") : ""
    }

    private func ask(advance: Bool) {
        guard let p = current, !saving else { return }
        let typed = value.trimmingCharacters(in: .whitespaces)
        let grams: Double?
        if typed.isEmpty {
            grams = nil
        } else if let g = WebsiteNumber.parse(typed) {
            grams = g
        } else {
            failure = "Enter a weight in grams."
            return
        }
        // Nothing to change here: on to the next photo.
        let recorded = p.source == "pos" ? p.weightGrams : nil
        if grams == recorded {
            if advance { index = min(index + 1, max(0, queue.count - 1)) }
            return
        }
        let pending = Pending(key: p.key, file: p.file, grams: grams, label: p.labelWeightGrams, advance: advance)
        if trusted { save(pending) } else { confirming = pending }
    }

    /// Exactly what changes on the site, for every visitor.
    private func words(_ p: Pending) -> String {
        if let g = p.grams {
            return "\(WebsiteNumber.grams(g)) g for \(p.file). \(site.siteName) draws it on the photograph's corner (unless the photo carries its own) and prices the piece from it at the day's rate, for everyone who opens it."
        }
        let own = p.label.map { (g: Double) in " The photo's own \(WebsiteNumber.grams(g))g stays." } ?? ""
        return "The weight typed for \(p.file) comes off \(site.siteName): the site stops drawing it and pricing from it.\(own)"
    }

    /// Instant: the piece is changed here and the counter moves on; the site's PUT goes through the Outbox
    /// (a failure comes back with Retry, and the same PUT is safe to repeat).
    private func save(_ p: Pending) {
        let body: [String: Any] = ["key": p.key, "weightGrams": p.grams.map { (g: Double) -> Any in g } ?? NSNull()]
        let was = queue
        if var list = pieces, let k = list.firstIndex(where: { (x: WebsiteWeightPiece) in x.key == p.key }) {
            list[k].weightGrams = p.grams ?? list[k].labelWeightGrams
            list[k].source = p.grams != nil ? "pos" : (list[k].labelWeightGrams != nil ? "label" : nil)
            list[k].enteredBy = p.grams != nil ? "you" : nil
            list[k].enteredAt = p.grams != nil ? ERPDate.iso(Date()) : nil
            pieces = list
        }
        let tracker = done
        Outbox.shared.post(label: Self.labelPrefix + p.file) {
            _ = try await ERPAPI.shared.send("/api/website/pieces", method: "PUT", body)
            tracker.count += 1
            return ""
        }
        // With "only missing" on, the piece leaves the list and the next slides into its place; otherwise step on.
        if p.advance && !onlyMissing { index = min(index + 1, max(0, was.count - 1)) }
        prefill()
        typing = true
        savedTick += 1
    }
}

#if os(macOS)
extension WebsiteWeightsScreen {
    /// The photograph large on the left with the weight as the site will draw it; the weight, the progress and what is next on the
    /// right. Save & Next is the footer's default button (Return); Previous and Next are ⌥⌘← and ⌥⌘→ in the Photo menu (⌘[ and ⌘]
    /// are Back and Forward).
    func macPage(_ all: [WebsiteWeightPiece]) -> some View {
        let c = counts
        let q = queue
        return MacTwoPane(sideWidth: 520) {
            List {
                Group {
                    if let p = current {
                        photoSection(p, of: q.count)
                    } else {
                        Section {
                            Label(onlyMissing ? "Every photo here has a weight. Switch off “Only photos without a weight” to review or correct any of them." : "Nothing matches. Clear the search or choose another collection.",
                                  systemImage: "checkmark.circle")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .houseRows()
            }
            .listStyle(.inset)
        } main: {
            VStack(spacing: 0) {
                MacFigures([
                    MacFigure("Weighed", "\(c.withWeight) of \(c.total)"),
                    MacFigure("To go", c.total - c.withWeight > 0 ? "\(c.total - c.withWeight)" : "None"),
                ])
                ProgressView(value: Double(c.withWeight), total: Double(max(1, c.total))).tint(Theme.accent).padding(.horizontal, 14)
                Divider().padding(.top, 8)
                List {
                    Group {
                        Section {
                            savingRow
                        } footer: {
                            Text("\(site.siteName) shows it in the corner and prices from it.")
                        }
                        if let p = current {
                            macWeightSection(p)
                            if !upcoming.isEmpty { upcomingSection }
                        }
                        WebsiteSetOfTheDay(withNote: true)
                    }
                    .houseRows()
                }
                .listStyle(.inset)
            }
        }
        .navigationSubtitle(collection.isEmpty ? "" : collection)
        .macRecordMenu(MacRecordMenu(title: "Photo", groups: [[macSaveNext(q.count), macSkip(q.count)], [macPrevious, macNext(q.count)]]))
        .macRefresh { Task { await load() } }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                MacToolbarAction(action: macPrevious)
                MacToolbarAction(action: macNext(q.count))
                Picker("Collection", selection: $collection) {
                    Text("All Collections").tag("")
                    Divider()
                    ForEach(collections, id: \.self) { (name: String) in Text(name).tag(name) }
                }
                .pickerStyle(.menu)
                .help("Weigh one collection")
                Toggle(isOn: $onlyMissing) { Label("Only photos without a weight", systemImage: "scalemass") }
                    .toggleStyle(.button)
                    .help("Only the photos that have no weight yet")
            }
        }
        .savedFeedback(trigger: savedTick)
        .onAppear { typing = true }
        .actionBar(primary: .init("Save & Next", systemImage: "checkmark", isDisabled: current == nil) { ask(advance: true) })
    }

    private var macPrevious: MacAction {
        MacAction("Previous Photo", symbol: "chevron.left", shortcut: KeyboardShortcut(.leftArrow, modifiers: [.command, .option]), enabled: index > 0, id: "previous") {
            index = max(index - 1, 0)
        }
    }

    private func macNext(_ count: Int) -> MacAction {
        MacAction("Next Photo", symbol: "chevron.right", shortcut: KeyboardShortcut(.rightArrow, modifiers: [.command, .option]), enabled: index < count - 1, id: "next") {
            index = min(index + 1, max(0, count - 1))
        }
    }

    private func macSaveNext(_ count: Int) -> MacAction {
        MacAction("Save & Next", symbol: "checkmark", shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: current != nil, isDefault: true, id: "save-next") {
            ask(advance: true)
        }
    }

    private func macSkip(_ count: Int) -> MacAction {
        MacAction("Skip", symbol: "forward", enabled: index < count - 1, id: "skip") { index = min(index + 1, max(0, count - 1)) }
    }

    /// The weight, typed large; Return saves it and moves on (the footer's default button).
    private func macWeightSection(_ p: WebsiteWeightPiece) -> some View {
        Section {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TextField("0.00", text: $value)
                    .focused($typing)
                    .font(.title.weight(.semibold))
                    .monospacedDigit()
                Text("g").font(.title3).foregroundStyle(.secondary)
            }
            WebsiteFeatureButton(key: p.key, name: p.file)
        } header: {
            Text("Weight")
        } footer: {
            if p.source == "label", let g = p.labelWeightGrams {
                Text("The photo already shows \(WebsiteNumber.grams(g))g. A weight typed here is used for pricing instead; the photo keeps its own label.")
            } else if p.source == "pos", let at = p.enteredAt {
                let who = (p.enteredBy ?? "").isEmpty || p.enteredBy == "counter" ? "" : " by \(p.enteredBy ?? "")"
                Text("Recorded \(ShopDate.say(at, withTime: true))\(who). Clear the field and save to remove it.")
            }
        }
    }
}
#endif
