import Foundation

/// The shop's one settings document: Firestore `app_settings/global` (src/lib/store.ts `Settings`).
/// Surprising: the document id is the fixed "global" (`Collections.globalSettingsDoc`). The ERP
/// fills any missing field from placeholder seed values (a 240,000 24k rate, a sample phone
/// line); this model does not, so a missing rate is 0 and a missing text is "", honestly unset.
/// Left out on purpose: `shopifyAccessToken` (a secret that must never reach a phone),
/// `firebaseConfig`, `allowedDeviceIds`, `weprintApiSkus`, `labelLayout`, `overheadPlans` and
/// `monthlyOverheads` (web-only screens). Every `notif*` switch reads as off when absent, as the
/// server reads them (lib/notifications/schedule.ts); `autoDraftForms` defaults on. The times are
/// "HH:MM" in Karachi (defaults on the server: checklist 09:00, end of day 19:00, report 21:00).
public struct Settings: Decodable, Identifiable, Hashable {
    public let id: String

    // Rates, PKR per gram (lib/rates.ts RATE_KEYS).
    public let goldRatePerGram24k: Double
    public let goldRatePerGram22k: Double
    public let goldRatePerGram21k: Double
    public let goldRatePerGram18k: Double
    /// Palladium, flat: the fallback when a piece carries no karat.
    public let palladiumRatePerGram: Double
    public let palladiumRatePerGram18k: Double
    public let palladiumRatePerGram12k: Double
    public let platinumRatePerGram: Double
    public let silverRatePerGram: Double

    /// When any rate last moved (ISO), stamped by every rate change and by "confirm rates".
    public let ratesUpdatedAt: String?
    /// Who moved it: a name from lib/people.ts, else an email.
    public let ratesUpdatedBy: String?
    /// When the rates were last auto-fetched from gold.pk (ISO).
    public let goldRatesLastFetchedAt: String?

    public let shopName: String
    public let shopAddress: String
    public let shopContact: String
    public let shopLogoUrl: String?
    public let shopLogoUrlBlack: String?

    /// Counters: the next invoice is `lastInvoiceNumber + 1` (INV-000123).
    public let lastInvoiceNumber: Int
    public let lastOrderNumber: Int
    /// REP-000001 onwards; missing until the first repair is written.
    public let lastRepairNumber: Int?

    /// The shop's bank accounts, for the "pay to" lines.
    public let paymentMethods: [PaymentMethod]
    /// "default" or "taheri"; shops also hold retired colour words, all read as "taheri".
    public let theme: String
    /// "standard" or "glass" (Settings > Appearance).
    public let uiStyle: String?
    /// The kill switch: while true, the ERP writes nothing.
    public let databaseLocked: Bool
    /// Keep unfinished orders and invoices on this device and offer them back.
    public let autoDraftForms: Bool

    public let shopifyStoreDomain: String?
    public let shopifyLastSyncedAt: String?
    public let shopifyGrantedScopes: String?

    // WhatsApp notifications.
    public let notifEnabled: Bool
    /// Recipient numbers, international format with no plus. Stored as text, and a number in places.
    public let notifPhones: [String]
    public let notifNewOrder: Bool
    public let notifOrderCompleted: Bool
    public let notifOrderCancelled: Bool
    /// Real time: a new invoice was created.
    public let notifNewInvoice: Bool
    /// Real time: a payment was recorded on an invoice.
    public let notifPaymentReceived: Bool
    /// Nightly orders and invoices summary, at `notifDailyReportTime`.
    public let notifDailyReport: Bool
    public let notifDailyChecklist: Bool
    public let notifEndOfDay: Bool
    public let notifWeeklyReport: Bool
    /// Daily 09:30: yesterday's ads.
    public let notifAdsDaily: Bool
    /// The 1st: the month before as a PDF.
    public let notifMonthlyReport: Bool
    /// Daily check: orders past their promised date.
    public let notifOrderOverdue: Bool
    /// Daily check: given items unreturned for 7+ days.
    public let notifGivenItems: Bool
    /// Weekly check: karigar balances.
    public let notifKarigarPayment: Bool
    public let notifDailyChecklistTime: String?
    public let notifEndOfDayTime: String?
    public let notifDailyReportTime: String?

