import SwiftUI
import ERPCore

/// What was said after a save, and where the expense was filed (the web's toast).
struct ExpenseSavedNote: Equatable {
    let title: String
    let detail: String
}

/// The note for a few seconds, floating over the list.
struct ExpenseSavedBanner: View {
    let note: ExpenseSavedNote

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                Text(note.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

/// "+" on Expenses: the web's Add expense form (components/expense/expense-form.tsx). Date, category,
/// description and amount are required (the amount at least 0.01); paid by is the business unless a
/// partner's own cash was used. A karigar payment is filed under one of his hisaabs: picking him
/// selects his open hisaab (the newest, if several), and once the hisaab is touched it stays as chosen.
/// The ERP writes it (`addExpense`, lib/writes/expenses.ts), and a partner's cash also goes on that
/// partner's ledger there, as a loan. The sheet stays open with the ERP's own words if it refuses.
struct AddExpenseSheet: View {
    /// What the books already use, then "Other"; a new name can be typed.
    let categories: [String]
    /// The house keeps partner ledgers (`session.shop.partnership`): "Paid by" a partner, and a
    /// partner's salary.
    let partnership: Bool
    /// Told once it is saved, with where it was filed.
    let onSaved: (ExpenseSavedNote) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var category = ""
    @State private var typedCategory = ""
    @State private var what = ""
    @State private var amountText = ""
    @State private var paidBy = "business"
    /// Which partner a "Partner Salary" paid: "" until chosen.
    @State private var salaryFor = ""
    /// "" is not a karigar payment.
    @State private var karigarId = ""
    /// Nil until the hisaab picker is touched; until then the choice follows the karigar.
    @State private var batchChoice: String?
    @State private var saving = false
    @State private var error: String?

    private static let typed = "__typed__"

    /// The web's number box: digits and one dot, two decimals.
    private var amount: Double { MoneyParse.amount(amountText) ?? 0 }

    private var chosenCategory: String {
        let name = category == Self.typed ? typedCategory : category
        return name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// A partner's wage: the business pays it, and the partner it paid is written on the row (the
    /// Shareholders page's salary form), or his page leaves the expense out of his salaries.
    private var isSalary: Bool { partnership && chosenCategory == MoneyPartners.salaryCategory }

    /// The web's schema: a category, a description, and an amount of at least 0.01; a salary also says whose.
    private var canSave: Bool {
        if isSalary && salaryFor.isEmpty { return false }
        return amount >= 0.01 && !cleanedWhat.isEmpty && !chosenCategory.isEmpty && !saving
    }

    // MARK: The karigar and his hisaab

    /// Removed karigars are left out, as the web's list leaves them.
    private var karigars: [Karigar] { book.karigars.items.filter { ($0.deletedAt ?? "").isEmpty } }

    private var karigarName: String {
        let found = karigars.first { $0.id == karigarId }?.name ?? ""
        return found.isEmpty ? karigarId : found
    }

    private var theirBatches: [KarigarBatch] { ExpenseFiling.batches(for: karigarId, in: book.karigarBatches.items) }

    private var batchValue: String {
        batchChoice ?? ExpenseFiling.defaultChoice(karigarId: karigarId, batches: theirBatches)
    }

    private var batchBinding: Binding<String> {
        Binding<String>(get: { batchValue }, set: { batchChoice = $0 })
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                LedgerSection("When and what") {
                    DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    categoryPicker
                    if category == Self.typed {
                        TextField("Category name", text: $typedCategory)
                    }
                    TextField("Description, e.g. Monthly electricity bill", text: $what, axis: .vertical)
                        .lineLimit(1...3)
                }
                LedgerSection("How much") {
                    TextField("Amount in rupees", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                }
                if isSalary {
                    salarySection
                } else if partnership {
                    paidBySection
                }
                karigarSection
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("Add expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            book.karigars.need()
            book.karigarBatches.need()
        }
    }

    private var categoryPicker: some View {
        Picker("Category", selection: $category) {
            Text("Choose…").tag("")
            ForEach(categories, id: \.self) { (name: String) in Text(name).tag(name) }
            Text("Another category…").tag(Self.typed)
        }
        .pickerStyle(.menu)
    }

    private var paidBySection: some View {
        Section {
            Picker("Paid by", selection: $paidBy) {
                Text("Business cash").tag("business")
                ForEach(MoneyPartners.all) { (p: MoneyPartner) in Text(p.name).tag(p.id) }
            }
            .pickerStyle(.segmented)
        } header: {
            LedgerHeading(title: "Paid by")
        } footer: {
            if paidBy != "business" {
                Text("Logged to \(paidBy == "ammar" ? "his" : "her") ledger as a loan to the business.")
            }
        }
    }

    private var salarySection: some View {
        Section {
            Picker("Salary for", selection: $salaryFor) {
                Text("Choose…").tag("")
                ForEach(MoneyPartners.all) { (p: MoneyPartner) in Text(p.name).tag(p.id) }
            }
            .pickerStyle(.menu)
        } header: {
            LedgerHeading(title: "Partner salary")
        } footer: {
            Text("A wage is a cost of the business, so nothing goes on the partner's ledger.")
        }
    }

    /// "Karigar payment": who was paid, and which of his hisaabs it goes under. Paying a karigar outside
    /// a hisaab is a normal payment, so "Direct payment" is a choice, not a gap.
    private var karigarSection: some View {
        Section {
            Picker("Karigar", selection: $karigarId) {
                Text("Not a karigar payment").tag("")
                ForEach(karigars) { (k: Karigar) in Text(k.name.isEmpty ? k.id : k.name).tag(k.id) }
            }
            .pickerStyle(.menu)
            .onChange(of: karigarId) { _, _ in batchChoice = nil }
            if !karigarId.isEmpty {
                hisaabPicker
            }
        } header: {
            LedgerHeading(title: "Karigar payment")
        }
    }

    @ViewBuilder
    private var hisaabPicker: some View {
        let batches = theirBatches
        if batches.isEmpty {
            Text("\(karigarName) has no hisaab yet. This is recorded as a direct payment.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            Picker("Add to a hisaab", selection: batchBinding) {
                ForEach(batches) { (b: KarigarBatch) in
                    Text("\(b.label) · \(ExpenseFiling.hint(b))").tag(b.id)
                }
                Text("Direct payment · outside any hisaab").tag(ExpenseFiling.direct)
            }
            .pickerStyle(.menu)
        }
    }

    // MARK: Saving

    @MainActor
    private func save() async {
        saving = true
        error = nil
        let filed = karigarId.isEmpty ? nil : ExpenseFiling.filedBatchId(batchValue)
        let filedLabel = filed.flatMap { id in theirBatches.first { $0.id == id }?.label }
        var fields: [String: Any] = [
            "date": ERPDate.iso(date),
            "category": chosenCategory,
            "description": isSalary ? MoneyPartners.salaryDescription(partnerId: salaryFor, typed: cleanedWhat) : cleanedWhat,
            "amount": amount,
        ]
        if isSalary {
            fields["paidBy"] = "business"
            fields["shareholderId"] = salaryFor
        } else if partnership {
            fields["paidBy"] = paidBy
        }
        if !karigarId.isEmpty { fields["karigarId"] = karigarId }
        if let filed { fields["batchId"] = filed }
        do {
            try await ERPAPI.shared.write("addExpense", fields)
            let detail = filedLabel.map { "Filed to hisaab “\($0)”." } ?? "Recorded."
            onSaved(ExpenseSavedNote(title: "Expense added", detail: detail))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
