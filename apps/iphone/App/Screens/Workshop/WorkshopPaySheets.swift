import SwiftUI
import ERPCore

// The karigar page's pay dialogs (src/app/karigars/[id]/page.tsx): Record Payment, Silver Transaction, Start a new
// pay batch, Settle and close the pay batch. Each is one write through the ERP. Paying him is an expense
// (`addExpense`, lib/writes/expenses.ts) filed under his open batch; the rest are lib/writes/workshop-admin.ts.
// Every figure shown before saving is ERPCore KarigarPay's (lib/karigar-pay.ts), the one the ERP writes.
// None of them posts to Hisaab, as on the web; the sheets say so.

/// His silver entries, read live for his page only (owners): the shop's Book has no shelf for them, and nobody
/// else reads them. Owners read Firestore themselves, as the page does.
@MainActor
final class WorkshopSilverBook {
    let silver = Shelf<KarigarSilverTransaction>(Collections.silverTransactions) { $0.date > $1.date }

    func need() { silver.need() }

    /// Off the screen, the listener stops; coming back starts it again.
    func stop() { silver.reset() }
}

/// What the karigar page asked to open.
enum WorkshopPayAsk: Identifiable {
    case pay(KarigarBatch)
    case silver
    case start
    case settle(KarigarPay.InBatch)
    case assign

    var id: String {
        switch self {
        case .pay(let b): return "pay-" + b.id
        case .silver: return "silver"
        case .start: return "start"
        case .settle(let open): return "settle-" + open.batch.id
        case .assign: return "assign"
        }
    }
}

// MARK: Record a payment

/// "Record Payment to <name>", added to his open pay batch: the expense form locked to him and to it. Date, category,
/// description and an amount of at least 0.01 are needed; "Paid by" is the business unless a partner's own cash was
/// used (the house that keeps partner ledgers). Asked once more before it is sent, saying what is written.
struct WorkshopPaySheet: View {
    let karigar: Karigar
    let batch: KarigarBatch
    /// The house's expense categories (ExpenseFigures.formCategories); a new name can be typed.
    let categories: [String]
    let partnership: Bool
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var category = ""
    @State private var typedCategory = ""
    @State private var what = ""
    @State private var amountText = ""
    @State private var paidBy = "business"
    @State private var confirming = false
    @State private var saving = false
    @State private var error: String?
    @State private var savedTick = 0
    @State private var failedTick = 0

    private static let typed = "__typed__"

