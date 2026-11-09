import Foundation

/// The Shopify section's rules (owner, 2026-11-09; House of Mina): a Shopify order is an invoice whose `source` starts with
/// "shopify" ("shopify" for a synced order, "shopify_import" for a CSV's). One predicate, so Invoices (which leaves them out
/// once the section exists), the Shopify list and its chips never disagree.
public func isShopifyOrderSource(_ source: String?) -> Bool {
    (source ?? "").hasPrefix("shopify")
}

/// Where a Shopify order stands for the shop to act on: the COD order whose WhatsApp confirmation has not come back, or
/// one the customer (or Shopify) cancelled. Everything else is `.other`.
public enum ShopifyOrderStage: Equatable {
    case toConfirm, cancelled, other
}

/// The WhatsApp state's stage (shopify-whatsapp.ts `WhatsAppOrderState`): "awaiting-confirmation" is still to confirm;
/// "declined" is a cancel request. No state, or any other, is `.other`.
public func shopifyStage(whatsappState state: String?) -> ShopifyOrderStage {
    switch state {
    case "awaiting-confirmation": return .toConfirm
    case "declined": return .cancelled
    default: return .other
    }
}

extension Invoice {
    /// An order that came from Shopify (a synced web order or an imported CSV row).
    public var isShopifyOrder: Bool { isShopifyOrderSource(source) }

    /// To confirm, Cancelled, or neither. A cancelled order (Shopify's own `shopifyCancelledAt`, or the customer's cancel request on
    /// WhatsApp) is Cancelled whatever else it says.
    public var shopifyStage: ShopifyOrderStage {
        if !(shopifyCancelledAt ?? "").isEmpty { return .cancelled }
        return ERPCore.shopifyStage(whatsappState: whatsappOrder?.state)
    }
}

extension Order {
    /// A Shopify web order in the ERP's orders (id "SHOPIFY-<n>", `source: "shopify"`; owner, 2026-11-09). `source` is read as a
    /// CustomerSource, where "shopify" is the unknown word, kept as written.
    public var isShopifyOrder: Bool { id.hasPrefix("SHOPIFY-") || isShopifyOrderSource(source?.rawValue) }

    /// To confirm (the COD confirmation has not come back), Cancelled (the order's own status, or the customer's cancel request), or neither.
    public var shopifyStage: ShopifyOrderStage {
        if status == .cancelled { return .cancelled }
        return ERPCore.shopifyStage(whatsappState: whatsappOrder?.state)
    }
}
