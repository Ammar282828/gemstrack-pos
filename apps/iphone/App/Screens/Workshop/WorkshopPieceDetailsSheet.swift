import SwiftUI
import FirebaseFirestore
import ERPCore

// The Workshop's Details dialog for an order's piece or a sold piece (src/app/workshop/page.tsx EditDetailsDialog), a
// write through the ERP (`updateOrderPieceDetails`, `updateInvoicePieceDetails`, lib/writes/piece-details.ts). A stock
// job's own sheet is WorkshopJobDetailsSheet. Nothing here moves money: price, customer and quantity are not sent.

/// Making details asked for on an order's piece or a sold piece: the piece, where it is kept, and the order piece's
/// sample picture as the order holds it (a picture of its own, or one in `order_photos`).
struct WorkshopPieceAsk: Identifiable {
    enum Target { case order(id: String, index: Int), invoice(id: String, index: Int) }
    let job: WorkshopJob
    let target: Target
    var samplePhotoId: String?
    var sampleImageDataUri: String?
    var id: String { job.id }

    var isOrder: Bool {
        if case .order = target { return true }
        return false
    }
}

/// "Making details": only the fields the karigar sees. The name (never cleared; it prints on the customer's estimate and
/// invoice), the size and the instructions, and on an order's piece its weight, reference SKU and sample picture. A sold
/// piece's weight is what the bill was priced from, so it is shown and not changed.
struct WorkshopPieceDetailsSheet: View {
    let ask: WorkshopPieceAsk
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var size: String
    @State private var weightText: String
    @State private var reference: String
    @State private var instructions: String
    /// A new picture chosen here (JPEG, NewOrderPhotoCodec), sent only when there is one.
    @State private var photo: Data?
    /// The picture on file is to come off.
    @State private var removePhoto = false
    /// The picture on file, read from its document when the piece keeps it there.
    @State private var storedURI: String?
    @State private var photoProblem: String?
    @State private var saving = false
    @State private var error: String?
    @State private var savedTick = 0

    init(ask: WorkshopPieceAsk, onSaved: @escaping (Note) -> Void) {
        self.ask = ask
        self.onSaved = onSaved
        let job = ask.job
        _name = State(initialValue: job.description)
        _size = State(initialValue: job.size ?? "")
        _weightText = State(initialValue: WorkshopFigure.field(job.weightG))
        _reference = State(initialValue: job.referenceSku ?? "")
        // The board's line merges the stones, the diamonds and the owner's note; saved, they become the one note.
        _instructions = State(initialValue: job.notes ?? "")
        _storedURI = State(initialValue: (ask.sampleImageDataUri ?? "").isEmpty ? nil : ask.sampleImageDataUri)
    }

    private var cleanedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var hasStoredPhoto: Bool {
        !(ask.samplePhotoId ?? "").isEmpty || !(ask.sampleImageDataUri ?? "").isEmpty
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("What is being made", text: $name, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    LedgerHeading(title: "Item name")
                } footer: {
                    Text("Also prints on the customer's estimate and invoice. Only the fields the karigar sees; price, customer and quantity are not changed.")
                }
                Section {
                    LabeledContent("Size") {
                        TextField("e.g. 12", text: $size).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Weight (g)") {
                        TextField("0.000", text: $weightText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .disabled(!ask.isOrder)
                            .foregroundStyle(ask.isOrder ? Color.primary : Color.secondary)
                    }
                    if ask.isOrder {
                        LabeledContent("Ref SKU") {
                            TextField("Optional", text: $reference).multilineTextAlignment(.trailing)
                                .textInputAutocapitalization(.characters)
                        }
                    }
                } footer: {
                    if !ask.isOrder { Text("A sold piece keeps the weight its bill was priced from.") }
                }
                // Only an order's piece keeps a sample picture; a sold piece has none to show.
                if ask.isOrder {
                    Section {
                        samplePicture
                    } header: {
                        LedgerHeading(title: "Sample picture")
                    } footer: {
                        Text("Shown to the karigar on their work list.")
                    }
                }
                Section {
                    TextField("Stones, plating, sizing, or other specifications", text: $instructions, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    LedgerHeading(title: "Instructions")
                } footer: {
                    Text("Shown to the karigar and on the workshop slip. Never printed on a customer estimate or invoice: keep prices and customer details out of it.")
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error, title: "Not saved")
            .navigationTitle("Making details")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { Task { await save() } }
                        .disabled(saving || cleanedName.isEmpty)
                }
            }
        }
        .presentationSizing(.page)
        .interactiveDismissDisabled(saving)
        // A picture kept in its own document (lib/order-photos.ts) is read for the editor, as the web's dialog reads it.
        .task { await loadStoredPhoto() }
    }

    /// The picture on file while nothing new is chosen, its Remove, and Photos / Camera for a new one.
    @ViewBuilder
    private var samplePicture: some View {
        VStack(alignment: .leading, spacing: 12) {
            if photo == nil && !removePhoto && hasStoredPhoto {
                if let uri = storedURI, !uri.isEmpty {
                    StockImage(imageUrl: uri, name: ask.job.description, key: ask.job.id, decodeDataURI: true)
                        .frame(maxHeight: 160).clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                } else if let photoProblem {
                    Text(photoProblem).font(.footnote).foregroundStyle(.secondary)
                } else {
                    SkeletonLoading().frame(height: 80)
                }
                Button("Remove photo", systemImage: "trash", role: .destructive) { removePhoto = true }
            }
            NewOrderPhotoField(data: Binding(
                get: { photo },
                set: { photo = $0; removePhoto = $0 == nil && hasStoredPhoto }
            ))
        }
    }

    private func loadStoredPhoto() async {
        guard storedURI == nil, let id = ask.samplePhotoId, !id.isEmpty else { return }
        guard !House.isDemo else { photoProblem = "Sample photo preview unavailable in demo."; return }
        do {
            guard let db = await Businesses.shared.firestore else { photoProblem = "Couldn't load the saved photo. It stays on the piece unless removed."; return }
            let snapshot = try await db.collection("order_photos").document(id).getDocument()
            storedURI = snapshot.data()?["dataUri"] as? String
            if storedURI == nil { photoProblem = "The saved photo is unavailable. It stays on the piece unless removed." }
        } catch {
            photoProblem = "Couldn't load the saved photo. It stays on the piece unless removed."
        }
    }

    @MainActor
    private func save() async {
        // The web's own words when the name is cleared.
        guard !cleanedName.isEmpty else {
            error = "An item needs a name."
            return
        }
        var patch: [String: Any] = ["name": cleanedName, "size": size, "instructions": instructions]
        let op: String
        var fields: [String: Any]
        switch ask.target {
        case .order(let id, let index):
            op = "updateOrderPieceDetails"
            fields = ["orderId": id, "itemIndex": index]
            patch["referenceSku"] = reference
            // An empty weight box leaves the weight as it is, as the web's dialog sends none.
            if let w = WorkshopFigure.read(weightText) { patch["estimatedWeightG"] = w }
            // Sent only when changed: an unchanged photo is not uploaded again with the other details.
            if let photo {
                patch["sampleImageDataUri"] = "data:image/jpeg;base64," + photo.base64EncodedString()
            } else if removePhoto {
                patch["sampleImageDataUri"] = ""
            }
        case .invoice(let id, let index):
            op = "updateInvoicePieceDetails"
            fields = ["invoiceId": id, "itemIndex": index]
        }
        fields["patch"] = patch
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write(op, fields)
            onSaved(Note(title: "Details updated", detail: ask.job.description))
            savedTick += 1
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
