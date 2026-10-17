import SwiftUI

/// Settings (owners): the iPhone Settings app's shape over the ERP's own tabs (lib/nav.ts SETTINGS).
///
/// `/settings` is the list; the native Shop is `/app/settings/shop`, and `/settings/shop` (where the web's Shop details
/// moved) opens it too, numbering and all (`setCounters`, with the delete code). What is simple is edited here; the
/// activity log is the Work group's (ActivityLogScreen) and Recently removed the Owner group's. Voice, Labels
/// (Stock › Labels, still at /settings/printer), Backups (a backup's Restore too, /api/app/backup/restore), the
/// contact and hisaab imports, the website's selling settings (`/app/settings/website`) and the alerts' connection,
/// test and Send now are native too; what stays the ERP's pages, opened inside the app: the Taheri Software book's
/// one-off import, Meta's connection and Shopify's sign-in (OAuth opens in Safari from the native Shopify screen,
/// `/app/settings/shopify`).
/// Simple settings go through /api/app/write `updateSettings` (lib/writes/settings.ts); the rest through their
/// own writes (ops-settings2.ts, ops-settings3.ts).
enum SettingsRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/settings") { SettingsRoot() },
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
            .exact("/settings/printer") { LabelSettings() },
            .exact("/settings/weprint-api") { WeprintSettings() },
            .exact("/settings/backups") { BackupSettings() },
            .exact("/settings/contact-import") { ContactImportSettings() },
            .exact("/settings/hisaab-import") { HisaabImportSettings() },
            .exact("/app/phone") { PhoneSettings() },
            .exact("/app/businesses") { BusinessesScreen() },
            .exact("/app/widgets") { WidgetPreviewScreen() },
        ]
    }
}
