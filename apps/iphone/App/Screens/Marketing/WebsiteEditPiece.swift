import SwiftUI
import ERPCore

/// One piece of Edit a piece (edit/page.tsx `PieceEditor`): what the website says about it, changed from
/// the counter, through the same route as the web (POST /api/website/edits, a form with `id` and `words`).
/// The name, the description, taheri.shop's tags (stone, metal, karat, cut, style) or the catalogue's facts,
/// the weight, and hiding it; each field shows the site's own and goes back to it. "Put the original photo
/// back" and "Undo every change" are the route's own reverts.
///
/// The photograph is re-made in the ERP's square editor (crop by pinch, the layouts that stamp the weight and
/// the house's mark, the designer, AI Enhance and Ask AI): a canvas this screen does not imitate, so it opens
/// that page in the app (`?web=1`). Every save changes the public site, so it lists exactly what changes and
/// where before it is sent.
struct WebsiteEditPieceScreen: View {
    let id: String

    private var store: WebsiteEdits { WebsiteEdits.shared }

    @State private var piece: WebsiteEditPiece?
    @State private var original: String?
    @State private var lastAI: [String] = []
    @State private var missing = false
    @State private var problem: String?

    @State private var name = ""
    @State private var about = ""
    @State private var factsText = ""
    @State private var tags = WebsiteWords()
    @State private var weight = ""
    @State private var hidden = false

    @State private var confirm: Confirm?
    @State private var busy: String?
    @State private var said: String?
    @State private var failure: String?

    enum Confirm: Identifiable {
        case save
        case photo
        case all
        var id: Int {
            switch self {
            case .save: return 0
            case .photo: return 1
            case .all: return 2
            }
        }
    }

