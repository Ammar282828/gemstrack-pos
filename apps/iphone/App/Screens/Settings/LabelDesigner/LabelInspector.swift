import SwiftUI
import ERPCore

/// Every property of the selected field (the Mac's right column; the iPhone's "Field" tab): its name, whether it is
/// hidden or locked, its place and size in dots and millimetres, and what its kind has: the text and its
/// placeholders, a QR's magnification and correction, a bar code's symbology, height and modules, a box's thickness
/// and rounding, a picture's dithering. With several fields selected a change reaches every one of the same kind as
/// the last picked; a field's place can be set for all.
struct LabelInspector: View {
    let model: LabelDesignerModel
    var requestDelete: () -> Void = {}
    var replacePicture: () -> Void = {}

    var body: some View {
        if let f = model.primary {
            Group {
                header(f)
                placeSection(f)
                switch f.type {
                case .text: textSections(f)
                case .qr: qrSection
                case .barcode: barcodeSection
                case .line, .box, .ellipse: shapeSection(f)
                case .image: imageSection(f)
                }
                turnSection(f)
                if !model.readOnly {
                    Section {
                        Button("Remove \(model.selection.count > 1 ? "\(model.selection.count) fields" : "field")", role: .destructive, action: requestDelete)
                    }
                }
            }
            .disabled(model.readOnly)
        } else {
            Section {
                Text("Click a field on the tag to change it, or add one from the Add menu.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var dpi: Int? { model.layout.dpi }

    private func bind<T>(_ key: String, _ fallback: T, _ get: @escaping (LabelLayoutField) -> T, _ set: @escaping (inout LabelLayoutField, T) -> Void) -> Binding<T> {
        model.binding(key, fallback: fallback, get: get, set: set)
    }

    // MARK: Name, flags, place

    private func header(_ f: LabelLayoutField) -> some View {
        Section {
            LabeledContent("Kind", value: Self.kindName(f))
            TextField("Name", text: bind("name", "", { $0.name ?? "" }, { $0.name = $1.isEmpty ? nil : $1 }))
            Toggle("Hidden (not printed)", isOn: bind("hidden", false, { $0.hidden }, { $0.hidden = $1 }))
            Toggle("Locked", isOn: bind("locked", false, { $0.locked }, { $0.locked = $1 }))
        } header: {
            Text(model.selection.count > 1 ? "\(model.selection.count) fields" : "Field").textCase(nil)
        }
    }

    static func kindName(_ f: LabelLayoutField) -> String {
        switch f.type {
        case .text: return (f.data ?? "").contains("{") ? "Variable text" : "Text"
        case .qr: return "QR code"
        case .barcode: return LabelFieldView.symbologyName(LabelGeometry.symbology(f))
        case .line: return "Line"
        case .box: return "Box"
        case .ellipse: return "Ellipse"
        case .image: return "Picture"
        }
    }

    private func placeSection(_ f: LabelLayoutField) -> some View {
        let box = model.boxOfPrimary()
        return Section {
            LabelDotRow(title: "X", dots: Binding(get: { f.x }, set: { model.setX($0) }), dpi: dpi)
            LabelDotRow(title: "Y", dots: Binding(get: { f.y }, set: { model.setY($0) }), dpi: dpi)
            if model.selection.count == 1, let box {
                LabelDotRow(title: "Width", dots: Binding(get: { Int(box.w.rounded()) }, set: { model.setBoxSize(w: max(1, $0)) }), dpi: dpi, range: 1...32000)
                LabelDotRow(title: "Height", dots: Binding(get: { Int(box.h.rounded()) }, set: { model.setBoxSize(h: max(1, $0)) }), dpi: dpi, range: 1...32000)
            }
        } header: {
            Text("Place and size").textCase(nil)
        } footer: {
            Text("From the tag’s top-left corner, in printer dots and millimetres.")
        }
    }

    private func turnSection(_ f: LabelLayoutField) -> some View {
        Section {
            switch f.type {
            case .text, .qr, .barcode:
                Picker("Rotation", selection: Binding(get: { f.rotation }, set: { new in model.rotateSelection(by: new - f.rotation) })) {
                    ForEach([0, 90, 180, 270], id: \.self) { (r: Int) in Text("\(r)°").tag(r) }
                }
                Button("Rotate 90°", systemImage: "rotate.right") { model.rotateSelection() }
            case .image:
                Toggle("Upside down (180°)", isOn: Binding(get: { f.rotation == 180 }, set: { _ in model.rotateSelection() }))
            case .line, .box, .ellipse:
                Button("Turn on its side", systemImage: "rotate.right") { model.rotateSelection() }
            }
        } header: { Text("Turn").textCase(nil) }
    }

    // MARK: Text

    @ViewBuilder
    private func textSections(_ f: LabelLayoutField) -> some View {
        let tags = model.layout.tagsPerLabel
        Section {
            TextField("Text", text: bind("data", "", { $0.data ?? "" }, { $0.data = $1 }), axis: .vertical)
                .lineLimit(1...8)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            placeholderMenu(tags: tags)
            Menu {
                ForEach(LabelPlaceholders.transforms, id: \.token) { (t: (token: String, help: String)) in
                    Button { addTransform(t.token) } label: { Text("\(t.token)  \(t.help)") }
                }
            } label: { Label("Change how a value reads", systemImage: "wand.and.stars") }
            DisclosureGroup("How placeholders work") {
                ForEach(LabelPlaceholders.help, id: \.self) { (line: String) in
                    Text(line).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Words").textCase(nil)
        } footer: {
            Text("{sku} is replaced by the piece’s SKU when the tag prints.")
        }
        Section {
            LabelNumberRow(title: "Font size", unit: "dots", value: bind("fs", 20, { $0.fontSize ?? 20 }, { $0.fontSize = max(1, $1) }), range: 4...600)
            Toggle("Wrap in a block", isOn: bind("block", false, { ($0.width ?? 0) >= 1 }, { $0.width = $1 ? 200 : nil }))
            if (f.width ?? 0) >= 1 {
                LabelNumberRow(title: "Block width", unit: "dots", value: bind("width", 200, { $0.width ?? 200 }, { $0.width = max(1, $1) }), range: 8...32000)
                LabelNumberRow(title: "Lines", unit: "lines, 0 by line breaks", value: bind("lines", 0, { $0.lines ?? 0 }, { $0.lines = $1 >= 1 ? $1 : nil }), range: 0...99)
                Picker("Align", selection: bind("align", "L", { $0.align ?? "L" }, { $0.align = $1 == "L" ? nil : $1 })) {
                    Text("Left").tag("L"); Text("Centre").tag("C"); Text("Right").tag("R")
                }
                .pickerStyle(.segmented)
            }
            LabelNumberRow(title: "Line spacing", unit: "dots", value: bind("spacing", 0, { $0.lineSpacing ?? 0 }, { $0.lineSpacing = $1 == 0 ? nil : $1 }), range: -50...200)
            Toggle("Bold", isOn: bind("bold", false, { $0.bold ?? false }, { $0.bold = $1 ? true : nil }))
        } header: { Text("Look").textCase(nil) }
    }

    /// Fields of the piece and the Tag CSV, the date and the counter, added to the end of the text (`_1`, `_2` for a double tag).
    private func placeholderMenu(tags: Int) -> some View {
        Menu {
            ForEach(1...max(1, tags), id: \.self) { (t: Int) in
                Menu(tags > 1 ? "Tag \(t): piece" : "Piece") {
                    ForEach(LabelLive.labelFields, id: \.key) { (f: LabelField) in
                        Button(f.label) { append(LabelPlaceholders.tokens(key: f.key, tags: tags)[t - 1]) }
                    }
                }
                Menu(tags > 1 ? "Tag \(t): Tag CSV columns" : "Tag CSV columns") {
                    ForEach(LabelCSV.baseHeaders, id: \.self) { (h: String) in
                        Button(h) { append(LabelPlaceholders.tokens(key: "csv:\(h)", tags: tags)[t - 1]) }
                    }
                }
            }
            Divider()
            ForEach(LabelPlaceholders.specials) { (c: LabelChip) in
                Button(c.label) { append(c.token) }
            }
        } label: { Label("Add a piece field", systemImage: "curlybraces") }
    }

    private func append(_ token: String) {
        guard let f = model.primary else { return }
        let next = LabelPlaceholders.appending(token, to: f.data ?? "")
        let ids = model.selection
        model.edit(key: "data-\(f.id)") { l in
            for i in l.fields.indices where ids.contains(l.fields[i].id) && [.text, .qr, .barcode].contains(l.fields[i].type) {
                l.fields[i].data = i < l.fields.count && l.fields[i].id == f.id ? next : LabelPlaceholders.appending(token, to: l.fields[i].data ?? "")
            }
        }
    }

    /// `|upper` and the like go inside the last `{…}` of the text.
    private func addTransform(_ t: String) {
        guard let f = model.primary, let text = f.data, let close = text.range(of: "}", options: .backwards) else { return }
        var next = text
        next.insert(contentsOf: t, at: close.lowerBound)
        model.edit(key: "data-\(f.id)") { l in
            if let i = l.fields.firstIndex(where: { $0.id == f.id }) { l.fields[i].data = next }
        }
    }

    // MARK: QR and bar codes

    private var qrSection: some View {
        Section {
            TextField("Data", text: bind("data", "", { $0.data ?? "" }, { $0.data = $1 }), axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            placeholderMenu(tags: model.layout.tagsPerLabel)
            LabelNumberRow(title: "Magnification", unit: "dots a module", value: bind("mag", 2, { LabelGeometry.qrMagnification($0) }, { $0.qrMagnification = min(10, max(1, $1)) }), range: 1...10)
            Picker("Error correction", selection: bind("ec", "M", { LabelGeometry.correction($0) }, { $0.errorCorrection = $1 })) {
                Text("Low (7%)").tag("L"); Text("Medium (15%)").tag("M"); Text("Quartile (25%)").tag("Q"); Text("High (30%)").tag("H")
            }
        } header: { Text("QR code").textCase(nil) }
    }

    private var barcodeSection: some View {
        let f = model.primary
        let sym = f.map(LabelGeometry.symbology) ?? "code128"
        return Section {
            TextField("Data", text: bind("data", "", { $0.data ?? "" }, { $0.data = $1 }), axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            placeholderMenu(tags: model.layout.tagsPerLabel)
            Picker("Symbology", selection: bind("sym", "code128", { LabelGeometry.symbology($0) }, { $0.symbology = $1 })) {
                ForEach(["code128", "code39", "ean13", "upca", "datamatrix", "pdf417"], id: \.self) { (s: String) in
                    Text(LabelFieldView.symbologyName(s)).tag(s)
                }
            }
            if sym != "datamatrix" {
                LabelNumberRow(title: sym == "pdf417" ? "Row height" : "Bar height", unit: "dots", value: bind("bh", 40, { LabelGeometry.barHeight($0) }, { $0.height = max(1, $1) }), range: 1...1000)
            }
            LabelNumberRow(title: "Module width", unit: "dots", value: bind("mw", 2, { LabelGeometry.moduleWidth($0) }, { $0.moduleWidth = min(10, max(1, $1)) }), range: 1...10)
            if LabelGeometry.isLinear(sym) {
                Toggle("Show the text under it", isOn: bind("st", false, { $0.showText ?? false }, { $0.showText = $1 }))
            }
        } header: { Text("Bar code").textCase(nil) } footer: {
            if sym == "code39" || sym == "ean13" || sym == "upca" || sym == "datamatrix" {
                Text("Drawn as a pattern here; the printer makes the real symbol.")
            }
        }
    }

    // MARK: Shapes and pictures

    @ViewBuilder
    private func shapeSection(_ f: LabelLayoutField) -> some View {
        Section {
            if f.type != .line {
                LabelNumberRow(title: "Thickness", unit: "dots", value: bind("th", 2, { $0.thickness ?? 2 }, { $0.thickness = max(1, $1) }), range: 1...200)
                Toggle("Filled", isOn: bind("fill", false, { $0.fill ?? false }, { $0.fill = $1 ? true : nil }))
            }
            if f.type == .box {
                LabelNumberRow(title: "Rounded corners", unit: "0 to 8", value: bind("rd", 0, { $0.rounding ?? 0 }, { $0.rounding = $1 == 0 ? nil : min(8, max(0, $1)) }), range: 0...8)
            }
            if f.type == .line {
                Text("A line is a solid bar: make it thin with its Height (or Width, on its side).").font(.footnote).foregroundStyle(.secondary)
            }
        } header: { Text(Self.kindName(f)).textCase(nil) }
    }

    @ViewBuilder
    private func imageSection(_ f: LabelLayoutField) -> some View {
        let hasSource = f.source != nil
        Section {
            Picker("Dithering", selection: Binding(
                get: { LabelBitmap.Dither(rawValue: f.dither ?? "") ?? .threshold },
                set: { redo(dither: $0, threshold: nil) })) {
                Text("Threshold").tag(LabelBitmap.Dither.threshold)
                Text("Atkinson").tag(LabelBitmap.Dither.atkinson)
                Text("Floyd–Steinberg").tag(LabelBitmap.Dither.floyd)
            }
            .disabled(!hasSource)
            VStack(alignment: .leading) {
                Text("Threshold \(Int((f.threshold ?? 0.5) * 100))%")
                Slider(value: Binding(get: { f.threshold ?? 0.5 }, set: { redo(dither: nil, threshold: $0) }), in: 0.05...0.95)
            }
            .disabled(!hasSource)
            Button("Choose another picture…", systemImage: "photo", action: replacePicture)
        } header: { Text("Picture").textCase(nil) } footer: {
            if !hasSource { Text("This picture came without its original, so its dots can be scaled but not dithered again. Choose another picture to change that.") }
        }
    }

    /// The picture made again from its kept original at its own size.
    private func redo(dither: LabelBitmap.Dither?, threshold: Double?) {
        guard let f = model.primary else { return }
        let d = dither ?? LabelBitmap.Dither(rawValue: f.dither ?? "") ?? .threshold
        let t = threshold ?? f.threshold ?? 0.5
        guard let out = LabelPicture.redone(f, dither: d, threshold: t) else { return }
        model.edit(key: "dither-\(f.id)") { l in
            if let i = l.fields.firstIndex(where: { $0.id == f.id }) { l.fields[i] = out }
        }
    }
}

// MARK: Rows

/// A whole number with a stepper.
struct LabelNumberRow: View {
    let title: String
    var unit: String?
    @Binding var value: Int
    var range: ClosedRange<Int> = 0...32000

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField("", value: $value, format: .number)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
                    .frame(minWidth: 40, maxWidth: 70)
                if let unit { Text(unit).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Stepper("", value: $value, in: range).labelsHidden()
            }
        }
    }
}

/// A distance in dots and in millimetres, each editable.
struct LabelDotRow: View {
    let title: String
    @Binding var dots: Int
    let dpi: Int?
    var range: ClosedRange<Int> = -2000...32000

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField("", value: $dots, format: .number)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
                    .frame(minWidth: 44, maxWidth: 64)
                Text("dots").font(.caption).foregroundStyle(.secondary)
                TextField("", value: mm, format: .number.precision(.fractionLength(0...1)))
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.decimalPad)
                    .frame(minWidth: 40, maxWidth: 56)
                Text("mm").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var mm: Binding<Double> {
        Binding(get: { LabelUnits.mm(dots: Double(dots), dpi: dpi) },
                set: { dots = min(range.upperBound, max(range.lowerBound, LabelUnits.dots(mm: $0, dpi: dpi))) })
    }
}
