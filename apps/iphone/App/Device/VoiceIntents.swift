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
                "New sale in \(.applicationName)",
                "Record a payment in \(.applicationName)",
            ],
            shortTitle: "Talk to ERP",
            systemImageName: "mic.fill")
    }
}
#endif
