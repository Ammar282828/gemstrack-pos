import XCTest
@testable import ERPCore

/// The Shopify section's predicate and its stages (made-up orders only).
final class ShopifyOrderTests: XCTestCase {
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }

    func testASourceStartingWithShopifyIsAShopifyOrder() {
        XCTAssertTrue(invoice(["source": "shopify"]).isShopifyOrder)
        XCTAssertTrue(invoice(["source": "shopify_import"]).isShopifyOrder)
        XCTAssertFalse(invoice(["source": "pos"]).isShopifyOrder)
        XCTAssertFalse(invoice([:]).isShopifyOrder)
    }

    func testTheWhatsAppStateDecidesToConfirmAndCancelled() {
        XCTAssertEqual(invoice(["source": "shopify", "whatsappOrder": ["state": "awaiting-confirmation"]]).shopifyStage, .toConfirm)
        XCTAssertEqual(invoice(["source": "shopify", "whatsappOrder": ["state": "declined"]]).shopifyStage, .cancelled)
        XCTAssertEqual(invoice(["source": "shopify", "whatsappOrder": ["state": "confirmed"]]).shopifyStage, .other)
        XCTAssertEqual(invoice(["source": "shopify"]).shopifyStage, .other)
    }

    func testShopifysOwnCancelIsCancelled() {
        XCTAssertEqual(invoice(["source": "shopify", "shopifyCancelledAt": "2026-11-01T10:00:00.000Z"]).shopifyStage, .cancelled)
    }
}

/// Shopify web orders as ERP orders.
final class ShopifyOrderAsOrderTests: XCTestCase {
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    func testAnOrderIsShopifyByItsIdOrItsSource() {
        XCTAssertTrue(order(["id": "SHOPIFY-1001", "source": "shopify"]).isShopifyOrder)
        XCTAssertTrue(order(["id": "ORD-000001", "source": "shopify"]).isShopifyOrder)
        XCTAssertTrue(order(["id": "SHOPIFY-1002"]).isShopifyOrder)
        XCTAssertFalse(order(["id": "ORD-000002", "source": "walkin"]).isShopifyOrder)
        XCTAssertFalse(order(["id": "ORD-000003"]).isShopifyOrder)
    }

    func testItsWhatsAppStateAndStatusGiveItsStage() {
        XCTAssertEqual(order(["id": "SHOPIFY-1", "whatsappOrder": ["state": "awaiting-confirmation"]]).shopifyStage, .toConfirm)
        XCTAssertEqual(order(["id": "SHOPIFY-1", "whatsappOrder": ["state": "declined"]]).shopifyStage, .cancelled)
        XCTAssertEqual(order(["id": "SHOPIFY-1", "status": "Cancelled"]).shopifyStage, .cancelled)
        XCTAssertEqual(order(["id": "SHOPIFY-1", "whatsappOrder": ["state": "confirmed"]]).shopifyStage, .other)
    }
}
