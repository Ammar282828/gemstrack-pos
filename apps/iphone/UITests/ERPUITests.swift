import XCTest

/// The demo build (`-ERPDemo YES`: made-up books, no server, nothing can be saved) driven as a person
/// would: every native place opens and the app stays up, the tabs and the sheets used most open, and
/// launch and scrolling are timed, at today's size and at about ten times the real books.
///
/// Run on the Mac check when a commit's message carries "[ui]" (.github/workflows/iphone-native.yml).
final class ERPUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func demo(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-ERPDemo", "YES"] + extra
        return app
    }

    /// Every place with a native screen, and one of each kind of page behind a list.
    static let places = [
        "/today", "/new", "/invoices/new", "/orders/add", "/scan", "/products", "/repairs",
        "/workshop", "/karigars", "/karigars/KAR-D1", "/given",
        "/expenses", "/additional-revenue", "/hisaab", "/hisaab/KAR-D1?type=karigar",
        "/analytics", "/analytics/sales", "/analytics/products", "/analytics/customers", "/analytics/categories",
        "/invoices/INV-D0002", "/orders/ORD-D0002", "/customers/CUST-D06", "/app/phone",
    ]

    func testEveryPlaceOpensAndTheAppStaysUp() {
        for place in Self.places {
            let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", place])
            app.launch()
            // A native screen draws in a moment; one that crashes takes the app with it.
            _ = app.navigationBars.firstMatch.waitForExistence(timeout: 6)
            sleep(1)
            XCTAssertEqual(app.state, .runningForeground, "\(place) closed the app")
            app.terminate()
        }
    }

    func testTheTabsAndTheSearch() {
        let app = demo()
        app.launch()
        for tab in ["Orders", "Invoices", "Customers", "Home"] {
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.waitForExistence(timeout: 8), "the \(tab) tab")
            button.tap()
            XCTAssertEqual(app.state, .runningForeground, "the \(tab) tab closed the app")
        }
        // Customers' search narrows the list as it is typed.
        app.tabBars.buttons["Customers"].tap()
        let search = app.searchFields.firstMatch
        if search.waitForExistence(timeout: 5) {
            search.tap()
            search.typeText("Demo")
            XCTAssertEqual(app.state, .runningForeground)
        }
    }

    func testTakingAPaymentOpensItsSheet() {
        let app = demo(["-ERPDemoTab", "invoices", "-ERPDemoOpen", "/invoices/INV-D0002"])
        app.launch()
        let take = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Take payment'")).firstMatch
        XCTAssertTrue(take.waitForExistence(timeout: 8), "an unpaid invoice offers Take payment")
        take.tap()
        let amount = app.textFields.firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 5), "the payment sheet asks for an amount")
        amount.tap()
        amount.typeText("1000.50")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testANewOrderPricesAPiece() {
        let app = demo(["-ERPDemoTab", "orders", "-ERPDemoOpen", "/orders/add"])
        app.launch()
        let add = app.buttons["Add a piece"]
        XCTAssertTrue(add.waitForExistence(timeout: 8), "New order offers Add a piece")
        add.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Typing a name offers the book there and then, and a tap makes it that customer (customer-autocomplete.tsx).
    private func pickByTyping(_ place: String, tab: String) {
        let app = demo(["-ERPDemoTab", tab, "-ERPDemoOpen", place])
        app.launch()
        let name = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Search or type a new name'")).firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 8), "\(place) has the customer's name box")
        name.tap()
        name.typeText("san")
        let offer = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Sana Demo'")).firstMatch
        XCTAssertTrue(offer.waitForExistence(timeout: 4), "\(place) offers Sana Demo while 'san' is typed")
        offer.tap()
        XCTAssertTrue(app.buttons["Change"].waitForExistence(timeout: 4), "\(place) shows the customer picked, with Change")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testANewSaleOffersTheBookAsTheNameIsTyped() { pickByTyping("/invoices/new", tab: "invoices") }

    func testANewOrderOffersTheBookAsTheNameIsTyped() { pickByTyping("/orders/add", tab: "orders") }

    // MARK: Speed

    /// A List draws as a collection view, a scroll of cards as a scroll view: whichever the screen has.
    private func scrollable(_ app: XCUIApplication) -> XCUIElement {
        let list = app.collectionViews.firstMatch
        if list.waitForExistence(timeout: 30) { return list }
        return app.scrollViews.firstMatch
    }

    private func iterations(_ n: Int) -> XCTMeasureOptions {
        let o = XCTMeasureOptions()
        o.iterationCount = n
        return o
    }

    /// From a cold start to the dashboard, at today's size.
    func testLaunch() {
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: iterations(3)) {
            demo().launch()
        }
    }

    /// The same with about ten times the real books on the phone (6,000 invoices and orders, 8,000
    /// customers): the dashboard's rules run over all of them.
    func testLaunchAtTenTimesTheBooks() {
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: iterations(3)) {
            demo(["-ERPDemoScale", "1000"]).launch()
        }
    }

    /// A fast flick down the customers at ten times the books: the frames it drops.
    func testScrollingTheCustomersAtTenTimesTheBooks() {
        let app = demo(["-ERPDemoScale", "1000", "-ERPDemoTab", "customers"])
        app.launch()
        let list = scrollable(app)
        XCTAssertTrue(list.waitForExistence(timeout: 30), "the customer list at ten times the books")
        measure(metrics: [XCTOSSignpostMetric.scrollDecelerationMetric], options: iterations(3)) {
            list.swipeUp(velocity: .fast)
        }
    }

    /// The same down the invoices, whose rows each work out what is owed.
    func testScrollingTheInvoicesAtTenTimesTheBooks() {
        let app = demo(["-ERPDemoScale", "1000", "-ERPDemoTab", "invoices"])
        app.launch()
        let list = scrollable(app)
        XCTAssertTrue(list.waitForExistence(timeout: 30), "the invoice list at ten times the books")
        measure(metrics: [XCTOSSignpostMetric.scrollDecelerationMetric], options: iterations(3)) {
            list.swipeUp(velocity: .fast)
        }
    }
}
