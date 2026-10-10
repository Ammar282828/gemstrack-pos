import SwiftUI
import ERPCore

/// Stock › Labels (src/app/settings/printer/page.tsx; its address is still under Settings): the shop's tag, drawn
/// and edited field by field, and a piece's tag as the CSV a label app like WEPrint imports. Nothing here talks
/// to a printer: the layout is the shop's (settings `labelLayout`, the same on every device) and the CSV goes out
/// through the share sheet, to Files or straight to the printing app.
///
/// - The layout is read live from the settings document and saved a second after the last change, as the page
///   saves it (/api/app/write `saveLabelLayout`, lib/writes/label-layout.ts). One being edited is never replaced
///   by the copy arriving from another device until it has been saved.
/// - With none saved the standard tag is shown, the ERP's own (/api/app/labels), and "Back to the standard tag"
///   puts it back.
/// - The CSV is the ERP's (/api/app/labels, lib/label-csv.ts): the page's columns, at today's rates.
/// The page keeps a list of the pieces it exported on that computer; nothing reads it, so the phone keeps none.
struct LabelSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Labels") { LabelDesigner() }
    }
}

/// Settings → WEPrint (src/app/settings/weprint-api): switched off on the web (its live feed's endpoint never
/// existed), kept so an old bookmark lands somewhere, and saying the same here.
struct WeprintSettings: View {
    var body: some View {
        Form { Group {
            Section {
                Label("WEPrint", systemImage: "printer").font(.headline)
                Text("The live feed to WEPrint isn’t set up, so this page is switched off.")
                Text("Export the pieces as CSV from Labels and import that file into WEPrint instead.")
                    .foregroundStyle(.secondary)
                NavigationLink(value: Route(path: "/settings/printer")) { Label("Open Labels", systemImage: "tag") }
            }
            }
            .houseRows()
        }
        .navigationTitle("WEPrint")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: The tag

/// One field on the tag (lib/label-layout.ts `LabelField`): a text, or the QR code, in the printer's dots.
struct SettingsLabelField: Decodable, Identifiable, Hashable {
    var id: String
    /// "text" or "qr".
    var type: String
    var x: Int
    var y: Int
    /// 0, 90, 180 or 270.
    var rotation: Int
    var data: String
    var fontSize: Int?
    var qrMagnification: Int?
    var fontFamily: String?

    private enum K: String, CodingKey { case id, type, x, y, rotation, data, fontSize, qrMagnification, fontFamily }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        type = c.string(.type) == "qr" ? "qr" : "text"
        x = c.int(.x) ?? 0
        y = c.int(.y) ?? 0
        rotation = c.int(.rotation) ?? 0
        data = c.string(.data, default: "")
        fontSize = c.int(.fontSize)
        qrMagnification = c.int(.qrMagnification)
        fontFamily = c.string(.fontFamily)
    }

    /// The page's "Add Text Field".
    init(newAt now: Date = Date()) {
        id = "field-\(Int(now.timeIntervalSince1970 * 1000))"
        type = "text"
        x = 10
        y = 10
        rotation = 0
        data = "New Text"
        fontSize = 20
    }

    /// As the ERP stores it: a rotation of 0 and an unset size are left out, as the page leaves them.
    var stored: [String: Any] {
        var d: [String: Any] = ["id": id, "type": type, "x": x, "y": y, "data": data]
        if rotation != 0 { d["rotation"] = rotation }
        if let fontSize { d["fontSize"] = fontSize }
        if let qrMagnification { d["qrMagnification"] = qrMagnification }
        if let fontFamily { d["fontFamily"] = fontFamily }
        return d
    }
}

/// The tag (lib/label-layout.ts `StoredLabelLayout`): its size in dots and its fields.
struct SettingsLabelLayout: Decodable, Hashable {
    var id: String
    var name: String
    var widthDots: Int
    var heightDots: Int
    var fields: [SettingsLabelField]