    private enum K: String, CodingKey {
        case id
        case goldRatePerGram24k, goldRatePerGram22k, goldRatePerGram21k, goldRatePerGram18k
        case palladiumRatePerGram, palladiumRatePerGram18k, palladiumRatePerGram12k
        case platinumRatePerGram, silverRatePerGram
        case ratesUpdatedAt, ratesUpdatedBy, goldRatesLastFetchedAt
        case shopName, shopAddress, shopContact, shopLogoUrl, shopLogoUrlBlack
        case lastInvoiceNumber, lastOrderNumber, lastRepairNumber
        case paymentMethods, theme, uiStyle, databaseLocked, autoDraftForms
        case shopifyStoreDomain, shopifyLastSyncedAt, shopifyGrantedScopes
        case notifEnabled, notifPhones, notifNewOrder, notifOrderCompleted, notifOrderCancelled
        case notifNewInvoice, notifPaymentReceived, notifDailyReport, notifDailyChecklist, notifEndOfDay
        case notifWeeklyReport, notifAdsDaily, notifMonthlyReport, notifOrderOverdue, notifGivenItems
        case notifKarigarPayment, notifDailyChecklistTime, notifEndOfDayTime, notifDailyReportTime
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? Collections.globalSettingsDoc
        goldRatePerGram24k = c.double(.goldRatePerGram24k, default: 0)
        goldRatePerGram22k = c.double(.goldRatePerGram22k, default: 0)
        goldRatePerGram21k = c.double(.goldRatePerGram21k, default: 0)
        goldRatePerGram18k = c.double(.goldRatePerGram18k, default: 0)
        palladiumRatePerGram = c.double(.palladiumRatePerGram, default: 0)
        palladiumRatePerGram18k = c.double(.palladiumRatePerGram18k, default: 0)
        palladiumRatePerGram12k = c.double(.palladiumRatePerGram12k, default: 0)
        platinumRatePerGram = c.double(.platinumRatePerGram, default: 0)
        silverRatePerGram = c.double(.silverRatePerGram, default: 0)
        ratesUpdatedAt = c.string(.ratesUpdatedAt)
        ratesUpdatedBy = c.string(.ratesUpdatedBy)
        goldRatesLastFetchedAt = c.string(.goldRatesLastFetchedAt)
        shopName = c.string(.shopName, default: "")
        shopAddress = c.string(.shopAddress, default: "")
        shopContact = c.string(.shopContact, default: "")
        shopLogoUrl = c.string(.shopLogoUrl)
        shopLogoUrlBlack = c.string(.shopLogoUrlBlack)
        lastInvoiceNumber = c.int(.lastInvoiceNumber) ?? 0
        lastOrderNumber = c.int(.lastOrderNumber) ?? 0
        lastRepairNumber = c.int(.lastRepairNumber)
        paymentMethods = c.list(.paymentMethods)
        theme = c.string(.theme, default: "slate")
        uiStyle = c.string(.uiStyle)
        databaseLocked = c.bool(.databaseLocked, default: false)
        autoDraftForms = c.bool(.autoDraftForms, default: true)
        shopifyStoreDomain = c.string(.shopifyStoreDomain)
        shopifyLastSyncedAt = c.string(.shopifyLastSyncedAt)
        shopifyGrantedScopes = c.string(.shopifyGrantedScopes)
        notifEnabled = c.bool(.notifEnabled, default: false)
        notifPhones = c.strings(.notifPhones)
        notifNewOrder = c.bool(.notifNewOrder, default: false)
        notifOrderCompleted = c.bool(.notifOrderCompleted, default: false)
        notifOrderCancelled = c.bool(.notifOrderCancelled, default: false)
        notifNewInvoice = c.bool(.notifNewInvoice, default: false)
        notifPaymentReceived = c.bool(.notifPaymentReceived, default: false)
        notifDailyReport = c.bool(.notifDailyReport, default: false)
        notifDailyChecklist = c.bool(.notifDailyChecklist, default: false)
        notifEndOfDay = c.bool(.notifEndOfDay, default: false)
        notifWeeklyReport = c.bool(.notifWeeklyReport, default: false)
        notifAdsDaily = c.bool(.notifAdsDaily, default: false)
        notifMonthlyReport = c.bool(.notifMonthlyReport, default: false)
        notifOrderOverdue = c.bool(.notifOrderOverdue, default: false)
        notifGivenItems = c.bool(.notifGivenItems, default: false)
        notifKarigarPayment = c.bool(.notifKarigarPayment, default: false)
        notifDailyChecklistTime = c.string(.notifDailyChecklistTime)
        notifEndOfDayTime = c.string(.notifEndOfDayTime)
        notifDailyReportTime = c.string(.notifDailyReportTime)
    }
}

/// One of the shop's bank accounts, in `Settings.paymentMethods` (src/lib/store.ts
/// `PaymentMethod`). Not to be confused with `PaymentType`, how a payment arrived.
public struct PaymentMethod: Decodable, Identifiable, Hashable {
    public let id: String
    public let bankName: String
    public let accountName: String
    public let accountNumber: String
    public let iban: String?

    private enum K: String, CodingKey { case id, bankName, accountName, accountNumber, iban }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        bankName = c.string(.bankName, default: "")
        accountName = c.string(.accountName, default: "")
        accountNumber = c.string(.accountNumber, default: "")
        iban = c.string(.iban)
    }
}
