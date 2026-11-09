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

/// Which old Shopify invoices can become orders.
final class ShopifyConvertibleTests: XCTestCase {
    private func invoice(_ extra: [String: Any]) -> Invoice {
        var f: [String: Any] = ["id": "SHOPIFY-1001", "source": "shopify"]
        for (k, v) in extra { f[k] = v }
        return ERPDecode.model(Invoice.self, from: f)!
    }

    func testAnOpenShopifyInvoiceCanBeConverted() {
        XCTAssertTrue(invoice([:]).isConvertibleShopifyInvoice)
        XCTAssertTrue(invoice(["shopifyFulfillment": "unfulfilled"]).isConvertibleShopifyInvoice)
        XCTAssertTrue(invoice(["shopifyFulfillment": "partial"]).isConvertibleShopifyInvoice)
        XCTAssertTrue(invoice(["source": "shopify_import"]).isConvertibleShopifyInvoice)
    }

    func testFulfilledMadeFromAnOrderCancelledOrRefundedCannot() {
        XCTAssertFalse(invoice(["shopifyFulfillment": "fulfilled"]).isConvertibleShopifyInvoice)
        XCTAssertFalse(invoice(["sourceOrderId": "ORD-000001"]).isConvertibleShopifyInvoice)
        XCTAssertFalse(invoice(["shopifyCancelledAt": "2026-11-01T10:00:00.000Z"]).isConvertibleShopifyInvoice)
        XCTAssertFalse(invoice(["status": "Refunded"]).isConvertibleShopifyInvoice)
        XCTAssertFalse(invoice(["shopifyFinancialStatus": "refunded"]).isConvertibleShopifyInvoice)
        XCTAssertFalse(invoice(["source": "pos"]).isConvertibleShopifyInvoice)
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

/// The parcel's words, tone and line, and the three fields on the models (made-up numbers only).
final class ShopifyDeliveryTests: XCTestCase {
    func testTheWordsAreTheWebs() {
        XCTAssertEqual(ShopifyDelivery.label("delivered", company: "TCS"), "Delivered")
        XCTAssertEqual(ShopifyDelivery.label("returned", company: nil), "Returned")
        XCTAssertEqual(ShopifyDelivery.label("attempted", company: nil), "Delivery attempted")
        XCTAssertEqual(ShopifyDelivery.label("out_for_delivery", company: nil), "Out for delivery")
        XCTAssertEqual(ShopifyDelivery.label("in_transit", company: "TCS"), "With TCS")
        XCTAssertEqual(ShopifyDelivery.label("in_transit", company: "  "), "With courier")
        XCTAssertEqual(ShopifyDelivery.label("in_transit", company: nil), "With courier")
        XCTAssertEqual(ShopifyDelivery.label("shipped", company: "TCS"), "Shipped")
        XCTAssertNil(ShopifyDelivery.label("unfulfilled", company: "TCS"))
        XCTAssertNil(ShopifyDelivery.label(nil, company: nil))
        XCTAssertNil(ShopifyDelivery.label("whatever", company: nil))
    }

    func testTones() {
        XCTAssertEqual(ShopifyDelivery.tone("delivered"), .positive)
        XCTAssertEqual(ShopifyDelivery.tone("returned"), .negative)
        XCTAssertEqual(ShopifyDelivery.tone("attempted"), .warning)
        XCTAssertEqual(ShopifyDelivery.tone("in_transit"), .neutral)
        XCTAssertEqual(ShopifyDelivery.tone("shipped"), .neutral)
        XCTAssertEqual(ShopifyDelivery.chip("delivered", company: nil), ShopifyDeliveryChip(label: "Delivered", tone: .positive))
        XCTAssertNil(ShopifyDelivery.chip("unfulfilled", company: nil))
    }

    func testTheLineHasTheNumberAndTheDayOnceItEnded() {
        let t = ShopifyTracking.from(company: "TCS", number: "100000000001")
        XCTAssertEqual(ShopifyDelivery.line("delivered", tracking: t, at: "2026-11-06T10:00:00.000Z"), "Delivered \u{00B7} TCS 100000000001 \u{00B7} 6 Nov")
        XCTAssertEqual(ShopifyDelivery.line("in_transit", tracking: t, at: "2026-11-06T10:00:00.000Z"), "With TCS \u{00B7} TCS 100000000001")
        XCTAssertEqual(ShopifyDelivery.line("shipped", tracking: nil, at: nil), "Shipped")
        XCTAssertNil(ShopifyDelivery.line("unfulfilled", tracking: t, at: nil))
    }

    func testTheModelsReadTheFields() {
        let fields: [String: Any] = [
            "shopifyDelivery": "delivered",
            "shopifyTracking": ["company": "TCS", "number": "100000000001"],
            "shopifyDeliveryAt": "2026-11-06T10:00:00.000Z",
        ]
        let inv = ERPDecode.model(Invoice.self, from: fields.merging(["id": "SHOPIFY-1", "source": "shopify"]) { a, _ in a })!
        XCTAssertEqual(inv.shopifyDelivery, "delivered")
        XCTAssertEqual(inv.shopifyTracking?.company, "TCS")
        XCTAssertEqual(inv.shopifyTracking?.number, "100000000001")
        XCTAssertEqual(inv.shopifyDeliveryAt, "2026-11-06T10:00:00.000Z")
        XCTAssertEqual(inv.shopifyDeliveryChip?.label, "Delivered")
        let order = ERPDecode.model(Order.self, from: fields.merging(["id": "SHOPIFY-2"]) { a, _ in a })!
        XCTAssertEqual(order.shopifyDelivery, "delivered")
        XCTAssertEqual(order.shopifyDeliveryLine, "Delivered \u{00B7} TCS 100000000001 \u{00B7} 6 Nov")
        let bare = ERPDecode.model(Order.self, from: ["id": "SHOPIFY-3"])!
        XCTAssertNil(bare.shopifyDelivery)
        XCTAssertNil(bare.shopifyTracking)
        XCTAssertNil(bare.shopifyDeliveryChip)
        // An odd tracking value is nil, never a failure.
        XCTAssertNotNil(ERPDecode.model(Order.self, from: ["id": "SHOPIFY-4", "shopifyTracking": "x"]))
    }
}

private extension ShopifyTracking {
    static func from(company: String, number: String) -> ShopifyTracking {
        ERPDecode.model(ShopifyTracking.self, from: ["company": company, "number": number])!
    }
}