    private enum K: String, CodingKey { case id, name, widthDots, heightDots, fields }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        name = c.string(.name, default: "")
        widthDots = c.int(.widthDots) ?? 0
        heightDots = c.int(.heightDots) ?? 0
        fields = c.list(.fields, of: SettingsLabelField.self).filter { !$0.id.isEmpty }
    }

    var stored: [String: Any] {
        ["id": id, "name": name, "widthDots": widthDots, "heightDots": heightDots, "fields": fields.map(\.stored)]
    }
}

/// The one field of the settings document the designer reads.
private struct SettingsLabelDoc: Decodable {
    let labelLayout: SettingsLabelLayout?
    private enum K: String, CodingKey { case labelLayout }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        labelLayout = c.object(.labelLayout, of: SettingsLabelLayout.self).flatMap { $0.widthDots > 0 && $0.heightDots > 0 ? $0 : nil }
    }
}

/// /api/app/labels: the standard tag.
private struct SettingsLabelStandard: Decodable {
    let standard: SettingsLabelLayout?
    private enum K: String, CodingKey { case standard }
    init(from decoder: Decoder) throws {
        standard = try decoder.container(keyedBy: K.self).object(.standard, of: SettingsLabelLayout.self)
    }
}

// MARK: The designer

private struct LabelDesigner: View {
    @Environment(Book.self) private var book
    @State private var doc = Single<SettingsLabelDoc>(Collections.settings, Collections.globalSettingsDoc)
    @State private var standard: SettingsLabelLayout?
    @State private var layout: SettingsLabelLayout?
    /// Changed here and not yet saved: the copy from the books does not replace it.
    @State private var edited = false
    @State private var saving = false
    @State private var note: OwnerNote?
    @State private var failure: String?

    @State private var search = ""
    @State private var picked: Product?
    @State private var making = false
    @State private var csv: URL?

    private var saved: SettingsLabelLayout? { doc.value?.labelLayout }

