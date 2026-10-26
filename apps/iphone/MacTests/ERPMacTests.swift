import XCTest
@testable import ERP

/// The Mac's own rules, run inside the Mac app in the demo (`-ERPDemo YES`, made-up books): the window's Back and
/// Forward, the sidebar every role is drawn, that every row it shows opens a native page, the saved lists, the page
/// snapshots' walk, and the toolbar placements the Mac depends on.
@MainActor
final class ERPMacTests: XCTestCase {

    // MARK: Back and Forward (MacShellModel)

    func testGoingSomewhereNewIsAVisitAndClearsForward() {
        let m = MacShellModel()
        XCTAssertEqual(m.selection, "/")
        XCTAssertFalse(m.canGoBack)
        XCTAssertFalse(m.canGoForward)
        m.go("/orders")
        m.go("/invoices")
        XCTAssertEqual(m.history.map(\.selection), ["/", "/orders"])
        m.goBack()
        XCTAssertEqual(m.selection, "/orders")
        XCTAssertTrue(m.canGoForward)
        m.go("/customers")
        XCTAssertFalse(m.canGoForward, "a new place after Back drops the way forward, as Finder does")
        XCTAssertEqual(m.selection, "/customers")
    }

    func testGoingToThePlaceAlreadyShownIsNotAVisit() {
        let m = MacShellModel()
        m.go("/orders")
        m.go("/orders")
        XCTAssertEqual(m.history.count, 1)
        XCTAssertEqual(m.selection, "/orders")
    }

