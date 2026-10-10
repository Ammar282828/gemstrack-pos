import SwiftUI
import ERPCore

/// The two partners, in the page's order (lib/shareholders.ts SHAREHOLDERS), with their own book.
struct ShareholderPerson: Identifiable, Hashable {
    let id: String
    let name: String
    let ledger: String

    static let all = [
        ShareholderPerson(id: "mina", name: "Mina", ledger: Collections.minaLedger),
        ShareholderPerson(id: "ammar", name: "Ammar", ledger: Collections.ammarLedger),
    ]

    static func named(_ id: String) -> ShareholderPerson? { all.first { $0.id == id } }
}

/// What the Add / Pay / Withdraw sheet is for (shareholders/page.tsx `Mode`).
enum ShareholderMove: String, Identifiable {
    case contribution, salary, withdrawal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .salary: return "Pay a salary"
        case .withdrawal: return "Withdraw capital"
        case .contribution: return "Add a contribution"
        }
    }

    var explanation: String {
        switch self {
        case .salary:
            return "Remuneration for work performed. Recorded in Expenses as a business cost; it does not affect their stake in the business."
        case .withdrawal:
            return "Capital returned to the partner, which reduces their stake. This is not remuneration \u{2014} use Pay salary for that."
        case .contribution:
            return "Funds contributed to the business \u{2014} as equity, or as a loan repaid before profits are split."
        }
    }

    var action: String {
        switch self {
        case .salary: return "Pay salary"
        case .withdrawal: return "Record withdrawal"
        case .contribution: return "Record contribution"
        }
    }

    var placeholder: String {
        switch self {
        case .salary: return "e.g. August"
        case .withdrawal: return "e.g. capital returned"
        case .contribution: return "e.g. bank transfer"
        }
    }
}

/// The sheet's opening: what it is for and whose it is.
struct ShareholderAsk: Identifiable {
    let move: ShareholderMove
    let who: String
    var id: String { "\(move.rawValue)-\(who)" }
}

/// "Add contribution", "Pay salary" and "Withdraw capital" (the page's one dialog). A salary is only an
/// expense: a wage does not move anyone's capital, so nothing goes on the ledger (`addExpense`, the
/// partner named, as the page files it). A contribution is a ledger row; a withdrawal is the ledger's
/// draw and its Partner Drawings expense (`addShareholderEntry`, lib/writes/shareholders.ts). The sheet
/// stays open with the ERP's own words if it refuses.
struct ShareholderEntrySheet: View {
    let move: ShareholderMove
    /// What each partner has had in salary, for the line that says paying one evens the two up.
    let salaryPaid: [String: Double]
    let onSaved: (OwnerNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var who: String
    @State private var amountText = ""
    @State private var date = Date()
    @State private var category: PartnerLedgerCategory = .equity
    @State private var what = ""
    @State private var saving = false
    @State private var error: String?

    init(ask: ShareholderAsk, salaryPaid: [String: Double], onSaved: @escaping (OwnerNote) -> Void) {
        move = ask.move
        self.salaryPaid = salaryPaid
        self.onSaved = onSaved
        _who = State(initialValue: ask.who)
    }

    private var amount: Double { MoneyParse.amount(amountText) ?? 0 }
    private var person: ShareholderPerson? { ShareholderPerson.named(who) }
    private var cleaned: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Picker("Shareholder", selection: $who) {
                        ForEach(ShareholderPerson.all) { (p: ShareholderPerson) in Text(p.name).tag(p.id) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(move.explanation)
                }
                LedgerSection("Amount and date") {
                    TextField("Amount (PKR)", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }
                if move != .salary {
                    Section {
                        Picker("Treated as", selection: $category) {
                            Text("Equity").tag(PartnerLedgerCategory.equity)
                            Text("Loan").tag(PartnerLedgerCategory.loan)
                        }
                        .pickerStyle(.segmented)
                    } footer: {
                        Text(categoryHint)
                    }
                }
                Section {
                    TextField("Description, \(move.placeholder)", text: $what, axis: .vertical)
                        .lineLimit(1...3)
                } footer: {
                    if let evens = evensUp { Text(evens) }
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(move.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(move.action) { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(saving)
    }

    private var categoryHint: String {
        switch (move, category) {
        case (.withdrawal, .equity): return "Equity: reduces their stake in the business."
        case (.withdrawal, .loan): return "Loan: repayment of funds they lent."
        case (_, .equity): return "Equity: their stake in the business."
        case (_, .loan): return "Loan: repaid before profits are distributed."
        }
    }

    /// The page's line under a salary for the partner who is behind: paying them evens the two up.
    private var evensUp: String? {
        guard move == .salary, let me = person else { return nil }
        let other = ShareholderPerson.all.first { $0.id != me.id }
        guard let other else { return nil }
        let mine = salaryPaid[me.id] ?? 0, theirs = salaryPaid[other.id] ?? 0
        let diff = theirs - mine
        // salaryGap: a gap under a rupee is no gap.
        guard abs(diff) >= 1, diff > 0 else { return nil }
        return "\(other.name) is \(ShareholderMoney.fmt(diff)) ahead on salary. Paying \(me.name) evens that up."
    }

    /// The form's day as the ERP reads it (`new Date(date)`: its midnight, UTC).
    private var day: String { OwnerText.day(date) }

    private func save() async {
        guard let person else { return }
        guard !cleaned.isEmpty, amount > 0 else {
            error = "Add a description and an amount"
            return
        }
        saving = true
        error = nil
        do {
            switch move {
            case .salary:
                // Only an expense. Writing a withdrawal as well would shrink their stake on top of paying them.
                let midnight = ERPDate.parse(day).map { ERPDate.iso($0) } ?? ERPDate.iso(date)
                _ = try await ERPAPI.shared.write("addExpense", [
                    "date": midnight,
                    "category": MoneyPartners.salaryCategory,
                    "description": MoneyPartners.salaryDescription(partnerId: person.id, typed: cleaned),
                    "amount": amount,
                    "paidBy": "business",
                    "shareholderId": person.id,
                ])
                onSaved(OwnerNote(title: "\(person.name) paid \(ShareholderMoney.fmt(amount))", detail: "Recorded as a salary expense."))
            case .contribution, .withdrawal:
                _ = try await ERPAPI.shared.write("addShareholderEntry", [
                    "shareholderId": person.id,
                    "kind": move.rawValue,
                    "category": category.rawValue,
                    "description": cleaned,
                    "amount": amount,
                    "date": day,
                ])
                if move == .contribution {
                    onSaved(OwnerNote(title: "\(person.name)'s contribution recorded", detail: ShareholderMoney.fmt(amount)))
                } else {
                    onSaved(OwnerNote(title: "\(person.name) took \(ShareholderMoney.fmt(amount))", detail: "Logged as a Partner Drawings expense too."))
                }
            }
            saving = false
            dismiss()
        } catch {
            self.error = error.localizedDescription
            saving = false
        }
    }
}

/// The page's money (`fmt`): whole rupees, without a sign; the words or a +/− around it say which way.
enum ShareholderMoney {
    static func fmt(_ n: Double) -> String { Money.pkr(abs(n.rounded())) }

    /// "+PKR 31,750" / "−PKR 6,000", as the page prints a share of the P&L.
    static func signed(_ n: Double) -> String { "\(n >= 0 ? "+" : "\u{2212}")\(fmt(n))" }
}
