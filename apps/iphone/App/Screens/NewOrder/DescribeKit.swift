import SwiftUI
import ERPCore

// Semi-automatic descriptions (owner, 2026-11-03: "make product description semi automatic since the product is
// usually described as its stone"): a row of suggestion chips under the description, drawn from what this shop
// has already written (`GET /api/app/describe`), plus saved stone combos worded with the category ("Ruby & diamond"
// + Rings = "Ruby & diamond ring"). Used by the new-order piece editor and the new-sale line editor.
//
// Typing never waits on the network: the answer is read once per category (kept in memory for the session and on
// disk for offline) and matched locally, and the chip row is its own small view with its own state.

// MARK: What the server gives

struct DescribeEntry: Hashable, Identifiable, Sendable {
    let text: String
    let count: Int
    let lastAt: String
    let category: String
    /// Lower case, so a keystroke compares without lowering every entry again.
    let lower: String
    var id: String { category + "|" + lower }
}

struct DescribePayload: Sendable {
    var history: [DescribeEntry] = []
    var combos: [String] = []
}

/// The shop's past descriptions and saved stone combos. Keyed by business, so a switch never shows another shop's words.
@MainActor @Observable
final class DescribeStore {
    static let shared = DescribeStore()

    private(set) var history: [String: [DescribeEntry]] = [:]
    private(set) var combos: [String] = []
    /// Bumped on every change, so a small view can recompute from `.onChange(of: store.revision)`.
    private(set) var revision = 0

    @ObservationIgnored private var fresh: Set<String> = []
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored private var combosFor = ""

    private init() {}

    private var business: String { House.business.id }
    private func key(_ category: String) -> String { business + "|" + category }
    private var combosKey: String { BizKey("describe.combos") }

    /// The past descriptions read for this category ("" is every category), most used first.
    func entries(_ category: String) -> [DescribeEntry] { history[key(category)] ?? [] }

    // MARK: Reading

    /// Reads the answer once per category and session: what is on disk shows at once, the network answer replaces it.
    func load(_ category: String) {
        let k = key(category)
        guard !fresh.contains(k), !inFlight.contains(k) else { return }
        inFlight.insert(k)
        if combosFor != business {
            combosFor = business
            combos = UserDefaults.standard.stringArray(forKey: combosKey) ?? []
        }
        let path = Self.path(category)
        let name = Self.fileName(k)
        Task { [weak self] in
            if self?.history[k] == nil {
                let cached = await Task.detached { () -> DescribePayload? in
                    guard let url = DescribeStore.file(name), let data = try? Data(contentsOf: url) else { return nil }
                    return DescribeStore.parse(data)
                }.value
                if let cached { self?.apply(cached, k) }
            }
            do {
                let data = try await ERPAPI.shared.data(path)
                let parsed = await Task.detached { DescribeStore.parse(data) }.value
                if let url = DescribeStore.file(name) {
                    Task.detached { _ = try? data.write(to: url, options: .atomic) }
                }
                self?.apply(parsed, k)
                self?.fresh.insert(k)
            } catch {
                // Offline: what was kept on the device is what shows.
            }
            self?.inFlight.remove(k)
        }
    }

    private func apply(_ payload: DescribePayload, _ k: String) {
        history[k] = payload.history
        var merged = payload.combos
        for local in UserDefaults.standard.stringArray(forKey: combosKey) ?? [] where !merged.contains(where: { $0.caseInsensitiveCompare(local) == .orderedSame }) {
            merged.append(local)
        }
        if !merged.isEmpty || combos.isEmpty { combos = merged }
        revision += 1
    }

    // MARK: Saving a combo

    /// Appends a stone combo to the shop's list and sends the whole list (`setStoneCombos`, not a money op).
    @discardableResult
    func addCombo(_ raw: String) -> Bool {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !combos.contains(where: { $0.caseInsensitiveCompare(t) == .orderedSame }) else { return false }
        combos.append(t)
        UserDefaults.standard.set(combos, forKey: combosKey)
        revision += 1
        Outbox.shared.send(op: "setStoneCombos", fields: ["combos": combos], label: "Stone combos")
        return true
    }

