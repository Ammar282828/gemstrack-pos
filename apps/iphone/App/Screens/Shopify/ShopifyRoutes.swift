import SwiftUI

/// The Shopify section (owner, 2026-11-09; House of Mina's nav entry "shopify"): its web orders, apart from Invoices.
enum ShopifyRoutes {
    static var all: [ScreenRoute] {
        [ScreenRoute.exact("/shopify") { ShopifyScreen() }]
    }
}