    private var amount: Double { MoneyParse.rupees(amountText) ?? 0 }
    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var chosenCategory: String {
        (category == Self.typed ? typedCategory : category).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var canSave: Bool { amount >= 0.01 && !cleanedWhat.isEmpty && !chosenCategory.isEmpty && !saving && !UpdateGate.blocked }
    private var name: String { karigar.name.isEmpty ? karigar.id : karigar.name }
    private var partner: MoneyPartner? { MoneyPartners.all.first { $0.id == paidBy } }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    Picker("Category", selection: $category) {
                        Text("Choose…").tag("")
                        ForEach(categories, id: \.self) { (c: String) in Text(c).tag(c) }
                        Text("Another category…").tag(Self.typed)
                    }
                    .pickerStyle(.menu)
                    if category == Self.typed {
                        TextField("Category name", text: $typedCategory)
                    }
                    TextField("Description", text: $what, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    LedgerHeading(title: "Paying \(name)")
                } footer: {
                    Text("Added to \(batch.label).")
                }
                LedgerSection("Amount (PKR)") {
                    TextField("0", text: $amountText.wholeRupees)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { HeroAmount(amount: amount, lac: true) }
                }
                if partnership {
                    Section {
                        if MoneyPartners.all.count > 2 {
                            paidByPicker.pickerStyle(.menu)
                        } else {
                            paidByPicker.pickerStyle(.segmented)
                        }
                    } header: {
                        LedgerHeading(title: "Paid by")
                    } footer: {
                        if let partner {
                            Text("Personal: logged to \(partner.name)'s ledger as a loan.")
                        }
                    }
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error, title: "Not paid")
            .safeAreaInset(edge: .top, spacing: 0) { UpdateBanner() }
            .navigationTitle("Record payment")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Pay") { confirming = true }
                        .disabled(!canSave)
                }
            }
            .confirmationDialog("Pay \(Money.pkr(amount)) to \(name)?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Pay \(Money.pkr(amount))") { Task { await save() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(consequence)
            }
        }
        .interactiveDismissDisabled(saving)
    }

    private var paidByPicker: some View {
        Picker("Paid by", selection: $paidBy) {
            Text("Business cash").tag("business")
            ForEach(MoneyPartners.all) { (p: MoneyPartner) in Text(p.name).tag(p.id) }
        }
    }

    /// Exactly what the ERP writes.
    private var consequence: String {
        var s = "An expense of \(ShopDate.say(ERPDate.iso(date))) under \(chosenCategory), \u{201C}\(cleanedWhat)\u{201D}, filed to pay batch \u{201C}\(batch.label)\u{201D}."
        if let partner {
            s += " Paid from \(partner.name)'s own pocket, so it also goes on \(partner.name)'s ledger as a loan to the business."
        }
        s += " Nothing is posted to Hisaab."
        return s
    }

    @MainActor
    private func save() async {
        guard canSave else { return }
        var fields: [String: Any] = [
            "date": ERPDate.iso(date),
            "category": chosenCategory,
            "description": cleanedWhat,
            "amount": amount,
            "karigarId": karigar.id,
            "batchId": batch.id,
        ]
        if partnership { fields["paidBy"] = paidBy }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("addExpense", fields)
            onSaved(Note(title: "Expense added", detail: "Filed to hisaab \u{201C}\(batch.label)\u{201D}."))
            savedTick += 1
            dismiss()
        } catch {
            failedTick += 1
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: Silver

/// "Silver Transaction": silver received from him, with a surcharge per gram. The total is the grams at that rate
/// (KarigarPay.silverSurcharge), as the ERP stores it; the form's rules are KarigarPay.silverProblem's.
struct WorkshopSilverSheet: View {
    let karigar: Karigar
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var gramsText = ""
    @State private var rateText = ""
    @State private var notes = ""
    @State private var confirming = false
    @State private var saving = false
    @State private var error: String?
    @State private var savedTick = 0
    @State private var failedTick = 0

    private var grams: Double { WorkshopFigure.read(gramsText) ?? 0 }
    private var rate: Double { WorkshopFigure.read(rateText, places: 2) ?? 0 }
    private var total: Double { KarigarPay.silverSurcharge(grams: grams, perGram: rate) }
    private var problem: String? { KarigarPay.silverProblem(grams: grams, perGram: rate) }
    private var name: String { karigar.name.isEmpty ? karigar.id : karigar.name }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent("Silver received (grams)") {
                        TextField("e.g. 50.5", text: $gramsText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Surcharge per gram (PKR)") {
                        TextField("e.g. 35", text: $rateText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    if total > 0 {
                        LabeledContent("Total surcharge") {
                            Text(Money.pkr(total)).monospacedDigit()
                        }
                    }
                } footer: {
                    if !gramsText.isEmpty, let problem {
                        Text(problem).foregroundStyle(Tone.problem.color)
                    } else {
                        Text("Record silver received from \(name) with per-gram surcharge.")
                    }
                }
                LedgerSection("Notes (optional)") {
                    TextField("e.g. March batch ring set", text: $notes, axis: .vertical)
                        .lineLimit(1...3)
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error, title: "Not saved")
            .navigationTitle("Silver transaction")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { confirming = true }
                        .disabled(problem != nil || saving)
                }
            }
            .confirmationDialog("Record \(WorkshopLogic.grams3(grams)) of silver from \(name)?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Record silver") { Task { await save() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Surcharge \(Money.pkr(total)): \(WorkshopLogic.grams3(grams)) at PKR \(RateKeys.say(rate)) a gram, kept under his silver transactions. No expense and no Hisaab entry is written.")
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func save() async {
        guard problem == nil else { return }
        var fields: [String: Any] = ["karigarId": karigar.id, "silverGrams": grams, "surchargePerGram": rate]
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty { fields["description"] = note }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("addSilverEntry", fields)
            onSaved(Note(title: "Silver transaction recorded"))
            savedTick += 1
            dismiss()
        } catch {
            failedTick += 1
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: Start a pay batch

/// "Start a new pay batch": named, started now. His payments from this page are filed under it until it is settled.
struct WorkshopBatchStartSheet: View {
    let karigar: Karigar
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var saving = false
    @State private var error: String?
    @State private var savedTick = 0

    private var cleaned: String { label.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("e.g. March 2026", text: $label)
                        .submitLabel(.done)
                        .onSubmit { Task { await save() } }
                } header: {
                    LedgerHeading(title: "Pay batch name")
                } footer: {
                    Text("Give it a name, e.g. \u{201C}March 2026\u{201D} or \u{201C}Gold Set Batch\u{201D}. Payments from his page are filed under it until it is settled.")
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .failureAlert($error, title: "Not started")
            .navigationTitle("Start a new pay batch")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { Task { await save() } }
                        .disabled(cleaned.isEmpty || saving)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func save() async {
        guard !cleaned.isEmpty, !saving else { return }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("startPayBatch", ["karigarId": karigar.id, "label": cleaned])
            onSaved(Note(title: "New pay batch started", detail: "\u{201C}\(cleaned)\u{201D} is now active."))
            savedTick += 1
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: Settle

/// "Settle and close the pay batch": closed now at the total its payments come to (KarigarPay, the figure the ERP
/// writes; it refuses if a payment came or went since, so the owner sees the new one first). A name for the next
/// starts it at the same moment ("Settle and carry over"). The sheet is the confirmation: it says what happens.
struct WorkshopSettleSheet: View {
    let open: KarigarPay.InBatch
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var carry = ""
    @State private var confirming = false
    @State private var saving = false
    @State private var error: String?
    @State private var savedTick = 0
    @State private var failedTick = 0

    private var cleanedCarry: String { carry.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var count: Int { open.payments.count }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent("Pay batch", value: open.batch.label)
                    LabeledContent("Payments", value: "\(count)")
                    MoneyRow("Total", open.total, emphasis: true)
                } header: {
                    LedgerHeading(title: "Closing")
                } footer: {
                    Text(consequence)
                }
                Section {
                    TextField("New hisaab name, e.g. April 2026", text: $carry)
                } header: {
                    LedgerHeading(title: "Carry over to new hisaab? (optional)")
                } footer: {
                    Text("Leave blank to settle without starting a new hisaab.")
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .failureAlert($error, title: "Not settled")
            .navigationTitle("Settle pay batch")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Settle") { confirming = true }
                        .disabled(saving)
                }
            }
            // Closing a batch cannot be undone: asked once more, as Pay and Silver are.
            .confirmationDialog("Settle \u{201C}\(open.batch.label)\u{201D} at \(Money.pkr(open.total))?", isPresented: $confirming, titleVisibility: .visible) {
                Button(cleanedCarry.isEmpty ? "Settle and close" : "Settle and carry over") { Task { await save() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(consequence)
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }

    private var consequence: String {
        var s = "\u{201C}\(open.batch.label)\u{201D} is closed now at \(Money.pkr(open.total)), the total of its \(count) payment\(count == 1 ? "" : "s"), and kept under Settled pay batches."
        if cleanedCarry.isEmpty {
            s += " Paying him from his page then needs a new pay batch."
        } else {
            s += " \u{201C}\(cleanedCarry)\u{201D} starts at the same moment and takes his next payments."
        }
        s += " Nothing is paid and nothing is posted to Hisaab."
        return s
    }

    @MainActor
    private func save() async {
        guard !saving else { return }
        var fields: [String: Any] = ["batchId": open.batch.id, "expectedTotal": open.total]
        if !cleanedCarry.isEmpty { fields["carryOverLabel"] = cleanedCarry }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("settlePayBatch", fields)
            if cleanedCarry.isEmpty {
                onSaved(Note(title: "Pay batch settled", detail: "\u{201C}\(open.batch.label)\u{201D} closed \u{2014} \(Money.pkr(open.total))."))
            } else {
                onSaved(Note(title: "Settled, and a new pay batch started", detail: "\u{201C}\(open.batch.label)\u{201D} closed. \u{201C}\(cleanedCarry)\u{201D} is now active."))
            }
            savedTick += 1
            dismiss()
        } catch {
            failedTick += 1
            self.error = error.localizedDescription
        }
        saving = false
    }
}
