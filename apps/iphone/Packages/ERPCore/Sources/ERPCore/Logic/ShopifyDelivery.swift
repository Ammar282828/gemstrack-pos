import Foundation

/// The courier and its number on a Shopify order (`shopifyTracking`, written by the server's mirror: src/lib/shopify-delivery.ts).
public struct ShopifyTracking: Decodable, Hashable {
    public let company: String?
    public let number: String?

    private enum K: String, CodingKey { case company, number }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        company = c.string(.company)
        number = c.string(.number)
    }
}

/// The colour word a delivery capsule is drawn in; the app maps each to its `Tone`.
public enum ShopifyDeliveryTone: String, Hashable {
    case positive, negative, warning, neutral
}

/// A delivery capsule's words and tone.
public struct ShopifyDeliveryChip: Equatable {
    public let label: String
    public let tone: ShopifyDeliveryTone
}

/// Where a Shopify order's parcel is (TCS, from Shopify's fulfilments), as the web's `deliveryLabel` (src/lib/shopify-delivery.ts).
public enum ShopifyDelivery {
    /// "Delivered", "Returned", "Delivery attempted", "Out for delivery", "With TCS", "Shipped"; nil for unfulfilled or unknown.
    public static func label(_ delivery: String?, company: String?) -> String? {
        let named = (company ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let who = named.isEmpty ? "courier" : named
        switch delivery {
        case "delivered": return "Delivered"
        case "returned": return "Returned"
        case "attempted": return "Delivery attempted"
        case "out_for_delivery": return "Out for delivery"
        case "in_transit": return "With \(who)"
        case "shipped": return "Shipped"
        default: return nil
        }
    }

    /// Delivered is positive, returned negative, an attempt warns, the rest say nothing.
    public static func tone(_ delivery: String?) -> ShopifyDeliveryTone {
        switch delivery {
        case "delivered": return .positive
        case "returned": return .negative
        case "attempted": return .warning
        default: return .neutral
        }
    }

    public static func chip(_ delivery: String?, company: String?) -> ShopifyDeliveryChip? {
        guard let label = label(delivery, company: company) else { return nil }
        return ShopifyDeliveryChip(label: label, tone: tone(delivery))
    }

    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM"
        return f
    }()

    /// The order page's line: "Delivered \u{00B7} TCS 173019676104 \u{00B7} 6 Nov" (the day only once delivered or returned);
    /// nil when there is nothing to say.
    public static func line(_ delivery: String?, tracking: ShopifyTracking?, at: String?) -> String? {
        guard let words = label(delivery, company: tracking?.company) else { return nil }
        var parts = [words]
        let number = (tracking?.number ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !number.isEmpty {
            let company = (tracking?.company ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            parts.append(company.isEmpty ? number : company + " " + number)
        }
        if delivery == "delivered" || delivery == "returned", let d = ERPDate.parse(at) {
            parts.append(dayFormat.string(from: d))
        }
        return parts.joined(separator: " \u{00B7} ")
    }
}

extension Order {
    /// The parcel's capsule on a Shopify order's card.
    public var shopifyDeliveryChip: ShopifyDeliveryChip? { ShopifyDelivery.chip(shopifyDelivery, company: shopifyTracking?.company) }
    /// "Delivered \u{00B7} TCS 1730… \u{00B7} 6 Nov" for the order page.
    public var shopifyDeliveryLine: String? { ShopifyDelivery.line(shopifyDelivery, tracking: shopifyTracking, at: shopifyDeliveryAt) }
}

extension Invoice {
    public var shopifyDeliveryChip: ShopifyDeliveryChip? { ShopifyDelivery.chip(shopifyDelivery, company: shopifyTracking?.company) }
    public var shopifyDeliveryLine: String? { ShopifyDelivery.line(shopifyDelivery, tracking: shopifyTracking, at: shopifyDeliveryAt) }
}
