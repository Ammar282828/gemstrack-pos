#if os(iOS)
import AppIntents

/// The phrases Siri and Spotlight know the app by (owner, 2026-10-25: "Hey Siri, ERP", the Action button, Spotlight,
/// Control Center). Each one opens the open business listening; what is said next is the sentence. The Action button
/// and Shortcuts offer it by its title; the Control Center control is in the widget extension (Widget/ERPVoiceControl.swift).
struct ERPShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TalkToERPIntent(),
            phrases: [
                "Talk to \(.applicationName)",
                "Ask \(.applicationName)",
                "Voice in \(.applicationName)",
            ],
            shortTitle: "Talk to ERP",
            systemImageName: "mic.fill")
        // "New sale" does what it says: the new-sale page, not the voice sheet. ("Record a payment" opened voice too,
        // which is not what it promised, so it is not offered.)
        AppShortcut(
            intent: NewSaleIntent(),
            phrases: [
                "New sale in \(.applicationName)",
                "Start a sale in \(.applicationName)",
            ],
            shortTitle: "New sale",
            systemImageName: "cart")
        // An expense without opening the app (QuickExpenseIntent.swift): Siri asks the amount and what for, and files it.
        AppShortcut(
            intent: AddExpenseIntent(),
            phrases: [
                "Add an expense in \(.applicationName)",
                "Add expense in \(.applicationName)",
                "New expense in \(.applicationName)",
            ],
            shortTitle: "Add expense",
            systemImageName: "minus.circle")
    }
}

/// Opens the open business on its New sale page (route /invoices/new), as the Create button does.
struct NewSaleIntent: AppIntent {
    static let title: LocalizedStringResource = "New sale"
    static let description = IntentDescription("Opens the ERP on a new sale.")
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.route(path: "/invoices/new", business: nil)
        return .result()
    }
}
#endif
