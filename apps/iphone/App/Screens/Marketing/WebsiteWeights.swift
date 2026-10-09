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
    @FocusState private var typing: Bool

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
                ContentUnavailableView("This shop's website prices pieces without weights", systemImage: "scalemass")
            } else if let pieces {
                page(pieces)
            } else if let problem {
                ContentUnavailableView {
                    Label("Couldn't load the catalogue", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Try again") { Task { await load() } }.buttonStyle(.glass)
                }
            } else {
                ProgressView("Loading the catalogue…").controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
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
            Button("Save") { Task { await save(p) } }
            Button("Save, and don't ask again here") {
                trusted = true
                Task { await save(p) }
            }
        } message: { (p: Pending) in
            Text(words(p))
        }
        .alert("Not saved", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var confirmingShown: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { (on: Bool) in if !on { confirming = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
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
        let c = counts
        let q = queue
        return List {
            Group {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(c.withWeight)").font(.title2.weight(.semibold)).monospacedDigit()
                            Text("of \(c.total) weighed").foregroundStyle(.secondary)
                            Spacer()
                            Text(c.total - c.withWeight > 0 ? "\(c.total - c.withWeight) to go" : "all weighed")
                                .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        }
                        ProgressView(value: Double(c.withWeight), total: Double(max(1, c.total))).tint(Theme.accent)
                    }
                    .padding(.vertical, 4)
                    Picker("Collection", selection: $collection) {
                        Text("All collections").tag("")
                        ForEach(collections, id: \.self) { (name: String) in Text(name).tag(name) }
                    }
                    .pickerStyle(.menu)
                    Toggle("Only photos without a weight", isOn: $onlyMissing).tint(Theme.accent)
                } footer: {
                    Text("Type the weight of the piece in the photograph. \(site.siteName) shows it in the corner, as on the photos that already carry one, and prices from it.")
                }
                WebsiteSetOfTheDay(withNote: true)
                if let p = current {
                    photoSection(p, of: q.count)
                    weightSection(p)
                    if !upcoming.isEmpty { upcomingSection }
                } else {
                    Section {
                        ContentUnavailableView(onlyMissing ? "Every photo here has a weight" : "Nothing matches", systemImage: "checkmark.circle",
                                               description: Text(onlyMissing ? "Switch off “Only photos without a weight” to review or correct any of them." : "Clear the search or choose another collection."))
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
    }

    private func photoSection(_ p: WebsiteWeightPiece, of total: Int) -> some View {
        Section {
            StockImage(imageUrl: p.thumb, name: p.file, key: p.key)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 14))
                .overlay(alignment: .topLeading) {
                    // Where the site draws it (WeightLabel.jsx: 120/3000 in, 143/3000 high), so what is typed shows where it lands.
                    if p.source != "label", let shown = preview(p) {
                        Text(shown + "g")
                            .font(.system(size: 16, weight: .light))
                            .foregroundStyle(.white)
                            .padding(.leading, 14)
                            .padding(.top, 13)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if p.source == "label", let g = p.labelWeightGrams {
                        Text("Weight on the photo: \(WebsiteNumber.grams(g))g")
                            .font(.caption)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.black.opacity(0.55), in: .capsule)
                            .padding(8)
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
            Text(p.collection)
        } footer: {
            Text(p.file)
        }
    }

    private func weightSection(_ p: WebsiteWeightPiece) -> some View {
        Section {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TextField("0.00", text: $value)
                    .keyboardType(.decimalPad)
                    .focused($typing)
                    .font(.system(size: 40, weight: .semibold))
                    .monospacedDigit()
                Text("g").font(.title).foregroundStyle(.secondary)
            }
            Button { ask(advance: true) } label: {
                Label(saving ? "Saving…" : "Save & next", systemImage: "checkmark")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(saving)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            Button("Skip") { index = min(index + 1, max(0, queue.count - 1)) }
                .disabled(index >= queue.count - 1)
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

    private var upcomingSection: some View {
        Section("Coming up") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(upcoming) { (u: Upcoming) in
                        Button { index = u.at } label: {
                            StockImage(imageUrl: u.piece.thumb, name: u.piece.file, key: u.piece.key)
                                .frame(width: 64, height: 64)
                                .clipShape(.rect(cornerRadius: 10))
                                .overlay(alignment: .bottom) {
                                    if let g = u.piece.weightGrams {
                                        Text("\(WebsiteNumber.grams(g))g")
                                            .font(.caption2)
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity)
                                            .background(Color.black.opacity(0.55))
                                    }
                                }
                                .clipShape(.rect(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    /// What the site would draw: what is typed, else the weight already recorded.
    private func preview(_ p: WebsiteWeightPiece) -> String? {
        let typed = value.filter { (ch: Character) in ch.isNumber || ch == "." || ch == "," }.replacingOccurrences(of: ",", with: ".")
        if !typed.isEmpty { return typed }
        return p.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) }
    }

    // MARK: Reading and saving

    private func load() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/pieces", as: WebsiteWeightsAnswer.self)
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
        if trusted { Task { await save(pending) } } else { confirming = pending }
    }

    /// Exactly what changes on the site, for every visitor.
    private func words(_ p: Pending) -> String {
        if let g = p.grams {
            return "\(WebsiteNumber.grams(g)) g for \(p.file). \(site.siteName) draws it on the photograph's corner (unless the photo carries its own) and prices the piece from it at the day's rate, for everyone who opens it."
        }
        let own = p.label.map { (g: Double) in " The photo's own \(WebsiteNumber.grams(g))g stays." } ?? ""
        return "The weight typed for \(p.file) comes off \(site.siteName): the site stops drawing it and pricing from it.\(own)"
    }

    private func save(_ p: Pending) async {
        saving = true
        defer { saving = false }
        do {
            let body: [String: Any] = ["key": p.key, "weightGrams": p.grams.map { (g: Double) -> Any in g } ?? NSNull()]
            _ = try await ERPAPI.shared.send("/api/website/pieces", method: "PUT", body)
            let was = queue
            if var list = pieces, let k = list.firstIndex(where: { (x: WebsiteWeightPiece) in x.key == p.key }) {
                list[k].weightGrams = p.grams ?? list[k].labelWeightGrams
                list[k].source = p.grams != nil ? "pos" : (list[k].labelWeightGrams != nil ? "label" : nil)
                list[k].enteredBy = p.grams != nil ? "you" : nil
                list[k].enteredAt = p.grams != nil ? ERPDate.iso(Date()) : nil
                pieces = list
            }
            // With "only missing" on, the piece leaves the list and the next slides into its place; otherwise step on.
            if p.advance && !onlyMissing { index = min(index + 1, max(0, was.count - 1)) }
            prefill()
            typing = true
        } catch {
            failure = error.localizedDescription
        }
    }
}
