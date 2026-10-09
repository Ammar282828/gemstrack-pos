import Foundation
import ERPCore

// Edit invoice (src/app/invoices/[id]/edit, the sale page's `startEdit`): the invoice on file opened in New
// sale's own form, and saved as the sale page saves an edit, through the same `createInvoice` with the
// invoice's number (lib/writes/create-invoice.ts keeps its number, its date and its payments, and puts its
// hisaab right). Pure, so the contract cases (apps/iphone/Packages/Contract) compile it.
//
// As in the browser: every line is loaded as it was billed (a line with a fixed price keeps that price), the
// invoice's own rates are held (never written back to the shop's), the payment rows start empty (money taken
// now is added to what was paid before), and a piece taken off the bill stays sold.

struct SaleEdit: Equatable {
    let invoiceId: String
    let draft: SaleDraft
    /// What was paid before this edit: it stays on the invoice, and new payments are added to it.
    let paidBefore: Double

    init(_ inv: Invoice, settings: Settings?) {
        invoiceId = inv.id
        paidBefore = inv.amountPaid
        var d = SaleDraft()
        d.lines = inv.items.map { SaleLine(billed: $0) }
        let id = inv.customerId ?? ""
        d.customerId = id.isEmpty ? nil : id
        d.customerName = isWalkInName(inv.customerName) && id.isEmpty ? "" : inv.customerName
        d.customerPhone = inv.customerContact ?? ""
        // The invoice's own rates in every box, held: a rate it lacks is the shop's, as the browser fills it.
        let stamped = inv.ratesApplied
        let shop = settings?.rates ?? [:]
        func rate(_ k: RateInputKey) -> Double {
            let own: Double?
            switch k.rateKey {
            case .goldRatePerGram24k: own = stamped.goldRatePerGram24k
            case .goldRatePerGram22k: own = stamped.goldRatePerGram22k
            case .goldRatePerGram21k: own = stamped.goldRatePerGram21k
            case .goldRatePerGram18k: own = stamped.goldRatePerGram18k
            case .palladiumRatePerGram: own = stamped.palladiumRatePerGram
            case .palladiumRatePerGram18k: own = stamped.palladiumRatePerGram18k
            case .palladiumRatePerGram12k: own = stamped.palladiumRatePerGram12k
            case .platinumRatePerGram: own = stamped.platinumRatePerGram
            case .silverRatePerGram: own = stamped.silverRatePerGram
            }
            if let own, own > 0 { return own }
            return shop[k.rateKey] ?? 0
        }
        var boxes: [String: String] = [:]
        for k in RateInputKey.allCases {
            let v = rate(k)
            if v > 0 { boxes[k.rawValue] = SaleNumber.text(v) }
        }
        d.rates = boxes
        d.discount = SaleNumber.text(inv.discountAmount)
        let rows = rowsFromExchanges(invoiceExchanges(inv)).map { SaleExchangeRow($0) }
        d.exchanges = rows.isEmpty ? [SaleExchangeRow.blank()] : rows
        d.payments = [SalePaymentRow()]
        d.takenBy = inv.takenBy ?? ""
        d.hideRates = inv.hideRates
        d.internalNote = inv.internalNote ?? ""
        let perGram = inv.costRate24k ?? 0
        d.costTola = perGram > 0 ? String(Int((perGram * SALE_GRAMS_PER_TOLA).rounded())) : ""
        var del = SaleDelivery()
        if let x = inv.delivery, x.required, !x.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            del.required = true
            del.address = x.address
            del.city = x.city ?? ""
            del.expectedDate = x.expectedDate ?? ""
            del.contactName = x.contactName ?? ""
            del.contactPhone = x.contactPhone ?? ""
            del.charge = SaleNumber.text(x.charge)
            del.notes = x.notes ?? ""
        }
        d.delivery = del
        draft = d
    }
}

extension SaleLine {
    /// A billed line back on the sale, as `loadCartFromInvoice` puts it in the cart: a fixed-price line keeps
    /// its price, and its stones and diamonds are read from its own flags and details (its charges are 0).
    init(billed item: InvoiceItem) {
        self.init(blankFor: item.metalType.rawValue, sku: item.sku)
        name = item.name
        categoryId = item.categoryId
        karat = item.karat?.rawValue
        metalWeightG = item.metalWeightG
        let stoneNote = (item.stoneDetails ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let diamondNote = (item.diamondDetails ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        hasStones = item.stoneChargesIfAny > 0 || item.hasStones || !stoneNote.isEmpty
        stoneWeightG = item.stoneWeightG
        wastagePercentage = item.wastagePercentage
        makingCharges = item.makingCharges
        hasDiamonds = item.diamondChargesIfAny > 0 || item.hasDiamonds || !diamondNote.isEmpty
        diamondCharges = item.diamondChargesIfAny
        stoneCharges = item.stoneChargesIfAny
        miscCharges = item.miscChargesIfAny
        stoneDetails = item.stoneDetails
        diamondDetails = item.diamondDetails
        size = item.size
        let fixed = item.isCustomPrice || item.isManualPrice
        isCustomPrice = fixed
        customPrice = fixed ? item.unitPrice : nil
        if let r = item.silverRatePerGram, r > 0 { silverRatePerGram = r }
        platingType = item.platingType
        platingNote = item.platingNote
        nickelFree = item.nickelFree
    }
}

extension SaleDraft {
    /// The edit as createInvoice takes it: the sale's own payload with the invoice's number.
    func editPayload(_ f: SaleFigures, invoiceId: String, qr: (String) -> String?) -> [String: Any] {
        var out = payload(f, qr: qr)
        out["existingInvoiceId"] = invoiceId
        return out
    }
}
