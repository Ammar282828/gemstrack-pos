package erp.app.screens.settings

import erp.app.nav.ScreenRoute
import erp.app.screens.settings.label.LabelLiveSettings
import erp.app.screens.settings.label.LabelSettings
import erp.app.screens.settings.label.TagPrinterSettings

/**
 * Settings (owners): the iPhone Settings app's shape over the ERP's own tabs (lib/nav.ts SETTINGS).
 *
 * `/settings` is the list; the web's Shop tab is `/settings`, so the native Shop is `/app/settings/shop` and the list's
 * "Change numbering" opens the ERP's page (`?web=1`). What is simple is edited here; the activity log is the Work group's
 * and Recently removed the Owner group's. Voice, Labels (Stock › Labels, still at /settings/printer), Backups and the
 * contact and hisaab imports are native too, and Labels is the tag designer with its Printer (`/app/tag-printer`) and Label LIVE (`/app/label-live`) pages; what stays the ERP's pages, opened inside the app: a backup's Restore (it
 * writes a whole file over the live books), the Taheri Software book's one-off import, Meta's connection, and Shopify's
 * sign-in (OAuth opens in the browser from the native Shopify screen, `/app/settings/shopify`).
 * Simple settings go through /api/app/write `updateSettings` (lib/writes/settings.ts); the rest through their own writes
 * (ops-settings2.ts).
 */
val SettingsRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/settings") { SettingsRoot() },
    ScreenRoute.exact("/app/settings/shop") { ShopSettings() },
    ScreenRoute.exact("/settings/alerts") { AlertSettings() },
    ScreenRoute.exact("/settings/payment-methods") { BankAccountSettings() },
    ScreenRoute.exact("/settings/integrations") { IntegrationSettings() },
    ScreenRoute.exact("/app/settings/shopify") { ShopifySettings() },
    ScreenRoute.exact("/settings/data") { DataSettings() },
    ScreenRoute.exact("/settings/voice") { VoiceSettings() },
    ScreenRoute.exact("/settings/printer") { LabelSettings() },
    ScreenRoute.exact("/app/label-live") { LabelLiveSettings() },
    ScreenRoute.exact("/app/tag-printer") { TagPrinterSettings() },
    ScreenRoute.exact("/settings/weprint-api") { WeprintSettings() },
    ScreenRoute.exact("/settings/backups") { BackupSettings() },
    ScreenRoute.exact("/settings/contact-import") { ContactImportSettings() },
    ScreenRoute.exact("/settings/hisaab-import") { HisaabImportSettings() },
    ScreenRoute.exact("/app/phone") { PhoneSettings() },
    ScreenRoute.exact("/app/widgets") { WidgetPreviewScreen() },
)
