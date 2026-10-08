import Foundation

/// The Firestore collection names, as `FIRESTORE_COLLECTIONS` in src/lib/store.ts spells them
/// (plus the few other collections the store itself reads), and the two settings documents.
public enum Collections {
    /// Holds `global` (the shop's rates and switches; `Settings`) and `website` (selling from taheri.shop).
    public static let settings = "app_settings"
    /// Document id of the shop's one settings document.
    public static let globalSettingsDoc = "global"
    /// Document id of the website's selling configuration.
    public static let websiteConfigDoc = "website"

    /// Doc id is the SKU.
    public static let products = "products"
    /// A piece leaves `products` for here when it is sold (same shape as `Product`).
    public static let soldProducts = "sold_products"
    public static let customers = "customers"
    public static let karigars = "karigars"
    public static let invoices = "invoices"
    public static let orders = "orders"
    public static let categories = "categories"
    public static let hisaab = "hisaab"
    public static let expenses = "expenses"
    public static let additionalRevenue = "additional_revenue"
    public static let karigarBatches = "karigar_batches"
    public static let activityLog = "activity_log"
    public static let givenItems = "given_items"
    public static let silverTransactions = "silver_transactions"
    public static let voiceAliases = "voice_aliases"
    public static let karigarJobs = "karigar_jobs"
    public static let repairs = "repairs"

    /// Photos of an order's pieces, one document each (lib/order-photos.ts); they no longer ride in the order.
    public static let orderPhotos = "order_photos"
    /// Orders from taheri.shop before a person confirms them (website/types.ts).
    public static let onlineOrders = "online_orders"
    /// A partner's own books, written when an expense is fronted by that partner (`PaidBy`).
    public static let ammarLedger = "ammar_ledger"
    public static let minaLedger = "mina_ledger"
}
