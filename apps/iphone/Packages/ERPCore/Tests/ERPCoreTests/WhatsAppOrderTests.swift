import XCTest
@testable import ERPCore

/// src/lib/shopify-whatsapp.ts `whatsappOrderChip`.
final class WhatsAppOrderTests: XCTestCase {
    func testEveryStateMapsAsTheWebDoes() {
        let expected: [(String, String, WhatsAppOrderTone)] = [
            ("awaiting-confirmation", "Awaiting confirmation", .working),
            ("confirmed", "Confirmed on WhatsApp", .settled),
            ("declined", "Cancel requested", .late),
            ("awaiting-payment", "Awaiting transfer", .working),
            ("slip-received", "Screenshot sent", .owed),
            ("paid", "Paid \u{00B7} thanked on WhatsApp", .settled),
            ("sent", "Thanked on WhatsApp", .quiet),
            ("failed", "WhatsApp did not send", .late),
            ("no-whatsapp", "No WhatsApp", .late),
        ]
        for (state, label, tone) in expected {
            XCTAssertEqual(whatsappOrderChip(state), WhatsAppOrderChip(label: label, tone: tone), state)
        }
    }

    func testNoStateOrAnUnknownOneIsNoChip() {
        XCTAssertNil(whatsappOrderChip(nil))
        XCTAssertNil(whatsappOrderChip(""))
        XCTAssertNil(whatsappOrderChip("something-new"))
    }

    private func invoice(_ extra: String) -> Invoice {
        try! JSONDecoder().decode(Invoice.self, from: Data(#"{"id":"INV-000001","customerName":"Sana Example"\#(extra)}"#.utf8))
    }

    func testInvoiceReadsTheStateAndToleratesItsAbsenceOrOddShapes() {
        XCTAssertEqual(invoice(#","whatsappOrder":{"state":"confirmed"}"#).whatsappOrder?.state, "confirmed")
        XCTAssertNil(invoice("").whatsappOrder)
        XCTAssertNil(invoice(#","whatsappOrder":{}"#).whatsappOrder?.state)
        XCTAssertNil(invoice(#","whatsappOrder":{"state":5}"#).whatsappOrder?.state)
        XCTAssertNil(invoice(#","whatsappOrder":"oops""#).whatsappOrder?.state)
    }
}
