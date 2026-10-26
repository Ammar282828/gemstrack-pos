import XCTest

/// The Mac app driven as a person would, in the demo (`-ERPDemo YES`: made-up books, no server, nothing saved): every
/// place and saved list opens and the app stays up, Back and Forward retrace the way, ⌘K opens a record, the counter's
/// three jobs open windows of their own, records open in windows, the inspector, the views, the filters and search, the
/// Settings window's panes, the rate and the business menus, in light and in dark. Each place leaves a screenshot in the
/// test results (App Store Connect → Xcode Cloud → the build → Tests).
///
/// Run by Xcode Cloud's "Mac check" workflow (scheme "ERP Mac", Test, macOS) when a line is added to MAC-CHECKS.md.
final class ERPMacUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    /// The demo, fresh: no window restored from a past run, unless a test asks for it.
    private func demo(_ extra: [String] = [], restoreState: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        // Fresh is fresh: no window restored and no last place remembered from another test (`mac.lastPlace`, read from
        // the arguments before the app's own defaults).
        app.launchArguments = ["-ERPDemo", "YES"]
            + (restoreState ? [] : ["-ApplePersistenceIgnoreState", "YES", "-mac.lastPlace", "/"]) + extra
        return app
    }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = demo(extra)
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 15), "no window after launch")
        return app
    }

    private func row(_ app: XCUIApplication, _ path: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "sidebar." + path).firstMatch
    }

    /// The place the window shows: its title without the subtitle macOS joins to it ("Orders – 6 orders" is "Orders").
    private func title(_ app: XCUIApplication) -> String {
        let whole = app.windows.firstMatch.title
        return whole.components(separatedBy: " \u{2013} ").first ?? whole
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func stillUp(_ app: XCUIApplication, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(app.state, .runningForeground, "\(what) closed the app", file: file, line: line)
        XCTAssertTrue(app.windows.firstMatch.exists, "\(what) left no window", file: file, line: line)
    }

    /// Every place of the owner's sidebar and every saved list, opened at launch, then its screenshot.
    static let places = [
        "/", "/orders", "/invoices", "/repairs", "/customers", "/drafts", "/workshop", "/products", "/posts",
        "/website/photos", "/ads/campaigns", "/expenses", "/analytics", "/orders/online",
        "/orders?list=late", "/orders?list=week", "/orders?list=new", "/orders?list=karigar", "/orders?list=ready",
        "/orders?list=payment", "/invoices?list=unpaid", "/invoices?list=today", "/invoices?list=month",
        "/repairs?list=shop", "/repairs?list=ready", "/repairs?list=collected", "/customers?list=owe",
        "/customers?list=recent", "/karigars", "/given", "/calendar", "/today", "/additional-revenue", "/overheads",
        "/hisaab", "/analytics/sales", "/analytics/products", "/analytics/customers", "/analytics/categories",
        "/design", "/website/edit", "/website/weights", "/ads", "/ads/audiences", "/ads/rules", "/ads/tests",
    ]

    // MARK: Every place

    func testEveryPlaceOpensAndTheAppStaysUp() {
        for place in Self.places {
            let app = launch(["-ERPDemoOpen", place])
            sleep(2)
            stillUp(app, place)
            XCTAssertFalse(title(app).isEmpty, "\(place) has no window title")
            shot(app, "light " + place)
            app.terminate()
        }
    }

    func testEveryPlaceInDark() {
        for place in Self.places {
            let app = launch(["-ERPDemoOpen", place, "-AppleInterfaceStyle", "Dark"])
            sleep(2)
            stillUp(app, "dark " + place)
            shot(app, "dark " + place)
            app.terminate()
        }
    }

    /// The sidebar clicked through, every row it shows, in one run (state carried from page to page, as a person does).
    func testClickingEverySidebarRowInOneRun() {
        let app = launch()
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar./'"))
        let ids = rows.allElementsBoundByIndex.map(\.identifier)
        XCTAssertGreaterThan(ids.count, 10, "the sidebar shows almost nothing")
        var titles = Set<String>()
        for id in ids {
            let r = app.descendants(matching: .any).matching(identifier: id).firstMatch
            guard r.exists, r.isHittable else { continue }
            r.click()
            usleep(600_000)
            stillUp(app, id)
            titles.insert(title(app))
        }
        XCTAssertGreaterThan(titles.count, 8, "clicking rows did not change the page")
    }

    func testTheSameRowTwiceAndAListThenItsPlace() {
        let app = launch()
        row(app, "/orders").click()
        row(app, "/orders").click()
        stillUp(app, "Orders twice")
        XCTAssertEqual(title(app), "Orders")
        row(app, "/orders?list=late").click()
        XCTAssertEqual(title(app), "Late")
        row(app, "/orders").click()
        XCTAssertEqual(title(app), "Orders")
    }

    // MARK: Back and Forward

    func testBackAndForwardRetraceTheWay() {
        let app = launch()
        let start = title(app)
        row(app, "/orders").click()
        row(app, "/invoices").click()
        XCTAssertEqual(title(app), "Invoices")
        app.typeKey("[", modifierFlags: .command)
        XCTAssertEqual(title(app), "Orders")
        app.typeKey("[", modifierFlags: .command)
        XCTAssertEqual(title(app), start)
        app.typeKey("[", modifierFlags: .command)   // nothing further back
        XCTAssertEqual(title(app), start)
        app.typeKey("]", modifierFlags: .command)
        XCTAssertEqual(title(app), "Orders")
        row(app, "/customers").click()               // a new place drops the way forward
        app.typeKey("]", modifierFlags: .command)
        XCTAssertEqual(title(app), "Customers")
        app.buttons["Back"].firstMatch.click()      // the toolbar's ‹
        XCTAssertEqual(title(app), "Orders")
        stillUp(app, "Back and Forward")
    }

    // MARK: Quick Open

    func testQuickOpenFindsAnInvoiceAndOpensIt() {
        let app = launch(["-ERPDemoOpen", "/orders"])
        app.typeKey("k", modifierFlags: .command)
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3), "⌘K showed no field")
        field.typeText("INV-D0002")
        sleep(1)
        app.typeKey(.downArrow, modifierFlags: [])
        app.typeKey(.upArrow, modifierFlags: [])
        app.typeKey(.upArrow, modifierFlags: [])    // past the top stays on the first
        app.typeKey(.return, modifierFlags: [])
        sleep(1)
        stillUp(app, "Quick Open → INV-D0002")
        XCTAssertFalse(field.exists, "the panel stayed up after opening")
    }

    func testQuickOpenWithNothingFoundOrNothingTyped() {
        let app = launch()
        app.typeKey("k", modifierFlags: .command)
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("zzzz-no-such-thing")
        app.typeKey(.return, modifierFlags: [])     // nothing to open: stays, no crash
        stillUp(app, "Quick Open with no result")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(field.waitForExistence(timeout: 1), "Esc did not close ⌘K")
        app.typeKey("k", modifierFlags: .command)
        app.typeKey(.return, modifierFlags: [])     // nothing typed: the first offer (New sale) opens its window
        sleep(1)
        stillUp(app, "Quick Open with nothing typed")
    }

    func testQuickOpenInANewWindow() {
        let app = launch()
        let before = app.windows.count
        app.typeKey("k", modifierFlags: .command)
        app.textFields.firstMatch.typeText("ORD-D0002")
        sleep(1)
        app.typeKey(.return, modifierFlags: .command)
        XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5), "⌘Return opened no window")
    }

    // MARK: The counter's jobs

    func testNewSaleOrderAndRepairOpenWindowsOfTheirOwn() {
        let app = launch()
        let before = app.windows.count
        let jobs: [(String, XCUIElement.KeyModifierFlags, String)] = [
            ("n", .command, "New sale"), ("n", [.command, .shift], "New order"), ("n", [.command, .option], "New repair"),
        ]
        for (key, mods, what) in jobs {
            app.typeKey(key, modifierFlags: mods)
            XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5), "\(what) opened no window")
            shot(app, what)
            stillUp(app, what)
            app.typeKey("w", modifierFlags: .command)
            sleep(1)
            // A form with nothing typed closes without asking; one that asks gets Don't Save.
            if app.buttons["Don’t Save"].exists { app.buttons["Don’t Save"].click() }
            if app.buttons["Don't Save"].exists { app.buttons["Don't Save"].click() }
        }
        stillUp(app, "the three windows")
    }

    /// File › New is a new window every time, as a document app's is: a second ⌘N must not bring the first forward.
    func testTwoNewSalesAreTwoWindows() {
        let app = launch()
        let before = app.windows.count
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5))
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(app.windows.element(boundBy: before + 1).waitForExistence(timeout: 5),
                      "the second ⌘N brought the first sale forward instead of a new one")
        stillUp(app, "two new sales")
    }

    /// The counter's keys answer whatever window is in front: a New Sale window, the Settings window.
    func testNewKeysWorkFromAWindowWithNoSidebar() {
        let app = launch()
        let before = app.windows.count
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5))
        // The sale's window is key now.
        app.typeKey("n", modifierFlags: [.command, .shift])
        XCTAssertTrue(app.windows.element(boundBy: before + 1).waitForExistence(timeout: 5),
                      "⇧⌘N from a New Sale window did nothing (the menus read the main window only)")
        app.typeKey(",", modifierFlags: .command)
        sleep(1)
        let withSettings = app.windows.count
        app.typeKey("n", modifierFlags: [.command, .option])
        XCTAssertTrue(app.windows.element(boundBy: withSettings).waitForExistence(timeout: 5),
                      "⌥⌘N from Settings did nothing")
        stillUp(app, "new from other windows")
    }

    /// A saved list opened in a window of its own shows that list, not every record of its place.
    func testASavedListInAWindowIsThatList() {
        let app = launch(["-ERPDemoOpen", "/orders?list=late"])
        sleep(2)
        let before = app.windows.count
        let listTitle = title(app)
        app.typeKey("o", modifierFlags: .command)
        let w = app.windows.element(boundBy: before)
        XCTAssertTrue(w.waitForExistence(timeout: 5))
        sleep(1)
        XCTAssertEqual(app.windows.firstMatch.title, listTitle, "the list's window is titled as another page")
        shot(app, "a saved list in a window")
    }

    /// A link (⌘K) after Back is a new step: Forward has nowhere left to go.
    func testForwardIsGoneAfterQuickOpen() {
        let app = launch()
        row(app, "/orders").click()
        row(app, "/invoices").click()
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(app.buttons["Forward"].firstMatch.isEnabled)
        app.typeKey("k", modifierFlags: .command)
        app.textFields.firstMatch.typeText("ORD-D0002")
        sleep(1)
        app.typeKey(.return, modifierFlags: [])
        sleep(1)
        XCTAssertFalse(app.buttons["Forward"].firstMatch.isEnabled, "Forward still leads past a page opened by ⌘K")
        app.typeKey("[", modifierFlags: .command)
        stillUp(app, "Back after ⌘K")
    }

    private func menuItem(_ app: XCUIApplication, _ menu: String, _ item: String) -> XCUIElement {
        app.menuBars.menuBarItems[menu].click()
        return app.menuBars.menuItems[item]
    }

    func testPrintIsOffOnTheOnlineInbox() {
        let app = launch(["-ERPDemoOpen", "/orders/online"])
        sleep(2)
        let print = menuItem(app, "File", "Print…")
        XCTAssertTrue(print.exists)
        XCTAssertFalse(print.isEnabled, "File › Print offered an order slip for the online inbox")
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("p", modifierFlags: .command)
        sleep(1)
        stillUp(app, "⌘P on the inbox")
    }

    func testSnapshotsAreOffInTheDemo() {
        let app = launch()
        let item = menuItem(app, "Help", "Send Page Snapshots…")
        XCTAssertTrue(item.exists)
        XCTAssertFalse(item.isEnabled, "the demo's made-up books could be sent to a real ERP")
        app.typeKey(.escape, modifierFlags: [])
    }

    func testTheSidebarCommandsOpenTheirWindows() {
        let app = launch()
        let before = app.windows.count
        app.descendants(matching: .any).matching(identifier: "sidebar.command.New Sale").firstMatch.click()
        XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5), "New Sale in the sidebar opened nothing")
        app.typeKey("w", modifierFlags: .command)
        app.descendants(matching: .any).matching(identifier: "sidebar.command.Search").firstMatch.click()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 3), "Search in the sidebar did not open ⌘K")
        app.typeKey(.escape, modifierFlags: [])
    }

    // MARK: Records

    func testARecordOpensInItsOwnWindow() {
        for place in ["/orders", "/invoices", "/customers", "/repairs", "/products"] {
            let app = launch(["-ERPDemoOpen", place])
            sleep(2)
            let before = app.windows.count
            let cells = app.windows.firstMatch.outlines.firstMatch.cells
            guard cells.firstMatch.waitForExistence(timeout: 5) else { XCTFail("\(place) shows no rows in the demo"); app.terminate(); continue }
            // A section's heading is a cell too: click down the list until the inspector shows a record.
            let empty = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'No ' AND label ENDSWITH ' Selected'")).firstMatch
            var picked: XCUIElement?
            for i in 0..<8 {
                let c = cells.element(boundBy: i)
                guard c.exists else { break }
                c.click()
                usleep(500_000)
                if !empty.exists { picked = c; break }
            }
            guard let row = picked else { XCTFail("no row of \(place) could be picked"); app.terminate(); continue }
            shot(app, "picked in " + place)
            app.typeKey(.return, modifierFlags: [])
            if !app.windows.element(boundBy: before).waitForExistence(timeout: 5) {
                row.doubleClick()
                let byClick = app.windows.element(boundBy: before).waitForExistence(timeout: 5)
                XCTFail("Return on a row of \(place) opened no window (a double-click \(byClick ? "did" : "did not either"))")
            }
            shot(app, "record from " + place)
            stillUp(app, "a record of " + place)
            app.terminate()
        }
    }

    func testOpenInNewWindowAndPrintWithNothingPicked() {
        let app = launch(["-ERPDemoOpen", "/invoices"])
        let before = app.windows.count
        app.typeKey("o", modifierFlags: .command)    // the place itself in a window
        XCTAssertTrue(app.windows.element(boundBy: before).waitForExistence(timeout: 5))
        app.typeKey("w", modifierFlags: .command)
        app.typeKey("p", modifierFlags: .command)    // nothing picked: the page, or nothing; never a crash
        sleep(2)
        app.typeKey(.escape, modifierFlags: [])
        stillUp(app, "⌘P with nothing picked")
    }

    // MARK: The inspector, the views, filters and search

    func testTheInspectorHidesAndShows() {
        let app = launch(["-ERPDemoOpen", "/orders"])
        for _ in 0..<3 { app.typeKey("i", modifierFlags: [.command, .option]); usleep(400_000) }
        stillUp(app, "the inspector toggled")
        app.typeKey("i", modifierFlags: [.command, .option])
    }

    func testOrdersAndStockSwitchTheirViews() {
        for place in ["/orders", "/products", "/workshop"] {
            let app = launch(["-ERPDemoOpen", place])
            app.typeKey("2", modifierFlags: [.command, .control])
            sleep(1)
            shot(app, "second view of " + place)
            stillUp(app, "the second view of " + place)
            app.typeKey("1", modifierFlags: [.command, .control])
            stillUp(app, "the first view of " + place)
            app.terminate()
        }
    }

    func testEveryListsFilterMenuOpensAndSearchFilters() {
        for place in ["/orders", "/invoices", "/customers", "/repairs", "/products", "/expenses", "/hisaab"] {
            let app = launch(["-ERPDemoOpen", place])
            let filter = app.toolbars.buttons.matching(NSPredicate(format: "label CONTAINS 'Filter' OR label CONTAINS 'Sort'")).firstMatch
            if filter.waitForExistence(timeout: 3) {
                filter.click()
                sleep(1)
                shot(app, "filter of " + place)
                app.typeKey(.escape, modifierFlags: [])
            }
            app.typeKey("f", modifierFlags: .command)
            app.typeText("zzzz-none")
            sleep(1)
            stillUp(app, "searching " + place)
            app.typeKey("a", modifierFlags: .command)
            app.typeKey(.delete, modifierFlags: [])
            app.terminate()
        }
    }

    // MARK: Settings, the rate, the business

    func testEverySettingsPaneOpens() {
        let app = launch()
        app.typeKey(",", modifierFlags: .command)
        let settings = app.windows.element(boundBy: 0)
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        let panes = app.outlines.firstMatch.cells
        let n = panes.count
        XCTAssertGreaterThan(n, 3, "Settings shows almost no panes")
        for i in 0..<n {
            panes.element(boundBy: i).click()
            usleep(700_000)
            shot(app, "settings pane \(i)")
            stillUp(app, "settings pane \(i)")
        }
    }

    func testTheRateSheetOpensAndCloses() {
        let app = launch()
        let rate = app.descendants(matching: .any).matching(identifier: "sidebar.rate").firstMatch
        XCTAssertTrue(rate.waitForExistence(timeout: 5), "no rate at the sidebar's foot")
        rate.click()
        XCTAssertTrue(app.sheets.firstMatch.waitForExistence(timeout: 5), "the rate opened no sheet")
        shot(app, "rate sheet")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(app.sheets.firstMatch.waitForExistence(timeout: 2), "Esc did not close the rate sheet")
    }

    func testTheBusinessMenuOpens() {
        let app = launch()
        let menu = app.descendants(matching: .any).matching(identifier: "sidebar.business").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.click()
        sleep(1)
        XCTAssertTrue(app.menuItems["Manage Businesses…"].exists, "the business menu has no Manage Businesses…")
        app.typeKey(.escape, modifierFlags: [])
        stillUp(app, "the business menu")
    }

    // MARK: The menus

    func testGoMenuNumbersAndEveryMenuOpens() {
        let app = launch()
        for n in 1...9 {
            app.typeKey(String(n), modifierFlags: .command)
            usleep(500_000)
            stillUp(app, "⌘\(n)")
        }
        for name in ["File", "Edit", "View", "Go", "Window", "Help"] {
            let item = app.menuBars.menuBarItems[name]
            XCTAssertTrue(item.exists, "no \(name) menu")
            item.click()
            usleep(300_000)
            app.typeKey(.escape, modifierFlags: [])
        }
        app.menuBars.menuBarItems["Help"].click()
        XCTAssertTrue(app.menuItems["Send Page Snapshots…"].exists, "the owner's Help menu has no Send Page Snapshots…")
        app.typeKey(.escape, modifierFlags: [])
    }

    // MARK: Coming back

    func testTheWindowReopensWhereItWasLeft() {
        let first = demo(restoreState: true)
        first.launch()
        XCTAssertTrue(first.windows.firstMatch.waitForExistence(timeout: 15))
        row(first, "/invoices").click()
        XCTAssertEqual(title(first), "Invoices")
        sleep(2)
        first.terminate()
        let again = demo(restoreState: true)
        again.launch()
        XCTAssertTrue(again.windows.firstMatch.waitForExistence(timeout: 15))
        sleep(2)
        XCTAssertEqual(title(again), "Invoices", "the window did not reopen on its place")
    }

    // MARK: Speed

    func testLaunchIsQuick() {
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            demo().launch()
        }
    }

    /// One set of metrics per test (XCTest's rule): switching places is its own test.
    func testSwitchingPlacesIsQuick() {
        let app = launch()
        let clock = XCTClockMetric()
        measure(metrics: [clock]) {
            for p in ["/orders", "/invoices", "/customers", "/products", "/analytics"] { row(app, p).click() }
        }
    }
}