    var body: some View {
        Group {
            if let piece {
                page(piece)
            } else if missing {
                ContentUnavailableView("That piece isn't on the website's list", systemImage: "photo",
                                       description: Text("It may have been taken off the site, or renamed there."))
            } else if let problem {
                ContentUnavailableView {
                    Label("Couldn't read the piece", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Try again") { Task { await load() } }.buttonStyle(.glass)
                }
            } else {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(piece?.words.name ?? "Edit a piece")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await WebsiteStore.shared.loadSettings()
            if piece == nil, let known = store.piece(id) { take(known) }
            await load()
        }
        .websiteBusy(busy)
        .confirmationDialog(confirmTitle, isPresented: confirmShown, titleVisibility: .visible, presenting: confirm) { (c: Confirm) in
            switch c {
            case .save: Button("Save") { Task { await save() } }
            case .photo: Button("Put the original back", role: .destructive) { Task { await putBack(photoOnly: true) } }
            case .all: Button("Undo every change", role: .destructive) { Task { await putBack(photoOnly: false) } }
            }
        } message: { (c: Confirm) in
            Text(confirmWords(c))
        }
        .alert("Not done", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { (on: Bool) in if !on { confirm = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private var siteName: String { store.siteName }

    // MARK: The page

    private func page(_ p: WebsiteEditPiece) -> some View {
        List {
            Group {
                photoSection(p)
                if let said {
                    Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                }
                wordsSection(p)
                weightSection(p)
                Section {
                    Toggle(isOn: $hidden) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Hide from the website")
                            Text("Off every page; its links go to the collection. Show it again any time.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tint(Theme.accent)
                }
                saveSection(p)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
    }

    private func photoSection(_ p: WebsiteEditPiece) -> some View {
        Section {
            StockImage(imageUrl: p.image, name: p.words.name, key: p.id + (p.change?.at ?? ""))
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 14))
                .opacity(p.hidden ? 0.5 : 1)
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            Text(p.photoEdited ? "The website shows a photo made here. The original is kept." : "The website's photo, unchanged.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            MarketingLink(title: "Re-make the photo", subtitle: "Crop it, put the weight and the logo on, fix the light: the ERP's editor",
                          symbol: "crop", path: WebsiteEditScreen.piecePath(p.id) + "&web=1")
            if original != nil || p.photoEdited {
                Button(role: .destructive) { confirm = .photo } label: {
                    Label("Put the original photo back", systemImage: "arrow.counterclockwise")
                }
            }
            if let url = URL(string: p.url), !p.url.isEmpty {
                Link(destination: url) { Label("Open on \(siteName)", systemImage: "safari") }
            }
        } header: {
            Text(headerWords(p))
        } footer: {
            Text(photoNote(p))
        }
    }

    /// "Rings · hidden from the website · changed Today 4:05 pm".
    private func headerWords(_ p: WebsiteEditPiece) -> String {
        var parts: [String] = []
        if !p.collection.isEmpty { parts.append(p.collection) }
        if p.hidden { parts.append("hidden from the website") }
        if p.changed, let at = p.change?.at { parts.append("changed " + ShopDate.say(at, withTime: true)) }
        return parts.joined(separator: " · ")
    }

    /// What the editor would warn about this photograph (edit/page.tsx, beside the layouts).
    private func photoNote(_ p: WebsiteEditPiece) -> String {
        var notes: [String] = []
        if !lastAI.isEmpty { notes.append("Last time: \(lastAI.joined(separator: ", ")). Editing starts from the original photo.") }
        if House.id == "mina" && p.photoSource != nil {
            notes.append(p.sourceMarked
                ? "This photo carries the house's mark already: add nothing more, or clear it first in the editor (AI → Enhance and clear old labels)."
                : "The editor starts from the photo before the catalogue framed it and put the MINA mark on; the mark goes back top right.")
        } else if p.weightOnPhoto && !(p.change?.weightOnPhoto ?? false) {
            notes.append("This photo already shows its weight and logo: a stamp would show them twice, unless the old labels are cleared first.")
        }
        return notes.joined(separator: " ")
    }

    private func wordsSection(_ p: WebsiteEditPiece) -> some View {
        Section {
            field("Name", own: p.own.name, now: name) { name = p.own.name } content: {
                TextField("Name", text: limited($name, 160))
            }
            field("Description", own: p.own.about, now: about) { about = p.own.about } content: {
                TextField(p.hasTags ? "A few lines about the piece, shown on its page." : "The piece in the house's words. A blank line starts a new paragraph.",
                          text: limited($about, 4000), axis: .vertical)
                    .lineLimit(3...10)
            }
            if p.hasTags {
                ForEach(WebsiteWords.tags) { (t: WebsiteWords.Tag) in
                    field(t.label, own: p.own.tag(t.key), now: tags.tag(t.key)) { tags.setTag(t.key, p.own.tag(t.key)) } content: {
                        TextField(t.label, text: tagBinding(t.key))
                    }
                }
            } else {
                field("Details, one per line", own: p.own.facts.joined(separator: "\n"), now: factsLines.joined(separator: "\n")) {
                    factsText = p.own.facts.joined(separator: "\n")
                } content: {
                    TextField("Stone: Emerald\nSetting: Prong", text: $factsText, axis: .vertical)
                        .lineLimit(2...8)
                }
            }
        } header: {
            Text("What the website says")
        }
    }

    /// A field with its label, and "The site's own" when the counter's words differ from what the site was built with.
    private func field<C: View>(_ label: String, own: String, now: String, reset: @escaping () -> Void, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                if own.trimmingCharacters(in: .whitespacesAndNewlines) != now.trimmingCharacters(in: .whitespacesAndNewlines) {
                    Button(action: reset) { Label("The site's own", systemImage: "arrow.uturn.backward") }
                        .font(.caption)
                        .buttonStyle(.borderless)
                }
            }
            content()
        }
    }

    private func weightSection(_ p: WebsiteEditPiece) -> some View {
        Section {
            HStack {
                TextField("0.00", text: $weight)
                    .keyboardType(.decimalPad)
                    .monospacedDigit()
                Text("g").foregroundStyle(.secondary)
            }
        } header: {
            Text("Weight")
        } footer: {
            Text(p.hasTags ? "Prices follow it; the site shows it on photos without one." : "For the photo and captions; the catalogue doesn't print weights.")
        }
    }

    private func saveSection(_ p: WebsiteEditPiece) -> some View {
        Section {
            Button { confirm = .save } label: {
                Label(dirty(p) ? "Save to \(siteName)" : "Nothing changed yet", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(!dirty(p) || name.trimmingCharacters(in: .whitespaces).isEmpty || busy != nil)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if p.changed {
                Button(role: .destructive) { confirm = .all } label: {
                    Label("Undo every change to this piece", systemImage: "arrow.uturn.backward.circle")
                }
            }
        } footer: {
            Text("It shows on \(siteName) within a minute; the next deploy writes it into the pages search engines read.")
        }
    }

    // MARK: The words

    private var factsLines: [String] {
        factsText.split(separator: "\n", omittingEmptySubsequences: false).map { (s: Substring) in s.trimmingCharacters(in: .whitespaces) }.filter { (s: String) in !s.isEmpty }
    }

    private var weightValue: Double? { WebsiteNumber.parse(weight) }

    private func limited(_ text: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { text.wrappedValue }, set: { (v: String) in text.wrappedValue = String(v.prefix(max)) })
    }

    private func tagBinding(_ key: String) -> Binding<String> {
        Binding(get: { tags.tag(key) }, set: { (v: String) in tags.setTag(key, String(v.prefix(key == "karat" ? 8 : 80))) })
    }

    private func tagChanged(_ p: WebsiteEditPiece) -> [(label: String, value: String)] {
        guard p.hasTags else { return [] }
        return WebsiteWords.tags.filter { (t: WebsiteWords.Tag) in tags.tag(t.key) != p.words.tag(t.key) }
            .map { (t: WebsiteWords.Tag) in (label: t.label, value: tags.tag(t.key)) }
    }

    private func dirty(_ p: WebsiteEditPiece) -> Bool {
        name != p.words.name || about != p.words.about
            || (p.hasTags ? !tagChanged(p).isEmpty : factsLines.joined(separator: "\n") != p.words.facts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
            || hidden != p.hidden || weightValue != p.weightGrams
    }

    /// The whole of what the piece should say (the route sends back "put back" for anything equal to the site's own).
    private func wordsNow(_ p: WebsiteEditPiece) -> [String: Any] {
        var w: [String: Any] = ["name": name, "about": about, "hidden": hidden]
        if p.hasTags {
            for t in WebsiteWords.tags { w[t.key] = tags.tag(t.key) }
        } else {
            w["facts"] = factsLines
        }
        w["weightGrams"] = weightValue.map { (g: Double) -> Any in g } ?? NSNull()
        return w
    }

    // MARK: Before anything goes

    private var confirmTitle: String {
        switch confirm ?? .save {
        case .photo: return "Put the original photo back?"
        case .all: return "Undo every change to this piece?"
        default: return "Change it on \(siteName)?"
        }
    }

    /// Exactly what changes on the public site.
    private func confirmWords(_ c: Confirm) -> String {
        guard let p = piece else { return "" }
        let after = "\n\nPages opened from about a minute later show it, for everyone."
        switch c {
        case .photo:
            return "\(siteName) shows the photo as it was built. The design made here is forgotten; the words stay as they are." + after
        case .all:
            return "The photo, the name, the words and hiding all go back to what \(siteName) was built with."
                + (p.hasTags ? " A weight typed here stays (it's the piece's weight)." : "") + after
        case .save:
            var lines: [String] = []
            if name != p.words.name { lines.append("Name: “\(name.trimmingCharacters(in: .whitespaces))”") }
            if about != p.words.about { lines.append("A new description") }
            for t in tagChanged(p) { lines.append("\(t.label): \(t.value.isEmpty ? "(none)" : t.value)") }
            if !p.hasTags && factsLines.joined(separator: "\n") != p.words.facts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) {
                lines.append("New details")
            }
            if weightValue != p.weightGrams { lines.append("Weight: " + (weightValue.map { (g: Double) in "\(WebsiteNumber.grams(g))g" } ?? "none")) }
            if hidden != p.hidden { lines.append(hidden ? "Hidden from the website" : "Shown on the website again") }
            return "On \(siteName):\n" + lines.map { (l: String) in "• " + l }.joined(separator: "\n") + after
        }
    }

    // MARK: Reading and saving

    private func take(_ p: WebsiteEditPiece) {
        piece = p
        name = p.words.name
        about = p.words.about
        factsText = p.words.facts.joined(separator: "\n")
        tags = p.words
        weight = p.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) } ?? ""
        hidden = p.hidden
    }

    private func load() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/edits?id=\(WebsiteNumber.query(id))", as: WebsiteEditOne.self)
            guard let p = a.piece else { missing = true; return }
            // What the counter is typing is kept over a refresh; a first read fills the form.
            if piece == nil || !dirty(piece!) { take(p) } else { piece = p }
            original = a.original
            lastAI = a.lastAI
            problem = nil
            missing = false
        } catch let f as ERPAPI.Failure where f.status == 404 {
            missing = piece == nil
            if !missing { failure = f.message }
        } catch {
            if piece == nil { problem = error.localizedDescription } else { failure = error.localizedDescription }
        }
    }

    private func post(_ fields: [(String, String)]) async throws -> WebsiteEditSaved {
        try await WebsiteForm.json("/api/website/edits", fields: fields, timeout: 130, as: WebsiteEditSaved.self)
    }

    private func save() async {
        guard let p = piece else { return }
        busy = "Saving on \(siteName)…"
        said = nil
        defer { busy = nil }
        do {
            let d = try await post([("id", p.id), ("words", WebsiteForm.text(wordsNow(p)))])
            if let fresh = d.piece {
                take(fresh)
                store.replace(fresh)
            }
            said = d.note ?? (hidden ? "Saved. The piece leaves \(siteName) within a minute." : "Saved on \(siteName). It shows within a minute.")
        } catch {
            failure = error.localizedDescription
        }
    }

    private func putBack(photoOnly: Bool) async {
        guard let p = piece else { return }
        busy = "Putting it back…"
        said = nil
        defer { busy = nil }
        do {
            let d = try await post(photoOnly ? [("id", p.id), ("photo", "revert")] : [("id", p.id), ("action", "revert")])
            if let fresh = d.piece {
                take(fresh)
                store.replace(fresh)
            }
            said = photoOnly ? "The original photo is back on \(siteName) within a minute." : "Everything put back: \(siteName) shows the piece as it was built, within a minute."
            await load()
        } catch {
            failure = error.localizedDescription
        }
    }
}
