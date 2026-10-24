import SwiftUI
import ERPCore
#if os(macOS)
import AppKit
#endif

// The designer's side panels: the Add menu, the layers list, the label's own settings, and the preview piece.

// MARK: Add

/// Text, variable text, QR, bar codes, shapes, a picture, the date and a counter.
struct LabelAddMenu: View {
    let model: LabelDesignerModel
    var addPicture: () -> Void
    var addCounter: () -> Void

    var body: some View {
        let tags = model.layout.tagsPerLabel
        Menu {
            Button("Text", systemImage: "textformat") { model.add(.text) }
            Menu("Variable text", systemImage: "curlybraces") {
                ForEach(1...max(1, tags), id: \.self) { (t: Int) in
                    Menu(tags > 1 ? "Tag \(t): piece" : "Piece") {
                        ForEach(LabelLive.labelFields, id: \.key) { (f: LabelField) in
                            Button(f.label) { model.add(.variable(LabelPlaceholders.tokens(key: f.key, tags: tags)[t - 1])) }
                        }
                    }
                    Menu(tags > 1 ? "Tag \(t): Tag CSV columns" : "Tag CSV columns") {
                        ForEach(LabelCSV.baseHeaders, id: \.self) { (h: String) in
                            Button(h) { model.add(.variable(LabelPlaceholders.tokens(key: "csv:\(h)", tags: tags)[t - 1])) }
                        }
                    }
                }
            }
            Button("QR code", systemImage: "qrcode") { model.add(.qr) }
            Menu("Bar code", systemImage: "barcode") {
                ForEach(["code128", "code39", "ean13", "upca", "datamatrix", "pdf417"], id: \.self) { (s: String) in
                    Button(LabelFieldView.symbologyName(s)) { model.add(.barcode(s)) }
                }
            }
            Divider()
            Button("Line", systemImage: "minus") { model.add(.line) }
            Button("Box", systemImage: "square") { model.add(.box) }
            Button("Ellipse", systemImage: "circle") { model.add(.ellipse) }
            Button("Picture…", systemImage: "photo", action: addPicture)
            Divider()
            Menu("Date and time", systemImage: "calendar") {
                Button("24 Oct 2026  (d MMM yyyy)") { model.add(.date("d MMM yyyy")) }
                Button("24/10/2026  (dd/MM/yyyy)") { model.add(.date("dd/MM/yyyy")) }
                Button("Oct 2026  (MMM yyyy)") { model.add(.date("MMM yyyy")) }
                Button("10/26  (MM/yy)") { model.add(.date("MM/yy")) }
                Button("Time  (HH:mm)") { model.add(.variable("{time}")) }
            }
            Button("Counter…", systemImage: "number", action: addCounter)
        } label: {
            Label("Add", systemImage: "plus")
        }
        .disabled(model.readOnly)
        .help("Add a field to the tag")
    }
}

/// `{counter:START:STEP:PAD}`: where it starts, how much it goes up by a label, and how many digits it fills.
struct LabelCounterSheet: View {
    let onAdd: (Int, Int, Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var start = 1
    @State private var step = 1
    @State private var pad = 4

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Stepper("Starts at \(start)", value: $start, in: -999_999...999_999)
                    Stepper("Goes up by \(step) a label", value: $step, in: -99...99)
                    Stepper("Fills \(pad) digits", value: $pad, in: 0...12)
                } footer: {
                    Text("Prints as \(sample(0)), \(sample(1)), \(sample(2))…")
                }
            }
            .houseRows() }
            .houseForm()
            .navigationTitle("Counter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { onAdd(start, step, pad); dismiss() }
                }
            }
        }
        .macSheetSize(minWidth: 420, minHeight: 300)
        .presentationDetents([.medium])
    }

    private func sample(_ i: Int) -> String {
        Zpl.resolveText("{counter:\(start):\(step):\(pad)}", pieces: [], labelIndex: i)
    }
}

// MARK: Layers

/// The fields top first: select, hide, lock, and drag to reorder. A tap on a row selects it (⇧-click on the Mac, or
/// "Select several" on the iPhone, adds to the selection).
struct LabelLayersList: View {
    let model: LabelDesignerModel

