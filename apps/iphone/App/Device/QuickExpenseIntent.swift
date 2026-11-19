#if os(iOS)
import AppIntents
import ERPCore
import FirebaseAuth
import FirebaseFirestore
import Foundation

// "Add expense" without opening the app (owner, 2026-11-19: "a way to very quickly add an expense for house of mina through
// the APP WITHOUT OPENING THE APP EVEN"; "make it a widget option … i dont want to make my action button bound"). One App
// Intent, run in the background, so the app never opens: the Shortcuts widget on the Home Screen (pick "Add expense"), the
// Shortcut control in Control Center or on the Lock Screen, Siri ("Add an expense in ERP") and Spotlight. A widget can't take
// typed input, so a tap asks for the amount and what for in the system's own prompt over the Home Screen.
//
// Everything the Expenses sheet (AddExpenseSheet.swift) can file, the same way (owner, 2026-11-19: "the add expense should
// consider all posibilities of adding an expense"): the date (not ahead of today), a category from the house's list or a new
// one, who paid (the business, or a partner's own cash: a loan on that partner's ledger, where the house keeps partners), a
// partner's salary (which partner; it is asked for), and a karigar payment filed under his open hisaab, a chosen one, or as
// a direct payment. The same write (`addExpense`, owners only, checked by the ERP); no line: kept on the phone and sent by
// the Outbox. The phone must be unlocked (Face ID), as for any money.

/// A business on this phone, as Siri and Shortcuts offer it.
struct BusinessEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Business"
    static let defaultQuery = BusinessEntityQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    @MainActor init(_ b: Business) {
        id = b.id
        name = b.displayName
    }
}

struct BusinessEntityQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [BusinessEntity] {
        Businesses.shared.list.filter { identifiers.contains($0.id) }.map { BusinessEntity($0) }
    }

    @MainActor
    func suggestedEntities() async throws -> [BusinessEntity] {
        Businesses.shared.list.filter { !$0.isDemo }.map { BusinessEntity($0) }
    }

    @MainActor
    func defaultResult() async -> BusinessEntity? {
        Businesses.shared.business(QuickExpense.defaultBusinessID()).map { BusinessEntity($0) }
    }
}

/// The chosen business's expense categories, as its ERP last told this phone (/api/app/me `shop.expenseCategories`).
struct ExpenseCategoryOptions: DynamicOptionsProvider {
    @IntentParameterDependency<AddExpenseIntent>(\.$business) var intent

    @MainActor
    func results() async throws -> [String] {
        QuickExpense.categories(intent?.business.id ?? QuickExpense.defaultBusinessID())
    }
}

/// Who paid: the business's cash, or a partner's own (Expenses › Paid by; `MoneyPartners`).
enum ExpensePayer: String, AppEnum {
    case business, ammar, mina
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Paid by"
    static let caseDisplayRepresentations: [ExpensePayer: DisplayRepresentation] = [
        .business: "Business cash", .ammar: "Ammar", .mina: "Mina",
    ]
}

/// Whose salary a "Partner Salary" paid.
enum ExpensePartner: String, AppEnum {
    case ammar, mina
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Partner"
    static let caseDisplayRepresentations: [ExpensePartner: DisplayRepresentation] = [.ammar: "Ammar", .mina: "Mina"]
}

/// A karigar of the chosen business (removed ones left out, as the sheet leaves them).
struct KarigarEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Karigar"
    static let defaultQuery = KarigarEntityQuery()
    let id: String
    let name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct KarigarEntityQuery: EntityQuery {
    @IntentParameterDependency<AddExpenseIntent>(\.$business) var intent

    @MainActor
    private func all() async -> [KarigarEntity] {
        guard let biz = Businesses.shared.business(intent?.business.id ?? QuickExpense.defaultBusinessID()) else { return [] }
        return await QuickExpense.karigars(biz).map { KarigarEntity(id: $0.id, name: $0.name.isEmpty ? $0.id : $0.name) }
    }

    @MainActor
    func entities(for identifiers: [String]) async throws -> [KarigarEntity] {
        await all().filter { identifiers.contains($0.id) }
    }

    @MainActor
    func suggestedEntities() async throws -> [KarigarEntity] { await all() }
}

