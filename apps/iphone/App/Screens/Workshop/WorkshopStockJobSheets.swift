import SwiftUI
import ERPCore

// The Workshop page's two stock-work dialogs (src/app/workshop/page.tsx AddJobDialog, EditDetailsDialog), each a
// write through the ERP (`addStockJob`, `updateStockJobDetails`, lib/writes/workshop-admin.ts). Nothing here moves
// money: the making agreed is written on the job, and paying him is a payment from his page.

/// "Assign Stock Work": pieces for the shop's own stock, not tied to a customer order; repairs and samples too. A
/// karigar and what he is making are needed; the rest is the web form's, each left out when blank. The job starts
/// Pending, written up now; the ERP names it with the karigar's name on file.
struct WorkshopStockJobSheet: View {
    let karigars: [Karigar]
    /// The karigar the work goes to when one was in focus ("" for none).
    let presetKarigarId: String
    let onSaved: (OwnerNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var karigarId: String
    @State private var what = ""
    @State private var category = ""
    @State private var metal = "gold"
    @State private var weightText = ""
    @State private var quantityText = "1"
    @State private var makingText = ""
    @State private var size = ""
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?

    init(karigars: [Karigar], presetKarigarId: String, onSaved: @escaping (OwnerNote) -> Void) {
        self.karigars = karigars
        self.presetKarigarId = presetKarigarId
        self.onSaved = onSaved
        // Only a karigar on the books is offered, so a focus on someone removed starts blank.
        let preset = karigars.contains { $0.id == presetKarigarId } ? presetKarigarId : ""
        _karigarId = State(initialValue: preset)
    }

    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !karigarId.isEmpty && !cleanedWhat.isEmpty && !saving }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Picker("Karigar", selection: $karigarId) {
                        Text("Select karigar").tag("")
                        ForEach(karigars) { (k: Karigar) in Text(k.name.isEmpty ? k.id : k.name).tag(k.id) }
                    }
                    .pickerStyle(.menu)
                    TextField("What are they making? e.g. 4 stacked rings, moti set repair", text: $what, axis: .vertical)
                        .lineLimit(1...3)
                } footer: {
                    Text("Pieces for your own inventory, not tied to a customer order. Also use this for repairs and samples.")
                }
                Section {
                    Picker("Category", selection: $category) {
                        Text("Optional").tag("")
                        ForEach(WorkshopLogic.categoryIds, id: \.self) { (id: String) in
                            Text(WorkshopLogic.categoryTitle(id) ?? id).tag(id)
                        }
                    }
                    .pickerStyle(.menu)
                    Picker("Metal", selection: $metal) {
                        ForEach(WorkshopLogic.stockMetals) { (m: WorkshopMetal) in Text(m.title).tag(m.id) }
                    }
                    .pickerStyle(.menu)
                }
                Section {
                    LabeledContent("Weight (g)") {
                        TextField("0.000", text: $weightText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Qty") {
                        TextField("1", text: $quantityText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Making (PKR)") {
                        TextField("0", text: $makingText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    TextField("Size, e.g. 12, 2.4, 7.5\"", text: $size)
                }
                Section("Notes") {
                    TextField("Instructions, stone details…", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("Assign Stock Work")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Assign") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func save() async {
        guard canSave else { return }
        var job: [String: Any] = [
            "karigarId": karigarId,
            "description": cleanedWhat,
            "metalType": metal,
        ]
        if !category.isEmpty { job["itemCategory"] = category }
        // A box left empty is left out, as the web's form leaves it.
        if let w = WorkshopFigure.read(weightText) { job["weightG"] = w }
        if let q = WorkshopFigure.read(quantityText, places: 0) { job["quantity"] = q }
        if let m = WorkshopFigure.read(makingText, places: 2) { job["agreedCost"] = m }
        let s = size.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.isEmpty { job["size"] = s }
        let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { job["notes"] = n }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("addStockJob", ["job": job])
            let name = karigars.first { $0.id == karigarId }?.name ?? ""
            onSaved(OwnerNote(title: "Job assigned", detail: "\(cleanedWhat) \u{2192} \(name)"))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

/// "Making details" of a stock job: only the fields the karigar sees. Its name (never cleared), size, weight and
/// instructions; a blank size or instructions is removed. Price, customer and quantity are unchanged.
struct WorkshopJobDetailsSheet: View {
    let job: KarigarJob
    let onSaved: (OwnerNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var size: String
    @State private var weightText: String
    @State private var instructions: String
    @State private var saving = false
    @State private var error: String?

    init(job: KarigarJob, onSaved: @escaping (OwnerNote) -> Void) {
        self.job = job
        self.onSaved = onSaved
        _name = State(initialValue: job.description)
        _size = State(initialValue: job.size ?? "")
        _weightText = State(initialValue: WorkshopFigure.field(job.weightG))
        _instructions = State(initialValue: job.notes ?? "")
    }

    private var cleanedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("What is being made", text: $name, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    Text("Item name")
                } footer: {
                    Text("\(job.description): only the fields the karigar sees. Price, customer and quantity are unchanged.")
                }
                Section {
                    LabeledContent("Size") {
                        TextField("e.g. 12", text: $size).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Weight (g)") {
                        TextField("0.000", text: $weightText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                }
                Section {
                    TextField("Stones, plating, sizing, or other specifications", text: $instructions, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text("Instructions")
                } footer: {
                    Text("Shown to the karigar and on the workshop slip.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("Making details")
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
        .presentationDetents([.large])
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func save() async {
        // The web's own words when the name is cleared.
        guard !cleanedName.isEmpty else {
            error = "An item needs a name."
            return
        }
        var patch: [String: Any] = ["description": cleanedName, "size": size, "notes": instructions]
        // An empty weight box leaves the weight as it is, as the web's dialog sends none.
        if let w = WorkshopFigure.read(weightText) { patch["weightG"] = w }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("updateStockJobDetails", ["jobId": job.id, "patch": patch])
            onSaved(OwnerNote(title: "Details updated", detail: job.description))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