    var body: some View {
        let fields = Array(model.layout.fields.reversed())
        List {
            ForEach(fields, id: \.id) { (f: LabelLayoutField) in
                row(f)
                    .listRowBackground(model.selection.contains(f.id) ? Theme.accent.opacity(0.18) : Theme.card)
                    .contextMenu {
                        Button(f.hidden ? "Show" : "Hide", systemImage: f.hidden ? "eye" : "eye.slash") { model.setHidden(f.id, !f.hidden) }
                        Button(f.locked ? "Unlock" : "Lock", systemImage: f.locked ? "lock.open" : "lock") { model.setLocked(f.id, !f.locked) }
                        Button("Duplicate", systemImage: "plus.square.on.square") { model.select([f.id]); model.duplicateSelection() }
                    }
            }
            .onMove { from, to in model.moveLayers(from: from, to: to) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        #if !os(macOS)
        // Drag handles on the phone's list need edit mode.
        .environment(\.editMode, Binding<EditMode>.constant(model.readOnly ? EditMode.inactive : EditMode.active))
        #endif
        .overlay {
            if fields.isEmpty {
                Text("No fields yet.").foregroundStyle(.secondary)
            }
        }
    }

    private func row(_ f: LabelLayoutField) -> some View {
        HStack(spacing: 8) {
            Image(systemName: Self.symbol(f.type)).frame(width: 22).foregroundStyle(.secondary)
            Text(Self.title(f)).lineLimit(1).opacity(f.hidden ? 0.5 : 1)
            Spacer(minLength: 4)
            Button { model.setHidden(f.id, !f.hidden) } label: { Image(systemName: f.hidden ? "eye.slash" : "eye") }
                .buttonStyle(.borderless)
                .accessibilityLabel(f.hidden ? "Show" : "Hide")
                .help(f.hidden ? "Show on the tag" : "Hide (not printed)")
            Button { model.setLocked(f.id, !f.locked) } label: { Image(systemName: f.locked ? "lock.fill" : "lock.open") }
                .buttonStyle(.borderless)
                .foregroundStyle(f.locked ? Color.orange : Color.secondary)
                .accessibilityLabel(f.locked ? "Unlock" : "Lock")
                .help(f.locked ? "Unlock" : "Lock in place")
        }
        .contentShape(Rectangle())
        .onTapGesture {
            #if os(macOS)
            let add = NSEvent.modifierFlags.contains(.shift) || NSEvent.modifierFlags.contains(.command)
            #else
            let add = model.multiSelect
            #endif
            if add { model.toggleSelected(f.id) } else { model.select([f.id]) }
        }
    }

    static func symbol(_ t: LabelFieldType) -> String {
        switch t {
        case .text: return "textformat"
        case .qr: return "qrcode"
        case .barcode: return "barcode"
        case .line: return "minus"
        case .box: return "square"
        case .ellipse: return "circle"
        case .image: return "photo"
        }
    }

    static func title(_ f: LabelLayoutField) -> String {
        if let n = f.name, !n.isEmpty { return n }
        switch f.type {
        case .text, .qr, .barcode:
            let d = (f.data ?? "").replacingOccurrences(of: "\n", with: " ")
            return d.isEmpty ? LabelInspector.kindName(f) : d
        default: return LabelInspector.kindName(f)
        }
    }
}

// MARK: The label itself

/// The tag's name and size (millimetres and dots), its dpi, how many pieces share a label, and the way to the
/// printer's settings. The same on every device (`labelLayout`).
struct LabelSettingsSections: View {
    let model: LabelDesignerModel

    var body: some View {
        let l = model.layout
        Section {
            TextField("Name", text: Binding(get: { l.name }, set: { v in model.edit(key: "label-name") { $0.name = v } }))
            LabelDotRow(title: "Width", dots: Binding(get: { l.widthDots }, set: { v in model.edit(key: "label-w") { $0.widthDots = max(8, v) } }),
                        dpi: l.dpi, range: 8...8000)
            LabelDotRow(title: "Height", dots: Binding(get: { l.heightDots }, set: { v in model.edit(key: "label-h") { $0.heightDots = max(8, v) } }),
                        dpi: l.dpi, range: 8...8000)
            Picker("Print quality", selection: Binding(get: { l.dpi ?? 203 }, set: { v in model.edit { $0.dpi = v == 203 ? nil : v } })) {
                ForEach(LabelUnits.dpiChoices, id: \.self) { (d: Int) in Text("\(d) dpi").tag(d) }
            }
            Picker("Tags to a label", selection: Binding(get: { l.tagsPerLabel }, set: { v in model.edit { $0.tags = v <= 1 ? nil : v } })) {
                Text("One tag").tag(1)
                Text("Two tags (double tag)").tag(2)
                if l.tagsPerLabel > 2 { Text("\(l.tagsPerLabel) tags").tag(l.tagsPerLabel) }
            }
        } header: {
            LedgerHeading(title: "The tag")
        } footer: {
            Text("\(l.widthDots) × \(l.heightDots) dots. A double tag takes two pieces to a label: {sku_1} and {sku_2}. Changing the dpi does not move the fields; set the size in millimetres again.")
        }
        .disabled(model.readOnly)

        Section {
            NavigationLink(value: Route(path: TagPrinterSettingsScreen.path)) {
                Label("Printer settings", systemImage: "printer")
            }
            NavigationLink(value: Route(path: LabelLiveSettingsScreen.path)) {
                Label("Label LIVE", systemImage: "printer.dotmatrix")
            }
        } footer: {
            Text("Print tags straight to a Zebra, or through Label LIVE on the Mac at the counter.")
        }
    }
}

// MARK: The preview piece

/// Which pieces the canvas is filled from, the date and the counter it shows. With none chosen it shows made-up values.
struct LabelPreviewSections: View {
    let model: LabelDesignerModel
    @Environment(Book.self) private var book
    @State private var search = ""

    private var hits: [Product] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(book.products.items.lazy.filter { $0.name.lowercased().contains(q) || $0.sku.lowercased().contains(q) }.prefix(20))
    }

    var body: some View {
        let tags = model.layout.tagsPerLabel
        Section {
            ForEach(0..<tags, id: \.self) { (i: Int) in
                LabeledContent(tags > 1 ? "Tag \(i + 1)" : "Piece") {
                    if i < model.previewProducts.count {
                        Text(model.previewProducts[i].sku).lineLimit(1)
                    } else {
                        Text("Sample").foregroundStyle(.secondary)
                    }
                }
            }
            if !model.previewProducts.isEmpty {
                Button("Use made-up values") { model.setPreview([], settings: nil) }
            }
            TextField("Search by name or SKU", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                if !book.products.loaded { SkeletonLoading() }
                else if hits.isEmpty { Text("No pieces found.").foregroundStyle(.secondary) }
                ForEach(hits) { (p: Product) in
                    Button {
                        var chosen = model.previewProducts
                        if chosen.count >= tags { chosen.removeLast() }
                        chosen.append(p)
                        model.setPreview(chosen, settings: book.settings.value)
                        search = ""
                    } label: {
                        TwoLine(title: p.name, subtitle: p.sku).foregroundStyle(.primary)
                    }
                }
            }
        } header: {
            LedgerHeading(title: "Preview with")
        } footer: {
            Text(tags > 1 ? "Pick up to \(tags) pieces, one for each tag." : "Pick a piece to see its own words on the tag.")
        }
        Section {
            DatePicker("Date and time", selection: Binding(get: { model.previewNow }, set: { model.previewNow = $0 }))
            Stepper(value: Binding(get: { model.previewCounter ?? 1 }, set: { model.previewCounter = $0 }), in: -999_999...999_999) {
                LabeledContent("Counter starts at", value: String(model.previewCounter ?? 1))
            }
        } header: {
            LedgerHeading(title: "Date and counter")
        }
        .onAppear { book.products.need(); book.settings.need() }
    }
}

// MARK: Export to CSV (the screen's older part)

/// A piece's tag as the CSV a label app like WEPrint imports (/api/app/labels).
struct LabelCsvSection: View {
    @Environment(Book.self) private var book
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var picked: Product?
    @State private var search = ""
    @State private var making = false
    @State private var csv: URL?
    @State private var note: Note?
    @State private var problem: String?

