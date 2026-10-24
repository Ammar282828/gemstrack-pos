import SwiftUI

/// Settings (owners): the iPhone Settings app's shape over the ERP's own tabs (lib/nav.ts SETTINGS).
///
/// `/settings` is the list; the native Shop is `/app/settings/shop`, and `/settings/shop` (where the web's Shop details
/// moved) opens it too, numbering and all (`setCounters`, with the delete code). What is simple is edited here; the
/// activity log is the Work group's (ActivityLogScreen) and Recently removed the Owner group's. Voice, Labels
/// (Stock › Labels, still at /settings/printer), Backups (a backup's Restore too, /api/app/backup/restore), the
/// contact and hisaab imports, the Taheri Software book's one-off import, the website's selling settings
/// (`/app/settings/website`) and the alerts' connection, test and Send now are native too; Shopify's sign-in is
/// OAuth, opened in Safari from the native Shopify screen (`/app/settings/shopify`).
///
/// An old `/settings?tab=` link lands where that tab went, as the web's /settings sends it (src/app/settings/page.tsx):
/// the rates open the rate sheet over the list (Home's "Set today's gold rate" said that address), the rest their screen.
/// Simple settings go through /api/app/write `updateSettings` (lib/writes/settings.ts); the rest through their
/// own writes (ops-settings2.ts, ops-settings3.ts, ops-settings4.ts).
enum SettingsRoutes {
    static var all: [ScreenRoute] {
        [
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/settings" }, make: { SettingsRoutes.tab($0) }),
            .exact("/app/settings/shop") { ShopSettings() },
            // The web's Shop tab moved to /settings/shop when /settings became the phone's index (2026-10-12): the map and
            // Search now say that address, so it opens the same native screen.
            .exact("/settings/shop") { ShopSettings() },
            .exact("/settings/alerts") { AlertSettings() },
            .exact("/settings/payment-methods") { BankAccountSettings() },
            .exact("/settings/integrations") { IntegrationSettings() },
            .exact("/app/settings/shopify") { ShopifySettings() },
            .exact("/app/settings/website") { WebsiteSellingSettings() },
            .exact("/settings/data") { DataSettings() },
            .exact("/settings/voice") { VoiceSettings() },
            // Connect an AI (src/app/settings/ai): native on the Mac and the iPhone, on the web's own /api/agent/keys routes.
            .exact("/settings/ai") { SettingsAIKeysScreen() },
            .exact("/settings/printer") { LabelSettings() },
            .exact(LabelLiveSettingsScreen.path) { LabelLiveSettingsScreen() },
            .exact(TagPrinterSettingsScreen.path) { TagPrinterSettingsScreen() },
            .exact("/settings/weprint-api") { WeprintSettings() },
            .exact("/settings/backups") { BackupSettings() },
            .exact("/settings/contact-import") { ContactImportSettings() },
            .exact("/settings/hisaab-import") { HisaabImportSettings() },
            .exact("/settings/import-taheri") { TaheriBookImportSettings() },
            .exact("/app/phone") { PhoneSettings() },
            .exact("/app/businesses") { BusinessesScreen() },
            .exact("/app/widgets") { WidgetPreviewScreen() },
        ]
    }

    /// "/settings", or an old "/settings?tab=…" where that tab went.
    private static func tab(_ path: String) -> AnyView {
        switch URLComponents(string: path)?.queryItems?.first(where: { $0.name == "tab" })?.value {
        case "rates": return AnyView(SettingsRoot(opensRates: true))
        case "notifications", "alerts": return AnyView(AlertSettings())
        case "integrations": return AnyView(IntegrationSettings())
        case "data": return AnyView(DataSettings())
        case "security": return AnyView(ActivityLogScreen())
        default: return AnyView(SettingsRoot())
        }
    }
}
