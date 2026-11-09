import SwiftUI

/// Shopify (/shopify; House of Mina's nav entry "shopify", owner 2026-11-09): the web orders are ERP orders, so this is the
/// Orders hub over them (OrdersHub, `shopify: true`): its stages and next steps, the WhatsApp step on each card, a To confirm
/// chip, and Earlier (invoiced) for the old Shopify invoices. A card opens the order page; an old one, its invoice page.
struct ShopifyScreen: View {
    var body: some View {
        OrdersHub(shopify: true)
    }
}
