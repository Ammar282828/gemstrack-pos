import SwiftUI
#if os(macOS)
import AppKit
#endif
import ERPCore

/// One piece of Edit a piece (edit/page.tsx `PieceEditor`): what the website says about it, changed from
/// the counter, through the same route as the web (POST /api/website/edits, a form with `id` and `words`).
/// The name, the description, taheri.shop's tags (stone, metal, karat, cut, style) or the catalogue's facts,
/// the weight, and hiding it; each field shows the site's own and goes back to it. "Put the original photo
/// back" and "Undo every change" are the route's own reverts.
///
/// The photograph is re-made here as the web's square editor re-makes it (WebsiteEditPhoto.swift): its own shape or
/// square, the layouts that stamp the weight and the house's mark, the designer (crop, filters, anything else), AI
/// Enhance and Ask AI, drawn by the web's own engine and sent with the words in the web's form. Open in Design takes the
/// photograph to the designer, as the web's button does. Every save changes the public site, so it lists exactly what
/// changes and where before it is sent.
struct WebsiteEditPieceScreen: View {
    let id: String
    #if os(macOS)
    /// In Edit a piece's inspector (not a window of its own): a form that fits a narrow column and tells the table what it holds.
    var inInspector = false
    var macBridge: MacWebsiteEditBridge? = nil
    @State private var macTab = 0
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    @Environment(Session.self) private var session

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
    /// The photo being re-made; nil until "Re-make the photo", and again after a photo is put back.
    @State private var photo: WebsitePhotoEdit?
    @State private var photoWarning: String?

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
                ErrorState(problem) { Task { await load() } }
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
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
        .failureAlert($failure)
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { (on: Bool) in if !on { confirm = nil } })
    }


    private var siteName: String { store.siteName }

    // MARK: The page

    private func page(_ p: WebsiteEditPiece) -> some View {
        #if os(macOS)
        macPage(p)
        #else
        phonePage(p)
        #endif
    }

    private func phonePage(_ p: WebsiteEditPiece) -> some View {
        List {
            Group {
                photoSection(p)
                if let said {
                    Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
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
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .refreshable { await load() }
        .sensoryFeedback(.success, trigger: said) { _, now in now != nil }
        .toolbar {
            if p.changed {
                ToolbarItem(placement: .trailingAction) {
                    Menu {
                        Button(role: .destructive) { confirm = .all } label: {
                            Label("Undo every change to this piece", systemImage: "arrow.uturn.backward.circle")
                        }
                    } label: { Label("More", systemImage: "ellipsis") }
                    .accessibilityLabel("More")
                }
            }
        }
        .actionBar(
            primary: .init("Save to \(siteName)", systemImage: "square.and.arrow.down", isBusy: busy != nil,
                           isDisabled: !anyChange(p) || name.trimmingCharacters(in: .whitespaces).isEmpty) { confirm = .save },
            summary: anyChange(p) ? "It shows on \(siteName) within a minute." : "Nothing changed yet.")
    }

    private func photoSection(_ p: WebsiteEditPiece) -> some View {
        Section {
            if let photo, photo.ready {
                WebsitePhotoEditRows(edit: photo, fields: photoFields(p), busy: busy != nil) { (op: String, params: [String: Any], label: String) in
                    Task { await runAI(photo, op, params, label) }
                }
                if let photoWarning {
                    Label(photoWarning, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Tone.owed.color)
                }
                Text(photo.changed(photoFields(p)) ? "The photo will be replaced when you save." : p.photoEdited ? "The website shows a photo made here." : "The website's photo, unchanged.")
                    .font(.subheadline)
                    .foregroundStyle(photo.changed(photoFields(p)) ? .primary : .secondary)
            } else {
                StockImage(imageUrl: p.image, name: p.words.name, key: p.id + (p.change?.at ?? ""))
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                    .opacity(p.hidden ? 0.5 : 1)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                Text(p.photoEdited ? "The website shows a photo made here. The original is kept." : "The website's photo, unchanged.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let problem = photo?.problem {
                    Text(problem).font(.footnote).foregroundStyle(Tone.problem.color)
                }
                Button { Task { await beginPhoto(p) } } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(photo?.loading == true ? "Fetching the photo…" : "Re-make the photo")
                            Text("Crop it, put the weight and the logo on, fix the light").font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "crop") }
                }
                .disabled(photo?.loading == true || busy != nil)
            }
            if original != nil || p.photoEdited {
                Button(role: .destructive) { confirm = .photo } label: {
                    Label("Put the original photo back", systemImage: "arrow.counterclockwise")
                }
            }
            if let url = URL(string: p.url), !p.url.isEmpty {
                Link(destination: url) { Label("Open on \(siteName)", systemImage: "safari") }
            }
            if MarketingKit.has("/design", role: session.role) {
                MarketingLink(title: "Open in Design", symbol: "wand.and.stars",
                              path: "/design?v=make&site=" + WebsiteNumber.query(p.id))
            }
        } header: {
            LedgerHeading(title: headerWords(p))
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
        if !lastAI.isEmpty { notes.append("Last time: \(lastAI.joined(separator: ", ")). Editing starts from the original photo: run the AI again if you want it on this one.") }
        // The MINA mark is the Mina catalogue's framing (docs/features/mina-catalogue.md); no server flag names it, so this
        // stays a brand check on the bundled Mina art, not on a business id.
        if House.bundledArt == "mina" && p.photoSource != nil {
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
            LedgerHeading(title: "What the website says")
        }
    }

    /// A field with its label, and "The site's own" when the counter's words differ from what the site was built with.
    private func field<C: View>(_ label: String, own: String, now: String, reset: @escaping () -> Void, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: pt(4)) {
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
            LedgerHeading(title: "Weight")
        } footer: {
            Text(p.hasTags ? "Prices follow it; the site shows it on photos without one." : "For the photo and captions; the catalogue doesn't print weights.")
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

    /// The words or the photo differ from what the site shows.
    private func anyChange(_ p: WebsiteEditPiece) -> Bool { dirty(p) || (photo?.changed(photoFields(p)) ?? false) }

    private var weightLabel: String {
        // caption.ts weightLabel: the weight as typed, "12.4g", or nothing for no weight.
        var w = weight.trimmingCharacters(in: .whitespaces)
        if w.lowercased().hasSuffix("g") { w = String(w.dropLast()).trimmingCharacters(in: .whitespaces) }
        guard let v = ShopNumber.parse(w), v > 0 else { return "" }
        return WebsiteNumber.grams(v) + "g"
    }

    /// What the photo's bound words read (edit/page.tsx `fields`): the collection, the name, the weight, and the
    /// karat, metal and stone (taheri.shop) or the catalogue's facts.
    private func photoFields(_ p: WebsiteEditPiece) -> [String: String] {
        let details: String
        if p.hasTags {
            let metal = [tags.karat, tags.metal].filter { (s: String) in !s.isEmpty }.joined(separator: " ")
            details = [metal, tags.stone].filter { (s: String) in !s.isEmpty && s.lowercased() != "none" }.joined(separator: " | ")
        } else {
            details = p.facts.joined(separator: " | ")
        }
        return ["kicker": p.collection, "headline": name, "weight": weightLabel, "details": details]
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
            if let photo, photo.changed(photoFields(p)) {
                let w = photo.stamped(photoFields(p)) ? ", with \(weightLabel) on it" : ""
                let ai = photo.ai.isEmpty ? "" : " (\(photo.ai.joined(separator: ", ").lowercased()))"
                lines.insert("The photo is replaced\(w)\(ai). The original is kept.", at: 0)
            }
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

    /// Only the photo is drawn here (the phone's own work, shown as "Drawing the photo…"); the upload is the Outbox's.
    /// The screen is free at once; the words come back from there, or a failure with Retry (the same save is safe to repeat).
    private func save() async {
        guard let p = piece else { return }
        said = nil
        do {
            var fields: [(String, String)] = [("id", p.id), ("words", WebsiteForm.text(wordsNow(p)))]
            var files: [WebsiteForm.File] = []
            let drawn = photoFields(p)
            let photoChanged = photo?.changed(drawn) ?? false
            if let photo, photoChanged {
                // The photo with the words: the web's form exactly (file, stamped, design, shape, ai).
                busy = "Drawing the photo…"
                defer { busy = nil }
                let jpeg = try await photo.jpeg(fields: drawn)
                files.append(WebsiteForm.File(field: "file", name: "photo.jpg", type: "image/jpeg", data: jpeg))
                fields.append(("stamped", photo.stamped(drawn) ? "1" : "0"))
                fields.append(("design", photo.kept.text))
                fields.append(("shape", photo.shape))
                fields.append(("ai", WebsiteForm.text(photo.ai)))
            }
            let shownName = name.trimmingCharacters(in: .whitespaces)
            let nowHidden = hidden
            let (sendFields, sendFiles, site, edit) = (fields, files, siteName, photo)
            said = "Saving on \(site)…"
            Outbox.shared.post(label: "Save \(shownName.isEmpty ? "the piece" : "“" + shownName + "”") on \(site)") {
                let d = try await WebsiteForm.json("/api/website/edits", fields: sendFields, files: sendFiles, timeout: 130, as: WebsiteEditSaved.self)
                if photoChanged { edit?.saved(drawn) }
                if let fresh = d.piece {
                    // The baseline moves on; what is being typed meanwhile stays.
                    piece = fresh
                    store.replace(fresh)
                }
                said = d.note ?? (photoChanged ? "Saved on \(site). The new photo shows within a minute; the original is kept to put back any time."
                    : nowHidden ? "Saved. The piece leaves \(site) within a minute." : "Saved on \(site). It shows within a minute.")
                return "Saved on \(site)"
            }
        } catch {
            failure = error.localizedDescription
        }
    }

    private func putBack(photoOnly: Bool) async {
        guard let p = piece else { return }
        said = "Putting it back…"
        let site = siteName
        let fields: [(String, String)] = photoOnly ? [("id", p.id), ("photo", "revert")] : [("id", p.id), ("action", "revert")]
        Outbox.shared.post(label: photoOnly ? "Put the original photo back on \(site)" : "Undo every change on \(site)") {
            let d = try await WebsiteForm.json("/api/website/edits", fields: fields, timeout: 130, as: WebsiteEditSaved.self)
            if let fresh = d.piece {
                take(fresh)
                store.replace(fresh)
            }
            // The editor starts again from what the site now has, as the web's does.
            photo = nil
            photoWarning = nil
            said = photoOnly ? "The original photo is back on \(site) within a minute." : "Everything put back: \(site) shows the piece as it was built, within a minute."
            return photoOnly ? "Original photo back on \(site)" : "Everything put back on \(site)"
        }
    }

    // MARK: The photo

    private func beginPhoto(_ p: WebsiteEditPiece) async {
        let edit = photo ?? WebsitePhotoEdit(pieceID: p.id)
        photo = edit
        await edit.begin(p, fields: photoFields(p))
        if !edit.lastAI.isEmpty { lastAI = edit.lastAI }
    }

    private func runAI(_ edit: WebsitePhotoEdit, _ op: String, _ params: [String: Any], _ label: String) async {
        busy = "The AI is working on the photo (about a minute)…"
        photoWarning = nil
        defer { busy = nil }
        do {
            photoWarning = try await edit.runAI(op, params: params, label: label)
        } catch {
            failure = "Couldn't change the photo. " + error.localizedDescription
        }
    }
}

#if os(macOS)
extension WebsiteEditPieceScreen {
    /// A piece on a Mac: in Edit a piece's inspector (a tab of details and a tab of the photograph, Save to the Website in its
    /// foot), or whole in a window of its own.
    @ViewBuilder
    func macPage(_ p: WebsiteEditPiece) -> some View {
        if inInspector { macInspectorPage(p) } else { macWindowPage(p) }
    }

    /// Whether there is a change worth saving: the words, the weight, hiding or the photo differ from the site's, the name is not
    /// empty, and nothing is being sent.
    private func macCanSave(_ p: WebsiteEditPiece) -> Bool {
        anyChange(p) && !name.trimmingCharacters(in: .whitespaces).isEmpty && busy == nil
    }

    private func macSaveAction(_ p: WebsiteEditPiece) -> MacAction {
        MacAction("Save to the Website", symbol: "square.and.arrow.down", shortcut: KeyboardShortcut("s", modifiers: .command),
                  enabled: macCanSave(p), isDefault: true) { confirm = .save }
    }

    private func macUndoAction(_ p: WebsiteEditPiece) -> MacAction {
        MacAction("Undo Every Change…", symbol: "arrow.uturn.backward.circle", role: .destructive, enabled: p.changed, id: "undo-all") { confirm = .all }
    }

    // MARK: In the inspector

    private func macInspectorPage(_ p: WebsiteEditPiece) -> some View {
        VStack(spacing: 0) {
            Form {
                Group {
                    Section { macHead(p).listRowInsets(EdgeInsets()) }
                    if let said {
                        Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
                    }
                    macDetails(p)
                    macPhotoTab(p)
                }
                .houseRows()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            macFoot(p)
        }
        .onAppear {
            macBridge?.owner = id
            macBridge?.save = { confirm = .save }
        }
        .onChange(of: macCanSave(p), initial: true) { _, on in macBridge?.canSave = on }
        .onChange(of: anyChange(p), initial: true) { _, on in macBridge?.dirty = on }
        .onDisappear { macBridge?.clear(id) }
    }

    /// The iPhone's record head: the photograph, the name in the serif, its line and a pill for what was changed here.
    private func macHead(_ p: WebsiteEditPiece) -> some View {
        HStack(alignment: .top, spacing: 12) {
            StockImage(imageUrl: p.thumb, name: p.words.name, key: p.id + (p.change?.at ?? ""))
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
                .opacity(p.hidden ? 0.5 : 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(p.words.name.isEmpty ? "A piece" : p.words.name)
                    .font(.system(.title3, design: .serif).weight(.semibold)).lineLimit(2)
                Text(headerWords(p)).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                if p.hidden { Pill("Hidden", tone: .quiet, symbol: "eye.slash") }
                else if p.changed { Pill("Changed here", tone: .working) }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
    }

    @ViewBuilder
    private func macDetails(_ p: WebsiteEditPiece) -> some View {
        Section("What the website says") {
            field("Name", own: p.own.name, now: name) { name = p.own.name } content: {
                TextField("Name", text: limited($name, 160)).labelsHidden()
            }
            field("Description", own: p.own.about, now: about) { about = p.own.about } content: {
                TextField(p.hasTags ? "A few lines about the piece, shown on its page." : "The piece in the house's words. A blank line starts a new paragraph.",
                          text: limited($about, 4000), axis: .vertical)
                    .labelsHidden()
                    .lineLimit(3...10)
            }
            macTagFields(p)
        }
        Section {
            HStack {
                TextField("0.00", text: $weight).labelsHidden().monospacedDigit().multilineTextAlignment(.trailing)
                Text("g").foregroundStyle(.secondary)
            }
        } header: {
            Text("Weight")
        } footer: {
            Text(p.hasTags ? "Prices follow it; the site shows it on photos without one." : "For the photo and captions; the catalogue doesn't print weights.")
        }
        Section {
            Toggle("Hide from the website", isOn: $hidden)
        } footer: {
            Text("Off every page; its links go to the collection. Show it again any time.")
        }
    }

    @ViewBuilder
    private func macTagFields(_ p: WebsiteEditPiece) -> some View {
        if p.hasTags {
            ForEach(WebsiteWords.tags) { (t: WebsiteWords.Tag) in
                field(t.label, own: p.own.tag(t.key), now: tags.tag(t.key)) { tags.setTag(t.key, p.own.tag(t.key)) } content: {
                    TextField(t.label, text: tagBinding(t.key)).labelsHidden()
                }
            }
        } else {
            field("Details, one per line", own: p.own.facts.joined(separator: "\n"), now: factsLines.joined(separator: "\n")) {
                factsText = p.own.facts.joined(separator: "\n")
            } content: {
                TextField("Stone: Emerald\nSetting: Prong", text: $factsText, axis: .vertical).labelsHidden().lineLimit(2...8)
            }
        }
    }

    /// The photograph: re-make it (crop, the weight and the mark, the light, the AI), put the original back, the piece on the site,
    /// and the piece in a design window.
    @ViewBuilder
    private func macPhotoTab(_ p: WebsiteEditPiece) -> some View {
        Section {
            if let photo, photo.ready {
                WebsitePhotoEditRows(edit: photo, fields: photoFields(p), busy: busy != nil) { (op: String, params: [String: Any], label: String) in
                    Task { await runAI(photo, op, params, label) }
                }
                if let photoWarning {
                    Label(photoWarning, systemImage: "exclamationmark.triangle").foregroundStyle(Tone.owed.color)
                }
                Text(photo.changed(photoFields(p)) ? "The photo will be replaced when you save." : p.photoEdited ? "The website shows a photo made here." : "The website's photo, unchanged.")
                    .font(.callout)
                    .foregroundStyle(photo.changed(photoFields(p)) ? Color.primary : Color.secondary)
            } else {
                StockImage(imageUrl: p.image, name: p.words.name, key: p.id + (p.change?.at ?? ""))
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
                    .opacity(p.hidden ? 0.5 : 1)
                Text(p.photoEdited ? "The website shows a photo made here. The original is kept." : "The website's photo, unchanged.")
                    .font(.callout).foregroundStyle(.secondary)
                if let problem = photo?.problem {
                    Text(problem).font(.callout).foregroundStyle(Tone.problem.color)
                }
                Button { Task { await beginPhoto(p) } } label: {
                    Text(photo?.loading == true ? "Fetching the Photo…" : "Re-make the Photo…")
                }
                .disabled(photo?.loading == true || busy != nil)
                Text("Crop it, put the weight and the logo on, fix the light.").font(.caption).foregroundStyle(.secondary)
            }
            if original != nil || p.photoEdited {
                Button("Put the Original Photo Back…", role: .destructive) { confirm = .photo }
            }
            if let url = URL(string: p.url), !p.url.isEmpty {
                Button("Open on \(siteName)") { NSWorkspace.shared.open(url) }
            }
            if MarketingKit.has("/design", role: session.role), let openPlace {
                Button("Open in Design") { openPlace(Route(path: "/design?v=make&site=" + WebsiteNumber.query(p.id))) }
            }
        } header: {
            Text("The photograph")
        } footer: {
            Text(photoNote(p))
        }
    }

    /// The inspector's foot: what saving does, and the button that does it (⌘S is the same action in the menu bar).
    private func macFoot(_ p: WebsiteEditPiece) -> some View {
        VStack(spacing: 0) {
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text(anyChange(p) ? "It shows on \(siteName) within a minute." : "Nothing changed yet.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    if p.changed {
                        Button("Undo Every Change…", role: .destructive) { confirm = .all }
                            .buttonStyle(.plain)
                            .foregroundStyle(Tone.problem.color)
                    }
                    Spacer(minLength: 8)
                    Button { confirm = .save } label: { Text("Save to the Website") }
                        .buttonStyle(.borderedProminent)
                        .disabled(!macCanSave(p))
                        .help("Save to the Website (⌘S)")
                }
            }
            .padding(12)
        }
        // On the page's ground, like every foot (the inspector's own grey bar was a shade of its own).
        .background(Theme.ground)
    }

    // MARK: In a window of its own

    /// The photograph and its tools on the left; what the website says, the weight and hiding it on the right. Save to the Website
    /// is the Piece menu's ⌘S and the footer's button.
    private func macWindowPage(_ p: WebsiteEditPiece) -> some View {
        MacTwoPane(sideWidth: 480) {
            List {
                Group { photoSection(p) }.houseRows()
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
        } main: {
            List {
                Group {
                    if let said {
                        Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
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
                }
                .houseRows()
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
        }
        .navigationSubtitle(p.collection)
        .macRecordMenu(MacRecordMenu(title: "Piece", groups: [[macSaveAction(p)], [macUndoAction(p)]]))
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: macSaveAction(p))
                if p.changed { MacToolbarAction(action: macUndoAction(p)) }
            }
        }
        .actionBar(
            primary: .init("Save to \(siteName)", systemImage: "square.and.arrow.down", isBusy: busy != nil,
                           isDisabled: !anyChange(p) || name.trimmingCharacters(in: .whitespaces).isEmpty) { confirm = .save },
            summary: anyChange(p) ? "It shows on \(siteName) within a minute." : "Nothing changed yet.")
    }
}
#endif
