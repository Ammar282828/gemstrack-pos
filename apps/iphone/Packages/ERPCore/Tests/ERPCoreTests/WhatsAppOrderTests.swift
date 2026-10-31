import XCTest
@testable import ERPCore

/// The chip a web order's WhatsApp state puts on its invoice: the web's `whatsappOrderChip` (src/lib/shopify-whatsapp.ts),
/// word for word and tone for tone, so the ERP, the iPhone and the Mac say the same thing.
final class WhatsAppOrderTests: XCTestCase {
    func testEveryStateSaysWhatTheWebSays() {
        let web: [(String, String, String)] = [
            ("awaiting-confirmation", "Awaiting confirmation", "working"),
            ("confirmed", "Confirmed on WhatsApp", "settled"),
            ("declined", "Cancel requested", "late"),
            ("awaiting-payment", "Awaiting transfer", "working"),
            ("slip-received", "Screenshot sent", "owed"),
            ("paid", "Paid \u{00B7} thanked on WhatsApp", "settled"),
            ("sent", "Thanked on WhatsApp", "quiet"),
            ("failed", "WhatsApp did not send", "late"),
            ("no-whatsapp", "No WhatsApp", "late"),
        ]
        for (state, label, tone) in web {
            let chip = WhatsAppOrder.chip(state)
            XCTAssertEqual(chip?.label, label, state)
            XCTAssertEqual(chip?.tone, tone, state)
        }
    }

    func testNoChipForNothingOrAStateTheErpDoesNotShow() {
        XCTAssertNil(WhatsAppOrder.chip(nil))
        XCTAssertNil(WhatsAppOrder.chip(""))
        XCTAssertNil(WhatsAppOrder.chip("something-new"))
    }

    func testTheInvoiceReadsItsWhatsAppState() {
        let inv = ERPDecode.model(Invoice.self, from: ["id": "INV-1", "whatsappOrder": ["state": "declined", "at": "2026-10-30T10:00:00Z"]])!
        XCTAssertEqual(inv.whatsappOrder?.state, "declined")
        XCTAssertEqual(inv.whatsappOrder?.chip?.label, "Cancel requested")
        let shop = ERPDecode.model(Invoice.self, from: ["id": "INV-2"])!
        XCTAssertNil(shop.whatsappOrder, "a sale made in the shop has no WhatsApp state")
        let odd = ERPDecode.model(Invoice.self, from: ["id": "INV-3", "whatsappOrder": "confirmed"])!
        XCTAssertNil(odd.whatsappOrder, "a malformed field reads as none, never fails the invoice")
    }
}