    // MARK: Disk and parsing (off the main actor)

    nonisolated private static func path(_ category: String) -> String {
        category.isEmpty ? "/api/app/describe" : "/api/app/describe?category=" + (category.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? category)
    }

    nonisolated private static func fileName(_ key: String) -> String {
        String(key.map { $0.isLetter || $0.isNumber ? $0 : "_" })
    }

    nonisolated private static func file(_ name: String) -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("erp-describe", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(name + ".json")
    }

    /// Lenient: a row without text is skipped, a missing count is 1.
    nonisolated static func parse(_ data: Data) -> DescribePayload {
        var out = DescribePayload()
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return out }
        if let rows = root["history"] as? [[String: Any]] {
            for r in rows {
                let text = ((r["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty { continue }
                let count = (r["count"] as? NSNumber)?.intValue ?? 1
                var lastAt = ""
                if let s = r["lastAt"] as? String { lastAt = s } else if let n = r["lastAt"] as? NSNumber { lastAt = n.stringValue }
                let category = (r["category"] as? String) ?? ""
                out.history.append(DescribeEntry(text: text, count: count, lastAt: lastAt, category: category, lower: text.lowercased()))
            }
        }
        out.history.sort { a, b in a.count != b.count ? a.count > b.count : a.lastAt > b.lastAt }
        if let list = root["combos"] as? [Any] {
            for any in list {
                guard let s = any as? String else { continue }
                let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty && !out.combos.contains(where: { $0.caseInsensitiveCompare(t) == .orderedSame }) { out.combos.append(t) }
            }
        }
        return out
    }
}

// MARK: Matching

struct DescribeSuggestion: Identifiable, Hashable {
    let text: String
    var id: String { text }
}

enum DescribeSuggest {
    static let limit = 8

    /// "Ruby & diamond" + Rings = "Ruby & diamond ring": the combo's words, then the category's singular word.
    static func compose(_ combo: String, word: String) -> String {
        let c = combo.trimmingCharacters(in: .whitespacesAndNewlines)
        if c.isEmpty { return "" }
        let head = c.prefix(1).uppercased() + c.dropFirst()
        if word.isEmpty || c.lowercased().hasSuffix(word) { return head }
        return head + " " + word
    }

    /// What to offer for what is typed: this category's past descriptions first, then the combos worded with the
    /// category, then (only while something is typed) the other categories'. An empty field offers the category's top ones.
    static func compute(query: String, category: String, entries: [DescribeEntry], combos: [String]) -> [DescribeSuggestion] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tokens = q.split(separator: " ").map(String.init)
        let word = (categorySingular(category) ?? "").lowercased()
        func fits(_ lower: String) -> Bool {
            lower != q && tokens.allSatisfy { lower.contains($0) }
        }
        var seen = Set<String>()
        var mine: [DescribeSuggestion] = []
        var other: [DescribeSuggestion] = []
        for e in entries {
            if mine.count >= 24 && other.count >= 24 { break }
            guard fits(e.lower), !seen.contains(e.lower) else { continue }
            if category.isEmpty || e.category == category {
                seen.insert(e.lower)
                mine.append(DescribeSuggestion(text: e.text))
            } else if !q.isEmpty {
                seen.insert(e.lower)
                other.append(DescribeSuggestion(text: e.text))
            }
        }
        var composed: [DescribeSuggestion] = []
        for c in combos {
            let t = compose(c, word: word)
            let lower = t.lowercased()
            guard !t.isEmpty, fits(lower), !seen.contains(lower) else { continue }
            seen.insert(lower)
            composed.append(DescribeSuggestion(text: t))
        }
        func leading(_ list: [DescribeSuggestion]) -> [DescribeSuggestion] {
            if q.isEmpty { return list }
            let starts = list.filter { $0.text.lowercased().hasPrefix(q) }
            return starts + list.filter { !$0.text.lowercased().hasPrefix(q) }
        }
        return Array((leading(mine) + leading(composed) + leading(other)).prefix(limit))
    }
}

// MARK: The chip row

/// Under the description field. Its height is reserved (the chips fade in and out, the row never grows), and it owns
/// its matching, so a keystroke in the form does not redraw anything but this.
struct DescribeSuggestions: View {
    @Binding var text: String
    let category: String