/// One of the karigar's hisaabs, or "Direct payment" (outside any hisaab), as the sheet's hisaab picker offers.
struct HisaabEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Hisaab"
    static let defaultQuery = HisaabEntityQuery()
    let id: String
    let title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    static let direct = HisaabEntity(id: ExpenseFiling.direct, title: "Direct payment · outside any hisaab")
}

struct HisaabEntityQuery: EntityQuery {
    @IntentParameterDependency<AddExpenseIntent>(\.$business, \.$karigar) var intent

    @MainActor
    private func all() async -> [HisaabEntity] {
        guard let kid = intent?.karigar?.id,
              let biz = Businesses.shared.business(intent?.business.id ?? QuickExpense.defaultBusinessID()) else { return [.direct] }
        let batches = await QuickExpense.batches(biz, karigarId: kid)
        return batches.map { HisaabEntity(id: $0.id, title: "\($0.label) · \(ExpenseFiling.hint($0))") } + [.direct]
    }

    @MainActor
    func entities(for identifiers: [String]) async throws -> [HisaabEntity] {
        await all().filter { identifiers.contains($0.id) }
    }

    @MainActor
    func suggestedEntities() async throws -> [HisaabEntity] { await all() }
}

enum QuickExpense {
    private static let lastKey = "erp.quickExpense.business"

    /// The business last used here; else House of Mina (what the owner asked for); else the one open.
    @MainActor
    static func defaultBusinessID() -> String {
        let list = Businesses.shared.list
        if let last = UserDefaults.standard.string(forKey: lastKey), list.contains(where: { $0.id == last }) { return last }
        if list.contains(where: { $0.id == "mina" }) { return "mina" }
        return Businesses.shared.current.id
    }

    @MainActor
    static func remember(_ id: String) { UserDefaults.standard.set(id, forKey: lastKey) }

    /// The business's last /api/app/me, kept on this phone per business.
    @MainActor
    static func me(_ id: String) -> Session.Me? {
        UserDefaults.standard.data(forKey: BizKey("erp.lastMe", id)).flatMap { try? JSONDecoder().decode(Session.Me.self, from: $0) }
    }

    /// The sheet's list (`ExpenseFigures.formCategories`): the house's categories, else "Other".
    @MainActor
    static func categories(_ id: String) -> [String] {
        let shop = me(id)?.shop?.expenseCategories ?? []
        let list = ExpenseFigures.formCategories(shop: shop, expenses: [])
        return list.isEmpty ? ["Other"] : list
    }

    @MainActor
    static func partnership(_ id: String) -> Bool { me(id)?.shop?.partnership ?? false }

    /// A collection of the business's own Firestore (its copy on this phone answers with no line).
    @MainActor
    private static func docs<T: Decodable>(_ type: T.Type, _ collection: String, _ biz: Business) async -> [T] {
        guard let db = Businesses.shared.firestore(for: biz),
              let snap = try? await db.collection(collection).getDocuments() else { return [] }
        return snap.documents.compactMap { DocJSON.decode(T.self, id: $0.documentID, data: $0.data(), custom: FirestoreSource.plainSDK) }
    }

    @MainActor
    static func karigars(_ biz: Business) async -> [Karigar] {
        await docs(Karigar.self, Collections.karigars, biz)
            .filter { ($0.deletedAt ?? "").isEmpty }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// His hisaabs, an open one first, then the newest (ExpenseFiling.batches).
    @MainActor
    static func batches(_ biz: Business, karigarId: String) async -> [KarigarBatch] {
        ExpenseFiling.batches(for: karigarId, in: await docs(KarigarBatch.self, Collections.karigarBatches, biz))
    }
}

/// A refusal in words Siri can say.
struct QuickExpenseFailure: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

struct AddExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "Add expense"
    static let description = IntentDescription("Records an expense in a business's books without opening the app: the date, category, who paid, a partner's salary or a karigar payment filed to his hisaab.")
    static let supportedModes: IntentModes = .background
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Amount", description: "In rupees", requestValueDialog: "How much was it?")
    var amount: Int

    @Parameter(title: "For", description: "What it was for", requestValueDialog: "What was it for?")
    var note: String

    @Parameter(title: "Business")
    var business: BusinessEntity

    @Parameter(title: "Category", description: "One of the house's categories (else its first)", optionsProvider: ExpenseCategoryOptions())
    var category: String?

