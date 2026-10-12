package erp.core

import erp.core.logic.ActivityLogEntry
import erp.core.logic.KarigarPortal
import erp.core.logic.KarigarPortalAccount
import erp.core.logic.KarigarPortalGoldLine
import erp.core.logic.KarigarPortalJob
import erp.core.logic.KarigarPortalPayment
import erp.core.logic.KarigarPortalPerson
import erp.core.logic.KarigarPortalSummary
import erp.core.logic.WorkDraft
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.DeliveryInfo
import erp.core.models.ExchangeEntry
import erp.core.models.Expense
import erp.core.models.FloorHistoryEntry
import erp.core.models.GivenItem
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJob
import erp.core.models.KarigarSilverTransaction
import erp.core.models.LeopardsMeta
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.OverheadItem
import erp.core.models.OverheadPlan
import erp.core.models.OverheadPlansAnswer
import erp.core.models.PartnershipSettings
import erp.core.models.Payment
import erp.core.models.PaymentMethod
import erp.core.models.Product
import erp.core.models.Rates
import erp.core.models.Repair
import erp.core.models.RepairPayment
import erp.core.models.RepairPiece
import erp.core.models.SentOnWhatsApp
import erp.core.models.Settings
import erp.core.models.ShareholderLedgerRow
import erp.core.models.WebsiteOrderMeta
import erp.core.models.WebsiteSlip

/** Every model, by class, so `DocJSON.decode<Order>(…)` can find how to read one. */
internal object ModelRegistry {
    private var done = false

    @Synchronized
    fun ensure() {
        if (done) return
        done = true
        Registry.register(Invoice::class, Invoice)
        Registry.register(InvoiceItem::class, InvoiceItem)
        Registry.register(SentOnWhatsApp::class, SentOnWhatsApp)
        Registry.register(Order::class, Order)
        Registry.register(OrderItem::class, OrderItem)
        Registry.register(WebsiteOrderMeta::class, WebsiteOrderMeta)
        Registry.register(WebsiteSlip::class, WebsiteSlip)
        Registry.register(LeopardsMeta::class, LeopardsMeta)
        Registry.register(Customer::class, Customer)
        Registry.register(Karigar::class, Karigar)
        Registry.register(KarigarJob::class, KarigarJob)
        Registry.register(KarigarBatch::class, KarigarBatch)
        Registry.register(KarigarSilverTransaction::class, KarigarSilverTransaction)
        Registry.register(GivenItem::class, GivenItem)
        Registry.register(HisaabEntry::class, HisaabEntry)
        Registry.register(Product::class, Product)
        Registry.register(Repair::class, Repair)
        Registry.register(RepairPiece::class, RepairPiece)
        Registry.register(RepairPayment::class, RepairPayment)
        Registry.register(Settings::class, Settings)
        Registry.register(PaymentMethod::class, PaymentMethod)
        Registry.register(Rates::class, Rates)
        Registry.register(Payment::class, Payment)
        Registry.register(ExchangeEntry::class, ExchangeEntry)
        Registry.register(DeliveryInfo::class, DeliveryInfo)
        Registry.register(Expense::class, Expense)
        Registry.register(AdditionalRevenue::class, AdditionalRevenue)
        Registry.register(OverheadItem::class, OverheadItem)
        Registry.register(OverheadPlan::class, OverheadPlan)
        Registry.register(OverheadPlansAnswer::class, OverheadPlansAnswer)
        Registry.register(ShareholderLedgerRow::class, ShareholderLedgerRow)
        Registry.register(FloorHistoryEntry::class, FloorHistoryEntry)
        Registry.register(PartnershipSettings::class, PartnershipSettings)
        Registry.register(ActivityLogEntry::class, ActivityLogEntry)
        Registry.register(WorkDraft::class, WorkDraft)
        Registry.register(KarigarPortal::class, KarigarPortal)
        Registry.register(KarigarPortalPerson::class, KarigarPortalPerson)
        Registry.register(KarigarPortalSummary::class, KarigarPortalSummary)
        Registry.register(KarigarPortalJob::class, KarigarPortalJob)
        Registry.register(KarigarPortalAccount::class, KarigarPortalAccount)
        Registry.register(KarigarPortalGoldLine::class, KarigarPortalGoldLine)
        Registry.register(KarigarPortalPayment::class, KarigarPortalPayment)
    }
}