    private let store = DescribeStore.shared
    @State private var shown: [DescribeSuggestion] = []
    @State private var showAll = false
    @State private var addCombo = false
    @State private var picked = 0

    var body: some View {
        HStack(spacing: pt(4)) {
            ScrollView(.horizontal) {
                HStack(spacing: pt(8)) {
                    ForEach(shown) { s in
                        Button {
                            text = s.text
                            picked += 1
                        } label: {
                            Text(s.text).lineLimit(1).frame(maxWidth: 280)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, pt(2))
            }
            .scrollIndicators(.hidden)
            .opacity(shown.isEmpty ? 0 : 1)
            .accessibilityHidden(shown.isEmpty)
            Menu {
                Button { showAll = true } label: { Label("View all descriptions", systemImage: "list.bullet") }
                Button { addCombo = true } label: { Label("Add stone combo", systemImage: "plus") }
            } label: {
                Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
            }
            .accessibilityLabel("More descriptions")
        }
        .frame(height: 44)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 4))
        .task(id: category) {
            store.load(category)
            recompute()
        }
        .onChange(of: text) { _, _ in recompute() }
        .onChange(of: store.revision) { _, _ in recompute() }
        .selectionFeedback(trigger: picked)
        .sheet(isPresented: $showAll) {
            DescribeHistorySheet(category: category) { chosen in text = chosen }
        }
        .sheet(isPresented: $addCombo) {
            StoneComboSheet()
        }
    }

    private func recompute() {
        shown = DescribeSuggest.compute(query: text, category: category, entries: store.entries(category), combos: store.combos)
    }
}

// MARK: View all

/// Every past description, most used first: search it, and narrow it by category.
struct DescribeHistorySheet: View {
    let category: String
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    private let store = DescribeStore.shared
    @State private var filter: String
    @State private var query = ""

    init(category: String, onPick: @escaping (String) -> Void) {
        self.category = category
        self.onPick = onPick
        _filter = State(initialValue: category)
    }

    private var all: [DescribeEntry] {
        let wide = store.entries("")
        return wide.isEmpty ? store.entries(category) : wide
    }

    private var counts: [String: Int] {
        var out: [String: Int] = [:]
        for e in all { out[e.category, default: 0] += 1 }
        return out
    }

    private var rows: [DescribeEntry] {
        let tokens = query.lowercased().split(separator: " ").map(String.init)
        return all.filter { e in
            (filter.isEmpty || e.category == filter) && tokens.allSatisfy { e.lower.contains($0) }
        }
    }

    private var composed: [DescribeSuggestion] {
        guard query.isEmpty else { return [] }
        let word = (categorySingular(filter) ?? "").lowercased()
        return store.combos.map { DescribeSuggestion(text: DescribeSuggest.compose($0, word: word)) }.filter { !$0.text.isEmpty }
    }

