import SwiftUI
import ERPCore

/// Send to karigar (the order page's Share section, the Workshop's Making details): an order's pieces to a karigar on
/// WhatsApp from the shop's line, through `/api/app/orders/send-to-karigar` (src/lib/karigar-message.ts is the one
/// builder of the words: the sheet asks the route for them with `preview`, so the slip, the web and this agree).
/// The photos go first, then the details: description, weight, wastage in grams, size, stones, the instructions and
/// the due date. Never a price, and the customer only by first name. Not a money op, so it is sent straight, not
/// through `/api/app/write`. "Share…" instead hands the photos and the same words to the system share sheet, for
/// sending from the owner's own WhatsApp.
struct SendToKarigarSheet: View {
    let order: Order
    var pieces: [Int]? = nil
    var karigarId: String? = nil
    var onSent: (Note) -> Void = { _ in }

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var chosen = ""
    @State private var ticked: Set<Int> = []
    @State private var phone = ""
    @State private var text = ""
    @State private var photoCount = 0
    @State private var busy = false
    @State private var preparingShare = false
    @State private var error: String?
    @State private var share: SendToKarigarShare?
    @State private var started = false

    private var karigars: [Karigar] { workshopLive(book.karigars.items) }
    private var karigar: Karigar? { karigars.first { $0.id == chosen } }
    private var onFile: String { karigar?.contact?.nilIfBlank ?? karigar?.altPhone?.nilIfBlank ?? "" }
    private var number: String { CustomerKit.whatsAppNumber(phone.isEmpty ? onFile : phone) }
    private var numberOK: Bool { number.count >= 11 && number.count <= 15 }
    private var indexes: [Int] { ticked.sorted() }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Picker("Karigar", selection: $chosen) {
                        Text("Pick a karigar").tag("")
                        ForEach(karigars) { Text($0.name).tag($0.id) }
                    }
                    if !chosen.isEmpty {
                        if onFile.isEmpty || !phone.isEmpty {
                            TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                                .keyboardType(.phonePad)
                                .fieldKind(.telephoneNumber)
                        } else {
                            LabeledContent("Number", value: onFile)
                        }
                    }
                } header: {
                    LedgerHeading(title: "Send to")
                } footer: {
                    if !chosen.isEmpty && onFile.isEmpty && phone.isEmpty {
                        Text("No number on file for \(karigar?.name ?? "him"). Add one here or on his profile.")
                    }
                }
                Section {
                    ForEach(order.items.indices, id: \.self) { i in
                        Toggle(isOn: Binding(get: { ticked.contains(i) }, set: { on in
                            if on { ticked.insert(i) } else { ticked.remove(i) }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(i + 1). " + pieceTitle(order.items[i]))
                                if order.items[i].karigarId == chosen && !chosen.isEmpty {
                                    Text("Assigned to him").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    LedgerHeading(title: "Pieces")
                } footer: {
                    if photoCount > 0 { Text("\(photoCount) reference photo\(photoCount == 1 ? "" : "s") go first. No prices are sent.") }
                    else { Text("No prices are sent.") }
                }
                if !text.isEmpty {
                    Section {
                        Text(text).font(.subheadline).textSelection(.enabled)
                    } header: {
                        LedgerHeading(title: "The message")
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error, title: "Not sent")
            .navigationTitle("Send to karigar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await prepareShare() } } label: {
                        if preparingShare { ProgressView() } else { Label("Share\u{2026}", systemImage: "square.and.arrow.up") }
                    }
                    .disabled(preparingShare || busy || indexes.isEmpty || text.isEmpty)
                }
            }
            .actionBar(primary: ActionBar.Action("Send on WhatsApp", systemImage: "paperplane", isBusy: busy,
                                                 isDisabled: chosen.isEmpty || indexes.isEmpty || !numberOK) {
                Task { await send() }
            })
            .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
        }
        .task { start() }
        .onChange(of: chosen) { _, _ in repick() }
        .task(id: PreviewKey(chosen: chosen, ticked: indexes)) { await loadPreview() }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #else
        .presentationDetents([.large])
        #endif
    }

    private struct PreviewKey: Hashable { let chosen: String; let ticked: [Int] }

    private func pieceTitle(_ item: OrderItem) -> String {
        let d = item.description.trimmingCharacters(in: .whitespacesAndNewlines)
        return d.isEmpty ? "Piece" : d
    }

    private func start() {
        guard !started else { return }
        started = true
        book.karigars.need()
        let first = karigarId ?? pieces?.first.flatMap { order.items.indices.contains($0) ? order.items[$0].karigarId : nil }
            ?? order.items.compactMap(\.karigarId).first { !$0.isEmpty } ?? ""
        chosen = first
        ticked = initialPieces(for: first)
    }

    /// The pieces asked for, else the ones he holds, else all.
    private func initialPieces(for id: String) -> Set<Int> {
        if let pieces, !pieces.isEmpty { return Set(pieces.filter { order.items.indices.contains($0) }) }
        let mine = order.items.indices.filter { !id.isEmpty && order.items[$0].karigarId == id }
        return Set(mine.isEmpty ? Array(order.items.indices) : mine)
    }

    private func repick() {
        guard started else { return }
        phone = ""
        if pieces == nil || pieces?.isEmpty == true { ticked = initialPieces(for: chosen) }
    }

    private func requestBody(preview: Bool) -> [String: Any] {
        var b: [String: Any] = ["orderId": order.id, "pieceIndexes": indexes]
        if !chosen.isEmpty { b["karigarId"] = chosen }
        if !phone.trimmingCharacters(in: .whitespaces).isEmpty { b["phone"] = phone.trimmingCharacters(in: .whitespaces) }
        if preview { b["preview"] = true }
        return b
    }

    private func loadPreview() async {
        guard !chosen.isEmpty, !indexes.isEmpty else { text = ""; photoCount = 0; return }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        guard let out = try? await ERPAPI.shared.send("/api/app/orders/send-to-karigar", requestBody(preview: true)) else { return }
        guard !Task.isCancelled else { return }
        let first = (out["messages"] as? [[String: Any]])?.first
        text = out["message"] as? String ?? ""
        photoCount = first?["photos"] as? Int ?? 0
    }

    private func send() async {
        busy = true
        defer { busy = false }
        do {
            let out = try await ERPAPI.shared.send("/api/app/orders/send-to-karigar", requestBody(preview: false), timeout: 180)
            let sent = out["sent"] as? Int ?? 0
            let to = out["to"] as? String ?? ""
            var detail = "\(sent) message\(sent == 1 ? "" : "s") to \(to)"
            if let failed = out["photosFailed"] as? Int, failed > 0 { detail += " · \(failed) photo\(failed == 1 ? "" : "s") did not go" }
            onSent(Note(title: "Sent to \(karigar?.name ?? "the karigar")", detail: detail))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The pieces' photos as files, and the words: the system share sheet (the owner's own WhatsApp, AirDrop, Messages).
    private func prepareShare() async {
        preparingShare = true
        defer { preparingShare = false }
        var items: [Any] = []
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("karigar-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var n = 0
        for i in indexes {
            for source in order.items[i].photoSources {
                guard let image = await PieceGalleryStore.image(of: source, maxPixel: 1600),
                      let jpeg = image.jpegData(compressionQuality: 0.85) else { continue }
                n += 1
                let url = folder.appendingPathComponent("\(order.id)-piece\(i + 1)-\(n).jpg")
                if (try? jpeg.write(to: url)) != nil { items.append(url) }
            }
        }
        items.append(text)
        share = SendToKarigarShare(items: items)
    }
}

/// An order's piece asked to be sent (the Workshop's): the order as the shelf holds it, the piece, its karigar.
struct SendPieceAsk: Identifiable {
    let order: Order
    let index: Int
    let karigarId: String?
    var id: String { order.id + "#\(index)" }
}

struct SendToKarigarShare: Identifiable {
    let id = UUID()
    let items: [Any]
}

private extension String {
    var nilIfBlank: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
