import SwiftUI
import ERPCore

/// The print job for a few pieces' tags (the Mac's ⌘P, Stock's selection, a piece's tag sheet): which pieces, how many
/// copies of each, how many blank labels to pass over on a part-used roll, where a `{counter}` starts, what that makes
/// in labels, and where it goes (Settings → Labels → Printer). Print hands the job to `TagPrinter.print`, which
/// branches on this device's method (Label LIVE, or the shop's tag as ZPL straight to a Zebra).
struct TagPrintJobSheet: View {
    @State var pieces: [Product]
    /// Called after a print that went through, with the words it gave.
    var onPrinted: ((String) -> Void)?
    /// How the sheet closes when something other than SwiftUI presented it (the Mac's ⌘P opens it in a window sheet).
    var onClose: (() -> Void)?

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var copies = 1
    @State private var skip = 0
    @State private var useCounter = false
    @State private var counterStart = 1
    @State private var printing = false
    @State private var problem: String?
    @State private var note: Note?
    @State private var method = TagPrinter.method

    init(pieces: [Product], onPrinted: ((String) -> Void)? = nil, onClose: (() -> Void)? = nil) {
        _pieces = State(initialValue: pieces)
        self.onPrinted = onPrinted
        self.onClose = onClose
    }

    private func close() { if let onClose { onClose() } else { dismiss() } }

    private var layout: LabelLayout { book.settings.value?.labelLayout ?? LabelLayout.standard }
    private var usesCounter: Bool { layout.fields.contains { ($0.data ?? "").contains("{counter") } }
    private var zebra: Bool { method == .zebra }
    private var labels: Int { Zpl.labelCount(pieceCount: pieces.count, layout) }

    var body: some View {
        NavigationStack {
            Form { Group {
                piecesSection
                howManySection
                if zebra, let first = pieces.first { previewSection(first) }
                whereSection
            }
            .houseRows() }
            .houseForm()
            .navigationTitle(pieces.count == 1 ? "Print tag" : "Print \(pieces.count) tags")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { close() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(printing ? "Printing…" : "Print") { Task { await print() } }
                        .keyboardShortcut(.defaultAction)
                        .disabled(pieces.isEmpty || printing || book.settings.value == nil)
                }
            }
            .noteToast($note)
            .failureAlert($problem, title: "The tags weren't printed")
            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
            .interactiveDismissDisabled(printing)
            .task { book.settings.need(); method = TagPrinter.method }
        }
        .presentationDetents([.medium, .large])
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 520)
        #endif
    }

    // MARK: Which pieces

    private var piecesSection: some View {
        Section {
            ForEach(pieces) { p in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name.isEmpty ? p.sku : p.name).lineLimit(1)
                        if !p.name.isEmpty { Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button {
                        pieces.removeAll { $0.sku == p.sku }
                    } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove \(p.sku)")
                    .help("Leave this piece out")
                }
            }
            if pieces.isEmpty { Text("No pieces left to print.").foregroundStyle(.secondary) }
        } header: {
            LedgerHeading(title: "Pieces", count: pieces.count)
        }
    }

    // MARK: How many

    private var howManySection: some View {
        Section {
            Stepper(value: $copies, in: 1...(zebra ? 9999 : 99)) { LabeledContent("Copies of each", value: "\(copies)") }
            if zebra {
                Stepper(value: $skip, in: 0...999) { LabeledContent("Blank labels first", value: "\(skip)") }
                if usesCounter {
                    Toggle("Start the counter at a number", isOn: $useCounter)
                    if useCounter { Stepper(value: $counterStart, in: 0...999_999) { LabeledContent("Counter starts at", value: "\(counterStart)") } }
                }
            }
        } header: {
            LedgerHeading(title: "How many")
        } footer: {
            if zebra {
                let per = layout.tagsPerLabel
                Text("\(labels * copies) label\(labels * copies == 1 ? "" : "s")\(skip > 0 ? ", after \(skip) blank" : "")"
                     + (per > 1 ? ". \(per) tags to a label: pieces fill them in turn." : "."))
            } else {
                Text("Label LIVE counts the labels in its own design.")
            }
        }
    }

    // MARK: The first label

    private func previewSection(_ first: Product) -> some View {
        let settings = book.settings.value
        let group = Array(pieces.prefix(layout.tagsPerLabel))
        let values = settings.map { s in group.map { LabelLive.valuesFor($0, s) } } ?? []
        let fields = Zpl.resolveFields(layout, pieces: values, counterStart: useCounter && usesCounter ? counterStart : nil)
        return Section {
            TagStripPreview(layout: layout, fields: fields)
                .frame(maxWidth: .infinity)
                .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
        } header: {
            LedgerHeading(title: "First label")
        } footer: {
            Text("A rough picture: fonts and the barcode are the printer's.")
        }
    }

    // MARK: Where

    private var whereSection: some View {
        Section {
            LabeledContent("Print with", value: methodWords)
            NavigationLink(value: Route(path: TagPrinterSettingsScreen.path)) {
                Label("Printer settings", systemImage: "printer")
            }
        } header: {
            LedgerHeading(title: "Printer")
        }
    }

    private var methodWords: String {
        switch method {
        case .labelLive: return "Label LIVE"
        case .zebra:
            switch TagPrinter.route {
            case .browserPrint?: return "Zebra, by Browser Print"
            case .systemQueue(let name)?: return name
            case .network(let host, _)?: return host
            case nil: return "Zebra (not chosen yet)"
            }
        }
    }

    // MARK: Print

    private func print() async {
        guard !printing, !pieces.isEmpty, let settings = book.settings.value else { return }
        printing = true
        let job = TagPrinter.Job(copies: copies, skip: zebra ? skip : 0, counterStart: zebra && usesCounter && useCounter ? counterStart : nil)
        let outcome = await TagPrinter.print(pieces: pieces, settings: settings, job: job)
        printing = false
        if outcome.ok {
            onPrinted?(outcome.message)
            close()
        } else {
            problem = outcome.message
        }
    }
}

