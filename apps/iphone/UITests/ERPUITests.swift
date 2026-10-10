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
        "/orders/ORD-D0002/edit", "/invoices/INV-D0002/edit", "/orders/ORD-D0002/finalize",
        "/customers/CUST-D06/edit", "/karigars/add", "/karigars/KAR-D1/edit",
        "/drafts", "/calendar", "/activity-log", "/my-work?preview=KAR-D1",
        "/products/add", "/products/RNG-D110/edit", "/overheads", "/shareholders", "/settings/recently-removed",
        "/settings", "/app/settings/shop", "/settings/alerts", "/settings/payment-methods", "/settings/data",
        "/posts", "/marketing/pieces", "/marketing/website", "/ads", "/ads/campaigns",
        "/orders/online", "/orders/ORD-D0002/slip", "/products/bulk-add", "/invoices/new?scan=bill", "/orders/add?scan=parchi",
        "/ads/new", "/ads/adset", "/ads/audiences", "/ads/rules", "/ads/setup",
        "/website/photos", "/website/edit", "/website/weights", "/website/investments", "/website/from-site",
        "/settings/voice", "/settings/printer", "/settings/weprint-api", "/settings/backups", "/settings/contact-import",
        "/settings/hisaab-import",
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

    func testWorkshopEmptyQueueKeepsFiltersReachable() {
        let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", "/workshop"])
        app.launch()
        let chips = app.scrollViews["workshop.focus"]
        XCTAssertTrue(chips.waitForExistence(timeout: 8))
        chips.swipeLeft()
        let toGive = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'To give'")).firstMatch
        XCTAssertTrue(toGive.waitForExistence(timeout: 5))
        toGive.tap()
        XCTAssertTrue(app.staticTexts["Everything assigned has been given"].waitForExistence(timeout: 5))
        chips.swipeRight()
        let all = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'All work'")).firstMatch
        all.tap()
        XCTAssertTrue(app.buttons["Actions for Plain band, matte finish"].waitForExistence(timeout: 5))
    }

    func testWorkshopJobMenuExposesItsActions() {
        let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", "/workshop"])
        app.launch()
        let actions = app.buttons["Actions for Plain band, matte finish"]
        XCTAssertTrue(actions.waitForExistence(timeout: 8))
        actions.tap()
        XCTAssertTrue(app.buttons["Open ORD-D0001"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Mark done"].exists)
        XCTAssertTrue(app.buttons["Details in the ERP"].exists)
    }

    func testWorkshopAssignStockOpensItsNativeForm() {
        let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", "/workshop"])
        app.launch()
        let add = app.buttons["Assign stock work"]
        XCTAssertTrue(add.waitForExistence(timeout: 8))
        add.tap()
        XCTAssertTrue(app.navigationBars["Assign Stock Work"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Assign"].exists)
        XCTAssertFalse(app.buttons["Assign"].isEnabled, "Work and a karigar are required before assigning")
        XCTAssertTrue(app.textFields["0.000"].exists)
    }

    func testWorkshopGivenItemHasAVisibleEditAction() {
        let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", "/given"])
        app.launch()
        let actions = app.buttons["Actions for Old bangle to melt, 18.2 g"]
        XCTAssertTrue(actions.waitForExistence(timeout: 8))
        actions.tap()
        let edit = app.buttons["Edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()
        XCTAssertTrue(app.navigationBars["Edit Given Item"].waitForExistence(timeout: 5))
        scrollable(app).swipeUp()
        let giver = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Given by'")).firstMatch
        XCTAssertTrue(giver.waitForExistence(timeout: 5) || app.textFields["Given by"].exists)
    }

    func testWorkshopKarigarKeepsPaymentsReachable() {
        let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", "/karigars/KAR-D1"])
        app.launch()
        let accounts = app.buttons["Payments & khata"]
        XCTAssertTrue(accounts.waitForExistence(timeout: 8))
        accounts.tap()
        let add = app.buttons["Add payment"]
        let list = scrollable(app)
        for _ in 0..<5 {
            if add.exists && add.isHittable { break }
            list.swipeUp()
        }
        XCTAssertTrue(add.exists, "The existing pay batch remains available")
        XCTAssertTrue(app.buttons["Silver"].exists)
        XCTAssertTrue(app.buttons["Settle"].exists)
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
        let pieces = app.buttons["Step 2 of 4: Pieces"]
        XCTAssertTrue(pieces.waitForExistence(timeout: 8))
        pieces.tap()
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
        // The box gives way to the customer, with Change (found by its words: a list row may read as one element).
        let change = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Change'")).firstMatch
        let picked = change.waitForExistence(timeout: 4) && name.waitForNonExistence(timeout: 2)
        if !picked { print(app.debugDescription) }
        XCTAssertTrue(picked, "\(place) shows Sana Demo picked, with Change; the name box " +
                      (name.exists ? "still holds '\(name.value as? String ?? "")'" : "is gone") +
                      (change.exists ? "" : ", and nothing reads Change"))
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testANewSaleOffersTheBookAsTheNameIsTyped() { pickByTyping("/invoices/new", tab: "invoices") }

    /// Edit order and Edit invoice are the New forms opened on what is on file, saved as changes.
    private func editOpens(_ place: String, tab: String) {
        let app = demo(["-ERPDemoTab", tab, "-ERPDemoOpen", place])
        app.launch()
        let review = app.buttons["Step 4 of 4: Review"]
        XCTAssertTrue(review.waitForExistence(timeout: 10))
        review.tap()
        let save = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Save changes'")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 10), "\(place) opens the form with Save changes")
        XCTAssertFalse(app.buttons["Start over"].exists, "\(place) has no Start over: the record on file is the copy")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testEditingAnOrderOpensItsForm() { editOpens("/orders/ORD-D0002/edit", tab: "orders") }

    func testEditingAnInvoiceOpensItsForm() { editOpens("/invoices/INV-D0002/edit", tab: "invoices") }

    func testANewOrderOffersTheBookAsTheNameIsTyped() { pickByTyping("/orders/add", tab: "orders") }

    /// Moving through the new flow must keep the customer's unsaved details in both forms.
    func testEntryStepsKeepCustomerDetails() {
        for place in ["/orders/add", "/invoices/new"] {
            let app = demo(["-ERPDemoTab", "home", "-ERPDemoOpen", place])
            app.launch()
            let customer = app.buttons["Step 1 of 4: Customer"]
            XCTAssertTrue(customer.waitForExistence(timeout: 10))
            let name = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Search or type a new name'")).firstMatch
            if !name.exists && app.buttons["Change"].exists { app.buttons["Change"].tap() }
            XCTAssertTrue(name.waitForExistence(timeout: 5))
            name.tap()
            name.typeText("Flow Check")
            let entered = name.value as? String
            for step in ["Step 2 of 4: Pieces", "Step 3 of 4: Payment", "Step 4 of 4: Review"] {
                app.buttons[step].tap()
                XCTAssertEqual(app.state, .runningForeground)
            }
            customer.tap()
            XCTAssertEqual(name.value as? String, entered, "\(place) keeps the customer between steps")
            app.terminate()
        }
    }

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