    @Parameter(title: "New category", description: "A category not on the list yet (used in place of Category)")
    var newCategory: String?

    @Parameter(title: "Date", description: "When it was paid (today if left out)")
    var date: Date?

    @Parameter(title: "Paid by", description: "The business's cash, or a partner's own (a loan on that partner's ledger)", default: .business)
    var paidBy: ExpensePayer

    @Parameter(title: "Salary for", description: "For a Partner Salary: which partner", requestValueDialog: "Whose salary is it?")
    var salaryFor: ExpensePartner?

    @Parameter(title: "Karigar", description: "A payment to a karigar")
    var karigar: KarigarEntity?

    @Parameter(title: "Hisaab", description: "Which of his hisaabs (his open one if left out), or a direct payment")
    var hisaab: HisaabEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$amount) for \(\.$note) to \(\.$business)") {
            \.$category
            \.$newCategory
            \.$date
            \.$paidBy
            \.$salaryFor
            \.$karigar
            \.$hisaab
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard amount > 0 else { throw $amount.needsValueError("How much was it?") }
        let what = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !what.isEmpty else { throw $note.needsValueError("What was it for?") }
        guard let biz = Businesses.shared.business(business.id) else {
            throw QuickExpenseFailure(message: "That business isn't on this phone any more.")
        }
        guard let auth = Businesses.shared.auth(for: biz), auth.currentUser != nil else {
            throw QuickExpenseFailure(message: "Sign in to \(biz.displayName) in the ERP app first.")
        }

        // The category: a new one typed, else one of the house's (by name, any case), else the house's first.
        let known = QuickExpense.categories(biz.id)
        let fresh = (newCategory ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let picked = (category ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let filed = !fresh.isEmpty ? fresh
            : (known.first { $0.caseInsensitiveCompare(picked) == .orderedSame } ?? (picked.isEmpty ? known[0] : picked))

        // The date: today if none, never ahead of today (the sheet's picker stops at today).
        let when = min(date ?? Date(), Date())

        let partners = QuickExpense.partnership(biz.id)
        let isSalary = partners && filed == MoneyPartners.salaryCategory
        var fields: [String: Any] = [
            "date": ERPDate.iso(when),
            "category": filed,
            "amount": amount,
        ]
        if isSalary {
            guard let who = salaryFor else { throw $salaryFor.needsValueError("Whose salary is it?") }
            fields["description"] = MoneyPartners.salaryDescription(partnerId: who.rawValue, typed: what)
            fields["paidBy"] = "business"
            fields["shareholderId"] = who.rawValue
        } else {
            fields["description"] = what
            // A partner's own cash only where the house keeps partner ledgers; elsewhere it is the business's.
            fields["paidBy"] = partners ? paidBy.rawValue : "business"
        }

        // A karigar payment: under the hisaab chosen, else his open one, else a direct payment.
        var filedHisaab: String?
        if let k = karigar {
            fields["karigarId"] = k.id
            let batches = await QuickExpense.batches(biz, karigarId: k.id)
            let choice = hisaab?.id ?? ExpenseFiling.defaultChoice(karigarId: k.id, batches: batches)
            if let id = ExpenseFiling.filedBatchId(choice) {
                fields["batchId"] = id
                filedHisaab = batches.first { $0.id == id }?.label
            }
        }

        let answer: [String: Any]
        do {
            answer = try await ERPAPI.shared.write("addExpense", fields, business: biz,
                                                   pending: PendingSummary(kind: "expense", title: "Expense: \(what)", amount: Double(amount)))
        } catch {
            throw QuickExpenseFailure(message: "Not added: \(error.localizedDescription)")
        }
        QuickExpense.remember(biz.id)
        let money = Money.pkr(Double(amount))
        if ERPAPI.wasQueued(answer) {
            return .result(dialog: "No connection: \(money) for \(what) is kept on this phone and goes to \(biz.displayName) when you're back online.")
        }
        var said = "Added \(money) for \(what) to \(biz.displayName), under \(filed)"
        if let k = karigar { said += filedHisaab.map { ", paid to \(k.name) in hisaab “\($0)”" } ?? ", paid to \(k.name) directly" }
        if !isSalary, partners, paidBy != .business { said += ", from \(MoneyPartners.name(paidBy.rawValue) ?? "the partner")'s cash" }
        return .result(dialog: "\(said).")
    }
}
#endif