/// The tag drawn small: each field where the layout puts it, in the label's proportions. Texts as text, a QR or barcode
/// as a symbol; not the printer's fonts, only where things sit.
struct TagStripPreview: View {
    let layout: LabelLayout
    let fields: [LabelLayoutField]

    var body: some View {
        let w = CGFloat(max(1, layout.widthDots)), h = CGFloat(max(1, layout.heightDots))
        GeometryReader { geo in
            let k = geo.size.width / w
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6).fill(Color.white)
                RoundedRectangle(cornerRadius: 6).stroke(Color.gray.opacity(0.4))
                ForEach(fields.filter { !$0.hidden }, id: \.id) { f in
                    piece(f, k)
                }
            }
        }
        .aspectRatio(w / h, contentMode: .fit)
        .frame(maxWidth: 420)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Preview of the first tag")
    }

    @ViewBuilder
    private func piece(_ f: LabelLayoutField, _ k: CGFloat) -> some View {
        let x = CGFloat(f.x) * k, y = CGFloat(f.y) * k
        switch f.type {
        case .text:
            Text(f.data ?? "")
                .font(.system(size: max(5, CGFloat(f.fontSize ?? 20) * k), weight: f.bold == true ? .bold : .regular))
                .foregroundStyle(.black)
                .fixedSize()
                .rotationEffect(.degrees(Double(f.rotation)), anchor: .topLeading)
                .offset(x: x, y: y)
        case .qr:
            let side = CGFloat(max(1, f.qrMagnification ?? 4)) * 25 * k
            Image(systemName: "qrcode").resizable().scaledToFit().foregroundStyle(.black)
                .frame(width: side, height: side).offset(x: x, y: y)
        case .barcode:
            Image(systemName: "barcode").resizable().scaledToFit().foregroundStyle(.black)
                .frame(width: CGFloat(f.width ?? 200) * k, height: CGFloat(f.height ?? 60) * k).offset(x: x, y: y)
        case .box, .line, .ellipse, .image:
            EmptyView()
        }
    }
}