    private var hits: [Product] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(book.products.items.lazy.filter { $0.name.lowercased().contains(q) || $0.sku.lowercased().contains(q) }.prefix(50))
    }

    var body: some View {
        Section {
            if let p = picked {
                LabeledContent(p.name, value: p.sku)
                Button("Choose another piece") { picked = nil; csv = nil }
            } else {
                TextField("Search by name or SKU", text: $search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                    if !book.products.loaded { SkeletonLoading() }
                    else if hits.isEmpty { Text("No pieces found.").foregroundStyle(.secondary) }
                    ForEach(hits) { (p: Product) in
                        Button { picked = p; search = ""; csv = nil } label: {
                            TwoLine(title: p.name, subtitle: p.sku).foregroundStyle(.primary)
                        }
                    }
                }
            }
            Button { Task { await makeCsv() } } label: {
                HStack(spacing: 8) {
                    if making { SkeletonLoading() }
                    Label("Download CSV for this piece", systemImage: "arrow.down.doc")
                }
            }
            .disabled(picked == nil || making)
            if let csv {
                ShareLink(item: csv) { Label("Save or send \(csv.lastPathComponent)", systemImage: "square.and.arrow.up") }
            }
        } header: {
            LedgerHeading(title: "Export to CSV")
        }
        .noteToast($note)
        .failureAlert($problem, title: "Not done")
        .onAppear { book.products.need() }
    }

    private func makeCsv() async {
        guard let p = picked else { return }
        making = true
        do {
            let data = try await ERPAPI.shared.data("/api/app/labels", method: "POST", json: ["sku": p.sku])
            // The page's file name: gemstrack_double_tag_export_<UTC time>.csv
            let stamp = String(ERPDate.iso(Date()).prefix(19)).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "T", with: "-")
            csv = try SettingsFiles.save(data, named: "gemstrack_double_tag_export_\(stamp).csv")
            Motion.run(reduce: reduce) { note = Note(title: "CSV exported", detail: "Product details for \(p.sku) exported.") }
        } catch {
            problem = "The CSV was not made. \(error.localizedDescription)"
        }
        making = false
    }
}
