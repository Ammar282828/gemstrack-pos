import SwiftUI

/// Settings (owners): the iPhone Settings app's shape over the ERP's own tabs (lib/nav.ts SETTINGS).
///
/// `/settings` is the list; the web's Shop tab is `/settings`, so the native Shop is
/// `/app/settings/shop` and the list's "Change numbering" opens the ERP's page (`?web=1`). What is
/// simple is edited here; the activity log is the Work group's (ActivityLogScreen); backups, imports, voice and the
/// Shopify and Meta connections stay the ERP's pages, which open inside the app on their own paths.
/// Every change goes through /api/app/write `updateSettings` (lib/writes/settings.ts).
enum SettingsRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/settings") { SettingsRoot() },
            .exact("/app/settings/shop") { ShopSettings() },
            .exact("/settings/alerts") { AlertSettings() },
            .exact("/settings/payment-methods") { BankAccountSettings() },
            .exact("/settings/integrations") { IntegrationSettings() },
            .exact("/settings/data") { DataSettings() },
            .exact("/app/phone") { PhoneSettings() },
        ]
    }
}
