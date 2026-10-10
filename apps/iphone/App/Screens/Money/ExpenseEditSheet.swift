import SwiftUI
import ERPCore

/// Edit on an expense row: the web's expense form over the row (components/expense/expense-form.tsx, edit
/// mode), filled from it. The same fields and rules as Add expense: a date, a category, a description and
/// an amount of at least 0.01; paid by the business unless a partner's own cash was used; a salary says
/// whose; a karigar payment is filed under one of his hisaabs, and the hisaab it is in stays as it is
/// until the karigar changes.
///
/// The ERP writes it (`updateExpense`, lib/writes/expense-admin.ts) and keeps a partner's loan row true:
/// the same payer, amount and day keep the row, anything else draws it again. A karigar or a partner
/// taken off the row goes from it (the web's form kept the old karigar). The sheet stays open with the
/// ERP's own words if it refuses (a partner's drawing is the Shareholders page's).
struct ExpenseEditSheet: View {
    let expense: Expense
    /// What the books already use, then "Other"; a new name can be typed.
    let categories: [String]
    /// The house keeps partner ledgers (`session.shop.partnership`).
    let partnership: Bool
    let onSaved: (ExpenseSavedNote) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    @State private var category: String
    @State private var typedCategory = ""
    @State private var what: String
    @State private var amountText: String
    @State private var paidBy: String
    @State private var salaryFor: String
    @State private var karigarId: String
    /// The row's own hisaab until the karigar changes; nil then follows the karigar, as on Add expense.
    @State private var batchChoice: String?
    @State private var saving = false
    @State private var error: String?

    private static let typed = "__typed__"

    init(expense: Expense, categories: [String], partnership: Bool, onSaved: @escaping (ExpenseSavedNote) -> Void) {
        self.expense = expense
        self.partnership = partnership
        self.onSaved = onSaved
        // The row's own category is always one to pick, on the list or not.
        var names = categories
        if !expense.category.isEmpty && !names.contains(expense.category) { names.insert(expense.category, at: 0) }
        self.categories = names
        _date = State(initialValue: ERPDate.parse(expense.date) ?? Date())
        _category = State(initialValue: expense.category)
        _what = State(initialValue: expense.description)
        _amountText = State(initialValue: ExpenseEditing.typed(expense.amount))
        _paidBy = State(initialValue: ExpenseEditing.payerWord(expense.paidBy) ?? "business")
        _salaryFor = State(initialValue: expense.shareholderId ?? "")
        let kid = expense.karigarId ?? ""
        _karigarId = State(initialValue: kid)
        _batchChoice = State(initialValue: kid.isEmpty ? nil : (expense.batchId ?? ExpenseFiling.direct))
    }

    private var amount: Double { MoneyParse.amount(amountText) ?? 0 }

    private var chosenCategory: String {
        let name = category == Self.typed ? typedCategory : category
        return name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var isSalary: Bool { partnership && chosenCategory == MoneyPartners.salaryCategory }

    private var canSave: Bool {
        if isSalary && salaryFor.isEmpty { return false }
        return amount >= 0.01 && !cleanedWhat.isEmpty && !chosenCategory.isEmpty && !saving
    }

    // MARK: The karigar and his hisaab

    /// Removed karigars are left out, as on Add expense, save the one this row already pays.
    private var karigars: [Karigar] {
        book.karigars.items.filter { ($0.deletedAt ?? "").isEmpty || $0.id == (expense.karigarId ?? "") }
    }

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
                    TextField("Description", text: $what, axis: .vertical)
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
            .navigationTitle("Edit expense")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(saving)
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
        .interactiveDismissDisabled(saving)
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
        var fields: [String: Any] = [
            "expenseId": expense.id,
            "date": ExpenseEditing.dateText(picked: date, original: expense.date),
            "category": chosenCategory,
            "description": cleanedWhat,
            "amount": amount,
        ]
        if isSalary {
            fields["paidBy"] = "business"
            fields["shareholderId"] = salaryFor
        } else if partnership {
            fields["paidBy"] = paidBy
        } else if let payer = ExpenseEditing.payerWord(expense.paidBy) {
            // No partner picker in this house: the row keeps the payer it has.
            fields["paidBy"] = payer
        }
        if !karigarId.isEmpty { fields["karigarId"] = karigarId }
        if let filed { fields["batchId"] = filed }
        do {
            try await ERPAPI.shared.write("updateExpense", fields)
            onSaved(ExpenseSavedNote(title: "Saved", detail: "Expense updated."))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
