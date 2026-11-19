#if os(iOS)
import AppIntents
import ERPCore
import FirebaseAuth
import Foundation

// "Add expense" without opening the app (owner, 2026-11-19: "a way to very quickly add an expense for house of mina through
// the APP WITHOUT OPENING THE APP EVEN"; "make it a widget option … i dont want to make my action button bound"). One App
// Intent, run in the background, so the app never opens: the Shortcuts widget on the Home Screen (pick "Add expense"), the
// Shortcut control in Control Center or on the Lock Screen, Siri ("Add an expense in ERP") and Spotlight. A widget can't take
// typed input, so a tap asks for the amount and what for in the system's own prompt over the Home Screen. Siri asks for
// the amount and what it was for; the business starts on House of Mina (then the last one used) and the category on the
// house's first. The same write as the Expenses sheet (`addExpense`, owners only, checked by the ERP); no line: kept on the
// phone and sent by the Outbox. The phone must be unlocked (Face ID), as for any money.

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
    @MainActor
    func results() async throws -> [String] {
        QuickExpense.categories(QuickExpense.defaultBusinessID())
    }
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

    /// The categories from the business's last /api/app/me, kept on this phone per business.
    @MainActor
    static func categories(_ id: String) -> [String] {
        guard let data = UserDefaults.standard.data(forKey: BizKey("erp.lastMe", id)),
              let me = try? JSONDecoder().decode(Session.Me.self, from: data),
              let list = me.shop?.expenseCategories, !list.isEmpty else { return ["Other"] }
        return list
    }
}

/// A refusal in words Siri can say.
struct QuickExpenseFailure: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

struct AddExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "Add expense"
    static let description = IntentDescription("Records an expense in a business's books without opening the app.")
    static let supportedModes: IntentModes = .background
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Amount", description: "In rupees", requestValueDialog: "How much was it?")
    var amount: Int

    @Parameter(title: "For", description: "What it was for", requestValueDialog: "What was it for?")
    var note: String

    @Parameter(title: "Category", optionsProvider: ExpenseCategoryOptions())
    var category: String?

    @Parameter(title: "Business")
    var business: BusinessEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$amount) for \(\.$note) to \(\.$business)") {
            \.$category
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
        let known = QuickExpense.categories(biz.id)
        let typed = (category ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let filed = known.first { $0.caseInsensitiveCompare(typed) == .orderedSame } ?? (typed.isEmpty ? known[0] : typed)
        let fields: [String: Any] = [
            "amount": amount,
            "description": what,
            "category": filed,
            "date": ISO8601DateFormatter().string(from: Date()),
            "paidBy": "business",
        ]
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
        return .result(dialog: "Added \(money) for \(what) to \(biz.displayName), under \(filed).")
    }
}
#endif