    var body: some View {
        Group {
            if let layout {
                form(layout)
            } else if let failure, standard == nil, doc.loaded, saved == nil {
                ContentUnavailableView("Couldn't load the tag", systemImage: "tag", description: Text(failure))
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Labels")
        .navigationBarTitleDisplayMode(.inline)
        .ownerNote($note)
        .onAppear {
            doc.need()
            book.products.need()
        }
        .onDisappear { doc.reset() }
        .task { await loadStandard() }
        // Adopt the saved layout when it arrives (or changes on another device) unless one is being edited.
        .onChange(of: saved) { _, next in adopt(next) }
        .onChange(of: doc.loaded) { _, _ in adopt(saved) }
        .onChange(of: standard) { _, _ in adopt(saved) }
        // Saved a second after the last change.
        .task(id: layout) {
            guard edited, let layout else { return }
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            await save(layout)
        }
    }

    private func adopt(_ next: SettingsLabelLayout?) {
        guard !edited, doc.loaded else { return }
        if let next { layout = next } else if let standard { layout = standard }
    }

    private func loadStandard() async {
        do {
            standard = try await ERPAPI.shared.get("/api/app/labels", as: SettingsLabelStandard.self).standard
            adopt(saved)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func save(_ next: SettingsLabelLayout) async {
        saving = true
        do {
            // `seq` makes each save its own: a field moved and moved back is a new change, not one sent twice.
            try await ERPAPI.shared.write("saveLabelLayout", ["layout": next.stored, "seq": UUID().uuidString])
            if layout == next { edited = false }
        } catch {
            withAnimation { note = OwnerNote(title: "Layout not saved", detail: "Check the connection; it will try again on the next change. \(error.localizedDescription)") }
        }
        saving = false
    }

    /// A change from the editor: drawn at once, saved a second later.
    private func change(_ edit: (inout SettingsLabelLayout) -> Void) {
        guard var next = layout else { return }
        edit(&next)
        edited = true
        layout = next
    }

    // MARK: The page

    private func form(_ l: SettingsLabelLayout) -> some View {
        Form { Group {
            Section {
                SettingsTagPreview(layout: l)
                    .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                if saved != nil, let standard {
                    Button("Back to the standard tag") { change { $0 = standard } }
                }
            } header: {
                LedgerHeading(title: "Tag builder")
            } footer: {
                Text("Design the tag and export pieces to CSV for a label printing app like WEPrint. \(edited || saving ? "Saving…" : saved != nil ? "Layout saved." : "")")
            }

            exportSection

            ForEach(l.fields) { (f: SettingsLabelField) in
                fieldSection(f)
            }

            Section {
                Button { change { $0.fields.append(SettingsLabelField()) } } label: {
                    Label("Add Text Field", systemImage: "plus.circle")
                }
            } footer: {
                Text("\(l.name) · \(l.widthDots) × \(l.heightDots) dots")
            }
            }
            .houseRows()
        }
    }

    // MARK: Test & Export

    private var hits: [Product] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(book.products.items.lazy.filter { $0.name.lowercased().contains(q) || $0.sku.lowercased().contains(q) }.prefix(50))
    }

    private var exportSection: some View {
        Section {
            if let p = picked {
                LabeledContent(p.name, value: p.sku)
                Button("Choose another piece") {
                    picked = nil
                    csv = nil
                }
            } else {
                TextField("Search by name or SKU...", text: $search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                    if !book.products.loaded {
                        SkeletonLoading()
                    } else if hits.isEmpty {
                        Text("No products found.").foregroundStyle(.secondary)
                    }
                    ForEach(hits) { (p: Product) in
                        Button {
                            picked = p
                            search = ""
                            csv = nil
                        } label: {
                            TwoLine(title: p.name, subtitle: p.sku).foregroundStyle(.primary)
                        }
                    }
                }
            }
            Button { Task { await makeCsv() } } label: {
                HStack(spacing: 8) {
                    if making { SkeletonLoading() }
                    Label("Download CSV for Selected Product", systemImage: "arrow.down.doc")
                }
            }
            .disabled(picked == nil || making)
            if let csv {
                ShareLink(item: csv) {
                    Label("Save or send \(csv.lastPathComponent)", systemImage: "square.and.arrow.up")
                }
            }
        } header: {
            LedgerHeading(title: "Test & Export")
        } footer: {
            Text("Select a product to preview and export its data.")
        }
    }

    private func makeCsv() async {
        guard let p = picked else { return }
        making = true
        do {
            let data = try await ERPAPI.shared.data("/api/app/labels", method: "POST", json: ["sku": p.sku])
            // The page's file name: gemstrack_double_tag_export_<UTC time>.csv
            let stamp = String(ERPDate.iso(Date()).prefix(19)).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "T", with: "-")
            csv = try SettingsFiles.save(data, named: "gemstrack_double_tag_export_\(stamp).csv")
            withAnimation { note = OwnerNote(title: "CSV Exported", detail: "Product details for \(p.sku) exported.") }
        } catch {
            withAnimation { note = OwnerNote(title: "CSV not made", detail: error.localizedDescription) }
        }
        making = false
    }

    // MARK: Field Editor

    /// Fields are found by their id at the moment of the change, never by a position a removal has moved.
    private func current(_ id: String) -> SettingsLabelField? { layout?.fields.first { $0.id == id } }

    private func edit(_ id: String, _ apply: @escaping (inout SettingsLabelField) -> Void) {
        change { l in
            if let j = l.fields.firstIndex(where: { $0.id == id }) { apply(&l.fields[j]) }
        }
    }

    private func fieldSection(_ f: SettingsLabelField) -> some View {
        let id = f.id
        return Section {
            LabeledContent("X") { number(\.x, of: id) }
            LabeledContent("Y") { number(\.y, of: id) }
            LabeledContent("Data") {
                TextField("Data", text: Binding(get: { current(id)?.data ?? "" }, set: { v in edit(id) { $0.data = v } }))
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            LabeledContent("Font Size") {
                // The page's `parseInt(value) || 20`.
                TextField("20", text: Binding(
                    get: { String(current(id)?.fontSize ?? 20) },
                    set: { v in edit(id) { $0.fontSize = Int(String(v.filter(\.isNumber))).flatMap { $0 > 0 ? $0 : nil } ?? 20 } }
                ))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
            }
            Picker("Rotation", selection: Binding(get: { current(id)?.rotation ?? 0 }, set: { v in edit(id) { $0.rotation = v } })) {
                ForEach([0, 90, 180, 270], id: \.self) { (r: Int) in Text("\(r)°").tag(r) }
            }
            Button("Remove field", role: .destructive) {
                change { l in l.fields.removeAll { $0.id == id } }
            }
        } header: {
            Text(id).textCase(nil)
        }
    }

    /// A whole number of dots, as the page's number box reads one (`parseInt(value) || 0`).
    private func number(_ key: WritableKeyPath<SettingsLabelField, Int>, of id: String) -> some View {
        TextField("0", text: Binding(
            get: { current(id).map { String($0[keyPath: key]) } ?? "" },
            set: { v in
                let digits = String(v.filter { $0.isNumber || $0 == "-" })
                edit(id) { $0[keyPath: key] = Int(digits) ?? 0 }
            }
        ))
        .keyboardType(.numbersAndPunctuation)
        .multilineTextAlignment(.trailing)
    }
}

// MARK: The preview

/// The tag as the page's builder draws it: the dumbbell tag's two heads and the strip between them, and each
/// field where its dots put it, turned as it prints. The text shows as written ("SKU: {sku}"); the QR as a mark.
struct SettingsTagPreview: View {
    let layout: SettingsLabelLayout

    var body: some View {
        let w = CGFloat(max(layout.widthDots, 1))
        let h = CGFloat(max(layout.heightDots, 1))
        GeometryReader { geo in
            let s = geo.size.width / w
            ZStack(alignment: .topLeading) {
                outline(w: w, h: h, s: s)
                ForEach(layout.fields) { (f: SettingsLabelField) in
                    field(f, s: s)
                        .rotationEffect(.degrees(Double(f.rotation)), anchor: .topLeading)
                        .offset(x: CGFloat(f.x) * s, y: CGFloat(f.y) * s)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .aspectRatio(w / h, contentMode: .fit)
        .clipped()
        .background(Theme.card)
        .accessibilityLabel("Tag preview")
    }

    /// The Zebra tag's shape: heads 240 dots wide on an 83 mm tag, the strip 64 dots tall on a 37 mm one,
    /// stretched to the layout's size as the page's outline is.
    @ViewBuilder
    private func outline(w: CGFloat, h: CGFloat, s: CGFloat) -> some View {
        let head = w * 240 / 664
        let strip = h * 64 / 296
        let shade = Theme.accent.opacity(0.07)
        let edge = Theme.accent.opacity(0.3)
        Rectangle().fill(shade)
            .overlay(Rectangle().strokeBorder(edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
            .frame(width: head * s, height: h * s)
        Rectangle().fill(shade)
            .overlay(Rectangle().strokeBorder(edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
            .frame(width: head * s, height: h * s)
            .offset(x: (w - head) * s)
        Rectangle().fill(shade)
            .frame(width: max(0, w - 2 * head) * s, height: strip * s)
            .offset(x: head * s, y: (h - strip) / 2 * s)
    }

    @ViewBuilder
    private func field(_ f: SettingsLabelField, s: CGFloat) -> some View {
        if f.type == "qr" {
            Image(systemName: "qrcode")
                .font(.system(size: 22))
                .padding(2)
                .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Color.purple.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
        } else {
            Text(f.data)
                .font(.system(size: max(4, CGFloat(f.fontSize ?? 20) * s)))
                .lineLimit(1)
                .fixedSize()
                .padding(2)
                .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Color.blue.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
        }
    }
}
