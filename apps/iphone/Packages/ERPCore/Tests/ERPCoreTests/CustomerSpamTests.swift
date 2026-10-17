import XCTest
@testable import ERPCore

/// src/lib/customer-spam.test.ts, case for case. All names and addresses made up.
final class CustomerSpamTests: XCTestCase {
    private func customer(_ id: String, _ name: String, email: String? = nil, phone: String? = nil, address: String? = nil) -> Customer {
        var fields: [String: Any] = ["id": id, "name": name]
        if let email { fields["email"] = email }
        if let phone { fields["phone"] = phone }
        if let address { fields["address"] = address }
        return ERPDecode.model(Customer.self, from: fields)!
    }

    func testTokenGibberishScoreScoresCamelNoiseCaseFlipsConsonantRunsAndFewVowels() {
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("A"), 0)
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("Ayesha"), 0)
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("ABajEyYE"), 4) // 2 internal caps + 5 flips
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("Strk"), 2) // a run of four consonants
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("xKqZpW"), 9) // 3 internal caps + flips + run + no vowels
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("McDonald"), 1)
        XCTAssertEqual(CustomerSpam.tokenGibberishScore("Rhythm"), 4) // run + 0 vowels in 6 letters
    }

    func testIsGibberishNameFlagsANameWhoseTokensScoreThreeOrMore() {
        XCTAssertFalse(CustomerSpam.isGibberishName(""))
        XCTAssertFalse(CustomerSpam.isGibberishName("   "))
        XCTAssertFalse(CustomerSpam.isGibberishName("Ayesha Demo"))
        XCTAssertFalse(CustomerSpam.isGibberishName("Sara McDonald"))
        XCTAssertTrue(CustomerSpam.isGibberishName("ABajEyYE"))
        XCTAssertTrue(CustomerSpam.isGibberishName("  qWrTzX   hJkLmN "))
        XCTAssertFalse(CustomerSpam.isGibberishName("Strk Demo"))
        XCTAssertTrue(CustomerSpam.isGibberishName("Strk Brrk"))
    }

    func testIsRandomEmailLocalLooksOnlyAtALongLocalPartIgnoringDotsDashesAndUnderscores() {
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal(nil))
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal(""))
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal("bcdfghjk@example.com")) // under 12
        XCTAssertTrue(CustomerSpam.isRandomEmailLocal("xkqzpwtrmn12@example.com")) // a run of five consonants
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal("ayesha.demo.person@example.com"))
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal("ab.ca.da.fa.ga.ha@example.com")) // vowels half the letters
        XCTAssertTrue(CustomerSpam.isRandomEmailLocal("a1b2c3d4e5f6g7h8@example.com")) // 2 of 8 letters: 0.25 → random
    }

    func testIsRandomEmailLocalCountsDigitsOutOfTheLettersAndALocalPartOfNoLettersAsOne() {
        XCTAssertFalse(CustomerSpam.isRandomEmailLocal("bac1dac2fac3gac4@example.com"))
        XCTAssertTrue(CustomerSpam.isRandomEmailLocal("123456789012@example.com")) // 0 / 1 < 0.28
        XCTAssertTrue(CustomerSpam.isRandomEmailLocal("b1c2d3a4f5g6@example.com")) // 1 of 6 letters
    }

    func testTransactedIdsTakeOrdersInvoicesAndOnlyCustomersHisaabRows() {
        let ids = CustomerSpam.transactedIds(
            orderCustomerIds: ["c1", nil, nil],
            invoiceCustomerIds: ["c2", ""],
            hisaabCustomerIds: ["c3", ""]
        )
        XCTAssertEqual(ids.sorted(), ["c1", "c2", "c3"])
        // From the books' own rows: a karigar's hisaab is not a customer's history.
        let orders = [ERPDecode.model(Order.self, from: ["id": "o1", "customerId": "c1"])!, ERPDecode.model(Order.self, from: ["id": "o2"])!]
        let invoices = [ERPDecode.model(Invoice.self, from: ["id": "i1", "customerId": "c2"])!, ERPDecode.model(Invoice.self, from: ["id": "i2", "customerId": ""])!]
        let hisaab = [
            ERPDecode.model(HisaabEntry.self, from: ["id": "h1", "entityType": "customer", "entityId": "c3"])!,
            ERPDecode.model(HisaabEntry.self, from: ["id": "h2", "entityType": "karigar", "entityId": "c4"])!,
            ERPDecode.model(HisaabEntry.self, from: ["id": "h3", "entityType": "customer"])!,
        ]
        XCTAssertEqual(CustomerSpam.transactedIds(orders: orders, invoices: invoices, hisaab: hisaab).sorted(), ["c1", "c2", "c3"])
    }

    func testDetectFlagsABotWithItsReasons() {
        let bot = customer("b1", "ABajEyYE qWrTzX", email: "xkqzpwtrmn12@example.com")
        XCTAssertEqual(CustomerSpam.detect([bot], transacted: []), [
            CustomerSpam.Candidate(customer: bot, reasons: ["Gibberish name", "Random email", "No phone / address / orders"]),
        ])
        let nameOnly = customer("b2", "ABajEyYE")
        XCTAssertEqual(CustomerSpam.detect([nameOnly], transacted: []).first?.reasons, ["Gibberish name", "No phone / address / orders"])
        let emailOnly = customer("b3", "Demo Person", email: "xkqzpwtrmn12@example.com")
        XCTAssertEqual(CustomerSpam.detect([emailOnly], transacted: []).first?.reasons, ["Random email", "No phone / address / orders"])
    }

    func testDetectNeverFlagsAnyoneWithAPhoneAnAddressOrAnyHistoryNorAPlainName() {
        let name = "ABajEyYE qWrTzX", email = "xkqzpwtrmn12@example.com"
        XCTAssertEqual(CustomerSpam.detect([customer("b1", name, email: email, phone: "03000000000")], transacted: []), [])
        XCTAssertEqual(CustomerSpam.detect([customer("b1", name, email: email, address: "Demo Street 1")], transacted: []), [])
        XCTAssertEqual(CustomerSpam.detect([customer("b1", name, email: email)], transacted: ["b1"]), [])
        XCTAssertEqual(CustomerSpam.detect([customer("p1", "Ayesha Demo", email: "ayesha.demo@example.com")], transacted: []), [])
        // Blank phone and address are none.
        XCTAssertEqual(CustomerSpam.detect([customer("b1", name, email: email, phone: "  ", address: " ")], transacted: []).count, 1)
    }
}