    func testTheSamePlaceWithAPageOpenGoesBackToTheList() {
        let m = MacShellModel()
        m.go("/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        m.go("/orders")
        XCTAssertTrue(m.stack.isEmpty, "clicking the place again closes the page inside it")
        XCTAssertEqual(m.history.last?.stack.count, 1)
    }

    func testBackClosesThePageInsideAPlaceFirst() {
        let m = MacShellModel()
        m.go("/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        m.stack.append(Route(path: "/customers/CUST-D06"))
        m.goBack()
        XCTAssertEqual(m.selection, "/orders")
        XCTAssertEqual(m.stack.map(\.path), ["/orders/ORD-D0002"])
        m.goBack()
        XCTAssertEqual(m.selection, "/orders")
        XCTAssertTrue(m.stack.isEmpty)
        m.goBack()
        XCTAssertEqual(m.selection, "/")
        XCTAssertFalse(m.canGoBack)
    }

    func testForwardRetracesBackExactly() {
        let m = MacShellModel()
        m.go("/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        m.go("/invoices")
        m.goBack()   // to /orders with its page
        m.goBack()   // the page closed
        m.goBack()   // to Today
        XCTAssertEqual(m.selection, "/")
        m.goForward()
        XCTAssertEqual(m.selection, "/orders")
        XCTAssertTrue(m.stack.isEmpty)
        m.goForward()
        XCTAssertEqual(m.stack.map(\.path), ["/orders/ORD-D0002"])
        m.goForward()
        XCTAssertEqual(m.selection, "/invoices")
        XCTAssertFalse(m.canGoForward)
        // And back again lands where it came from.
        m.goBack()
        XCTAssertEqual(m.selection, "/orders")
        XCTAssertEqual(m.stack.map(\.path), ["/orders/ORD-D0002"])
    }

    func testBackAndForwardAtTheEndsDoNothing() {
        let m = MacShellModel()
        m.goBack()
        m.goForward()
        XCTAssertEqual(m.selection, "/")
        XCTAssertTrue(m.history.isEmpty)
        XCTAssertTrue(m.future.isEmpty)
    }

    func testHistoryIsCappedAndKeepsTheNewest() {
        let m = MacShellModel()
        for i in 0..<120 { m.go("/place-\(i)") }
        XCTAssertEqual(m.history.count, 50)
        XCTAssertEqual(m.history.last?.selection, "/place-118")
        XCTAssertEqual(m.history.first?.selection, "/place-69")
        for _ in 0..<60 { m.goBack() }
        XCTAssertEqual(m.selection, "/place-69")
        XCTAssertFalse(m.canGoBack)
    }

    func testCurrentIsTheDeepestPageAndNoneForSearch() {
        let m = MacShellModel()
        m.go("/orders")
        XCTAssertEqual(m.current?.path, "/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        XCTAssertEqual(m.current?.path, "/orders/ORD-D0002")
        m.go(MacShell.searchID)
        XCTAssertNil(m.current)
    }

    // MARK: The sidebar for every role (MacSidebarMap)

    private static let roles = ["owner", "staff", "marketing"]

    private func sections(_ role: String, selling: Bool = true) -> [MacSidebarSection] {
        MacSidebarMap.sections(NavMap.current.visible(to: role), websiteSelling: selling, role: role)
    }

    func testEveryRoleHasASidebarAndTodayLeadsForTheShop() {
        for role in Self.roles {
            let s = sections(role)
            XCTAssertFalse(MacSidebarMap.places(s).isEmpty, "\(role) has no places")
            if role != "marketing" {
                XCTAssertEqual(MacSidebarMap.places(s).first?.title, "Today", "\(role)'s sidebar does not open on Today")
            }
        }
    }

    func testNoRowIsListedTwiceAndNoneIsBlank() {
        for role in Self.roles {
            var seen = Set<String>()
            for sec in sections(role) {
                for r in sec.rows + sec.rows.flatMap(\.children) {
                    XCTAssertFalse(r.title.trimmingCharacters(in: .whitespaces).isEmpty, "\(role): a row with no title at \(r.id)")
                    XCTAssertTrue(r.id.hasPrefix("/"), "\(role): \(r.title) opens \(r.id)")
                    XCTAssertTrue(seen.insert(r.id).inserted, "\(role): \(r.id) is listed twice")
                }
            }
        }
    }

    func testNoRowHasTheBlankFallbackIcon() {
        for role in Self.roles {
            for sec in sections(role) {
                for r in sec.rows + sec.rows.flatMap(\.children) {
                    XCTAssertNotEqual(r.symbol, "square", "\(role): \(r.title) has no icon (its lucide name is unmapped)")
                }
            }
        }
    }

    func testSettingsAndActionTabsAreNotSidebarRows() {
        for role in Self.roles {
            let all = MacSidebarMap.allPaths(sections(role)).map(ScreenRoute.bare)
            for action in ["/settings", "/products/bulk-add", "/scan", "/ads/new", "/new", "/orders/add"] {
                XCTAssertFalse(all.contains(action), "\(role): \(action) is a sidebar row")
            }
        }
    }

    func testOnlineOrdersFollowWebsiteSelling() {
        XCTAssertTrue(MacSidebarMap.allPaths(sections("owner", selling: true)).contains("/orders/online"))
        XCTAssertFalse(MacSidebarMap.allPaths(sections("owner", selling: false)).contains("/orders/online"))
        XCTAssertFalse(MacSidebarMap.allPaths(sections("marketing", selling: true)).contains("/orders/online"))
    }

    func testMarketingSeesNoBooks() {
        let paths = MacSidebarMap.allPaths(sections("marketing")).map(ScreenRoute.bare)
        for book in ["/invoices", "/orders", "/customers", "/repairs", "/hisaab", "/expenses", "/analytics"] {
            XCTAssertFalse(paths.contains(book), "marketing sees \(book)")
        }
    }

    /// Every row the sidebar shows opens a native page (a Mac place, or a screen the registry has), never the web.
    func testEveryRowOpensANativePage() {
        let macPlaces: Set<String> = ["/orders", "/invoices", "/customers", "/repairs", "/products"]
        for role in Self.roles {
            for path in MacSidebarMap.allPaths(sections(role)) {
                let bare = ScreenRoute.bare(path)
                XCTAssertTrue(macPlaces.contains(bare) || ScreenRoute.hasNative(path),
                              "\(role): the sidebar row \(path) has no native page")
            }
        }
    }

    // MARK: Saved lists (MacLists)

    func testSavedListsRoundTripTheirPath() {
        for href in ["/orders", "/invoices", "/repairs", "/customers"] {
            let lists = MacLists.lists(for: href)
            XCTAssertFalse(lists.isEmpty, "\(href) has no saved lists")
            XCTAssertEqual(Set(lists.map(\.id)).count, lists.count, "\(href) has two lists with one id")
            for l in lists {
                let p = MacLists.path(href, l)
                XCTAssertEqual(MacLists.list(in: p), l.id)
                XCTAssertEqual(ScreenRoute.bare(p), href)
            }
        }
        XCTAssertNil(MacLists.list(in: "/orders"))
        XCTAssertTrue(MacLists.lists(for: "/products").isEmpty)
    }

    func testAListIsAPartOfItsPlace() {
        let book = Book.shared
        let invoices = book.invoices.items
        let all = MacLists.invoices(invoices, list: nil)
        for l in MacLists.lists(for: "/invoices") {
            let some = MacLists.invoices(invoices, list: l.id)
            XCTAssertLessThanOrEqual(some.count, all.count, l.id)
            XCTAssertTrue(Set(some.map(\.id)).isSubset(of: Set(all.map(\.id))), l.id)
        }
        let orders = book.orders.items
        let everyOrder = MacLists.orders(orders, list: nil, invoices: invoices)
        for l in MacLists.lists(for: "/orders") {
            let some = MacLists.orders(orders, list: l.id, invoices: invoices)
            XCTAssertTrue(Set(some.map(\.id)).isSubset(of: Set(everyOrder.map(\.id))), l.id)
        }
        let unknown = MacLists.invoices(invoices, list: "no-such-list")
        XCTAssertEqual(unknown.count, all.count, "an unknown list shows everything rather than nothing")
    }

    // MARK: The snapshot walk (MacSnapshots)

    func testTheSnapshotWalkVisitsEveryRowOnceInTheSidebarsOrder() {
        for role in Self.roles {
            let s = sections(role)
            let stops = MacSnapshots.stops(s)
            XCTAssertEqual(stops.count, MacSidebarMap.allPaths(s).count, role)
            XCTAssertEqual(Set(stops.map(\.path)), MacSidebarMap.allPaths(s), role)
            XCTAssertEqual(stops.first?.path, MacSidebarMap.places(s).first?.id, role)
        }
    }

    // MARK: Money in a table

    func testMoneyIsGroupedAsTheERPGroupsIt() {
        XCTAssertEqual(Money.grouped(0), "0")
        XCTAssertEqual(Money.grouped(999.5), "1,000")
        XCTAssertEqual(Money.grouped(123_000), "123,000")
        XCTAssertEqual(Money.grouped(-1_082), "-1,082")
        XCTAssertEqual(Money.grouped(25_251_000), "25,251,000")
    }
}
