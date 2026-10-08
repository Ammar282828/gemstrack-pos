import XCTest
@testable import ERPCore

/// src/lib/walk-in.test.ts, case for case. The book is made up: the TS one is the shape of a real
/// one (a number shared by two people, one person twice), and these names and numbers are not.
final class WalkInTests: XCTestCase {
    private func customer(_ id: String, _ name: String, _ phone: String? = nil) -> Customer {
        var fields: [String: Any] = ["id": id, "name": name]
        if let phone { fields["phone"] = phone }
        return ERPDecode.model(Customer.self, from: fields)!
    }

    private lazy var book: [Customer] = [
        customer("cust-zoya", "Zoya Example", "+923000000101"),
        customer("cust-maria-2", "Maria Sample", "+923000000202"),
        customer("cust-maria-1", "maria  sample", "03000000202"),
        customer("cust-tasneem", "Tasneem Test", "+923000000303"),
        customer("cust-ummehani", "Ummehani Test", "+923000000303"),
        customer("cust-noPhone", "Batool Placeholder"),
        customer("cust-walkin-old", "Walk-in Customer", ""),
    ]

    // MARK: isWalkInName

    func testThePlaceholderInAnySpellingTheCounterOrOldCodeUsed() {
        for n in ["Walk-in Customer", "walk-in customer", "Walk-in", "walk in", "Walkin", "  Walk-In  Customer "] {
            XCTAssertTrue(isWalkInName(n), n)
        }
    }

    func testARealNameANumberOnThePlaceholderOrNothingIsNotThePlaceholder() {
        for n in ["Walk-in Customer - 03000000101", "Walker", "Zoya", ""] {
            XCTAssertFalse(isWalkInName(n), n)
        }
        XCTAssertFalse(isWalkInName(nil))
    }

    // MARK: phoneKey

    func testLocalInternationalAndBareFormsOfOneNumberAgree() {
        XCTAssertEqual(phoneKey("0300 0000101"), "3000000101")
        XCTAssertEqual(phoneKey("+92 300-0000101"), "3000000101")
        XCTAssertEqual(phoneKey("923000000101"), "3000000101")
    }

    func testTooFewDigitsIsNoNumber() {
        XCTAssertEqual(phoneKey("12345"), "")
        XCTAssertEqual(phoneKey(nil), "")
    }

    // MARK: resolveSaleCustomer

    func testNothingTypedAWalkInAndNoCustomerIsMade() {
        XCTAssertEqual(resolveSaleCustomer(customers: book), SaleCustomer(name: WALK_IN_NAME, phone: "", isNew: false))
        XCTAssertFalse(resolveSaleCustomer(typedName: "  ", typedPhone: " ", customers: book).isNew)
    }

    func testAnEditedWalkInInvoicePutsThePlaceholderBackInTheNameBoxStillAWalkIn() {
        let r = resolveSaleCustomer(typedName: "Walk-in Customer", customers: book)
        XCTAssertEqual(r, SaleCustomer(name: WALK_IN_NAME, phone: "", isNew: false))
        XCTAssertFalse(shouldCreateCustomer(r))
    }

    func testAPickedCustomerIsThatCustomerWithTheirNumber() {
        XCTAssertEqual(
            resolveSaleCustomer(selectedId: "cust-zoya", typedName: "Zoya Example", typedPhone: "", customers: book),
            SaleCustomer(id: "cust-zoya", name: "Zoya Example", phone: "+923000000101", isNew: false)
        )
    }

    func testAPickedCustomerWithNoNumberOnFileTakesTheOneTyped() {
        XCTAssertEqual(resolveSaleCustomer(selectedId: "cust-noPhone", typedPhone: "03000000555", customers: book).phone, "03000000555")
    }

    func testAPickedIdThisDeviceHasNotLoadedIsKeptForGenerateInvoiceToRead() {
        XCTAssertEqual(
            resolveSaleCustomer(selectedId: "cust-elsewhere", typedName: "Someone", customers: book),
            SaleCustomer(id: "cust-elsewhere", name: "Someone", phone: "", isNew: false)
        )
    }

    func testAPickedLeftoverWalkInCustomerIsLetGoOfNotKept() {
        let r = resolveSaleCustomer(selectedId: "cust-walkin-old", typedName: "Walk-in Customer", customers: book)
        XCTAssertNil(r.id)
        XCTAssertFalse(r.isNew)
    }

    func testALeftoverWalkInCustomerWithANumberTypedBecomesThePersonTheNumberSays() {
        XCTAssertEqual(
            resolveSaleCustomer(selectedId: "cust-walkin-old", typedName: "Walk-in Customer", typedPhone: "0300 0000101", customers: book).id,
            "cust-zoya"
        )
    }

    func testATypedNameIsANewCustomer() {
        XCTAssertEqual(
            resolveSaleCustomer(typedName: "  Sana Example ", customers: book),
            SaleCustomer(name: "Sana Example", phone: "", isNew: true)
        )
    }