    private func line(_ e: DescribeEntry) -> String {
        let title = categoryTitle(e.category) ?? ""
        let times = e.count == 1 ? "1 time" : "\(e.count) times"
        return title.isEmpty ? times : title + " · " + times
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ScrollView(.horizontal) {
                        HStack(spacing: pt(8)) {
                            FilterChip(title: "All", count: all.count, chosen: filter.isEmpty) { filter = "" }
                            ForEach(NewOrderWords.categories.filter { counts[$0.id] != nil }) { c in
                                FilterChip(title: c.label, count: counts[c.id], chosen: filter == c.id) { filter = c.id }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
                if !composed.isEmpty {
                    Section("Stone combos") {
                        ForEach(composed) { s in
                            Button { choose(s.text) } label: { Text(s.text).foregroundStyle(.primary) }
                        }
                    }
                }
                Section {
                    ForEach(rows) { e in
                        Button { choose(e.text) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.text).foregroundStyle(.primary)
                                Text(line(e)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .houseForm()
            .overlay {
                if rows.isEmpty && composed.isEmpty {
                    if !query.isEmpty {
                        ContentUnavailableView.search(text: query)
                    } else {
                        ContentUnavailableView("No past descriptions yet", systemImage: "text.badge.plus")
                    }
                }
            }
            .searchable(text: $query, prompt: "Search descriptions")
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Past descriptions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { store.load("") }
        }
        .presentationDetents([.medium, .large])
    }

    private func choose(_ text: String) {
        onPick(text)
        dismiss()
    }
}

// MARK: Add a stone combo

/// A quick way to add a combo: tap the stones, or type any words. It joins them ("Ruby & diamond") and adds it to
/// the shop's list, which every description row then offers with the category's word.
struct StoneComboSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let store = DescribeStore.shared
    @State private var picked: [String] = []
    @State private var extra = ""
    @State private var saved = 0

    static let stones = ["Diamond", "Ruby", "Emerald", "Sapphire", "Pearl", "Zircon", "Polki", "Kundan", "Turquoise", "Coral", "Onyx", "Moissanite"]

    private var combo: String {
        var parts = picked.map { $0.lowercased() }
        for piece in extra.split(separator: ",") {
            let t = piece.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { parts.append(t) }
        }
        let joined = parts.joined(separator: " & ")
        return joined.prefix(1).uppercased() + joined.dropFirst()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], spacing: 8) {
                        ForEach(Self.stones, id: \.self) { s in
                            NewOrderChip(title: s, on: picked.contains(s)) {
                                if let i = picked.firstIndex(of: s) { picked.remove(at: i) } else { picked.append(s) }
                            }
                        }
                    }
                    TextField("Another stone, or your own words", text: $extra, prompt: Text("e.g. Pearl, Zircon"))
                } header: {
                    Text("Stones")
                } footer: {
                    Text(combo.isEmpty ? "Pick the stones this piece usually has." : "Saved as \"\(combo)\"; a ring then reads \"\(DescribeSuggest.compose(combo, word: "ring"))\".")
                }
                if !store.combos.isEmpty {
                    Section("Saved combos") {
                        ForEach(store.combos, id: \.self) { Text($0) }
                    }
                }
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Add stone combo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        store.addCombo(combo)
                        saved += 1
                        dismiss()
                    }
                    .disabled(combo.isEmpty)
                }
            }
            .savedFeedback(trigger: saved)
            .interactiveDismissDisabled(!picked.isEmpty || !extra.isEmpty)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: Wastage

/// 10% · 12% · 15% · 25% · Other. A value that is not on the list reads as Other, with its own fields; the stored
/// figure is the same percentage as before.
struct WastageChips: View {
    @Binding var percent: String
    /// True once Other is chosen (and for a value not on the list), so typing "12" in Other never flips the row back.
    @Binding var other: Bool

    static let presets = [10, 12, 15, 25]

    static func preset(_ percent: String) -> Int? {
        guard let v = Double(percent.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return presets.first { abs(Double($0) - v) < 0.0001 }
    }

    /// Whether Other's fields show.
    static func reveals(_ percent: String, _ other: Bool) -> Bool { other || preset(percent) == nil }

    private var selection: Binding<String> {
        Binding(
            get: { WastageChips.reveals(percent, other) ? "other" : String(WastageChips.preset(percent) ?? 0) },
            set: { chosen in
                if chosen == "other" {
                    other = true
                } else {
                    other = false
                    percent = chosen
                }
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Text("Wastage").font(.caption).foregroundStyle(.secondary)
            Picker("Wastage", selection: selection) {
                ForEach(Self.presets, id: \.self) { p in Text("\(p)%").tag(String(p)) }
                Text("Other").tag("other")
            }
            .pickerStyle(.segmented)
        }
        .onAppear {
            if WastageChips.preset(percent) == nil { other = true }
        }
    }
}