    func testANumberAloneThatNobodyHasIsANewCustomerNamedByItAsBefore() {
        let r = resolveSaleCustomer(typedPhone: "03000009999", customers: book)
        XCTAssertEqual(r, SaleCustomer(name: "Walk-in Customer - 03000009999", phone: "03000009999", isNew: true))
        XCTAssertTrue(shouldCreateCustomer(r))
    }

    func testANumberOnFileNoNameTypedThatCustomerNotACopy() {
        XCTAssertEqual(resolveSaleCustomer(typedPhone: "0300-0000101", customers: book).id, "cust-zoya")
    }

    func testANumberOnFileWithTheirNameTypedAnyCaseOrSpacingThatCustomer() {
        XCTAssertEqual(resolveSaleCustomer(typedName: "zoya  example", typedPhone: "+923000000101", customers: book).id, "cust-zoya")
    }

    func testTheSamePersonTwiceAlreadyTheFirstOfThemNeverAThird() {
        XCTAssertEqual(resolveSaleCustomer(typedName: "Maria Sample", typedPhone: "03000000202", customers: book).id, "cust-maria-1")
        XCTAssertEqual(resolveSaleCustomer(typedPhone: "03000000202", customers: book).id, "cust-maria-1")
    }

    func testANumberOnFileUnderAnotherNameIsLeftAloneTwoPeopleCanShareAPhone() {
        XCTAssertEqual(
            resolveSaleCustomer(typedName: "Zainab Example", typedPhone: "03000000101", customers: book),
            SaleCustomer(name: "Zainab Example", phone: "03000000101", isNew: true)
        )
    }

    func testANumberTwoDifferentPeopleShareNoNameTypedNeitherIsGuessed() {
        let r = resolveSaleCustomer(typedPhone: "03000000303", customers: book)
        XCTAssertNil(r.id)
        XCTAssertTrue(r.isNew)
    }

    func testANameAloneIsNeverMatchedToSomeoneInTheBookThatIsAGuess() {
        XCTAssertNil(resolveSaleCustomer(typedName: "Batool Placeholder", customers: book).id)
    }

    // MARK: shouldCreateCustomer

    func testOnlyAnIdLessRealName() {
        XCTAssertTrue(shouldCreateCustomer(name: "Sana Example"))
        XCTAssertFalse(shouldCreateCustomer(id: "cust-zoya", name: "Zoya"))
        XCTAssertFalse(shouldCreateCustomer(name: WALK_IN_NAME))
        XCTAssertFalse(shouldCreateCustomer(name: ""))
    }

    // MARK: saleCustomerKey

    private var names: [String: String] { Dictionary(uniqueKeysWithValues: book.map { ($0.id, $0.name) }) }

    func testACustomerIsKeyedByTheirId() {
        XCTAssertEqual(saleCustomerKey(customerId: "cust-zoya", customerName: "Zoya Example", currentName: { self.names[$0] }), "cust-zoya")
    }

    func testANameWithNoAccountIsKeyedByTheName() {
        XCTAssertEqual(saleCustomerKey(customerName: "Shopify Buyer"), "name:Shopify Buyer")
    }

    func testEveryShapeOfWalkInIsTheOneWalkInRow() {
        XCTAssertEqual(saleCustomerKey(), WALK_IN_ENTITY)
        XCTAssertEqual(saleCustomerKey(customerName: "Walk-in Customer"), WALK_IN_ENTITY)
        XCTAssertEqual(saleCustomerKey(customerId: WALK_IN_ENTITY, customerName: "Walk-in Customer"), WALK_IN_ENTITY)
        XCTAssertEqual(
            saleCustomerKey(customerId: "cust-walkin-old", customerName: "Walk-in Customer", currentName: { self.names[$0] }),
            WALK_IN_ENTITY
        )
    }

    func testAnOldWalkInCustomerSinceRenamedToARealPersonCountsAsThatPerson() {
        XCTAssertEqual(saleCustomerKey(customerId: "cust-old", customerName: "Walk-in Customer", currentName: { _ in "Test Person" }), "cust-old")
    }

    func testACustomerNoLongerInTheBookFallsBackToTheNameOnTheSale() {
        XCTAssertEqual(saleCustomerKey(customerId: "cust-gone", customerName: "Walk-in Customer", currentName: { self.names[$0] }), WALK_IN_ENTITY)
        XCTAssertEqual(saleCustomerKey(customerId: "cust-gone", customerName: "Hamid Test", currentName: { self.names[$0] }), "cust-gone")
    }

    // Not in the TS tests: the same key from the documents themselves.
    func testTheKeyOfAnInvoiceAndOfAnOrder() {
        let invoice = ERPDecode.model(Invoice.self, from: ["customerId": "c1", "customerName": "Sana Example"])!
        let order = ERPDecode.model(Order.self, from: ["customerName": "Fatima Sample"])!
        XCTAssertEqual(saleCustomerKey(invoice), "c1")
        XCTAssertEqual(saleCustomerKey(order), "name:Fatima Sample")
    }
}
