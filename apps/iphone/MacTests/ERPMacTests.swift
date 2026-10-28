import XCTest
@testable import ERP
import ERPCore

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

    func testAPageOpenedByALinkDropsTheWayForward() {
        let m = MacShellModel()
        m.go("/orders")
        m.go("/invoices")
        m.goBack()
        XCTAssertTrue(m.canGoForward)
        // A link inside the page (or ⌘K) opens a record: a new step, as a browser's link is.
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        XCTAssertFalse(m.canGoForward, "Forward after a new page would jump to a place the person left behind")
    }

    func testTheStackWrittenBackUnchangedKeepsTheWayForward() {
        let m = MacShellModel()
        m.go("/orders")
        m.go("/invoices")
        m.goBack()
        m.stack = m.stack   // NavigationStack writes its path back as it draws
        XCTAssertTrue(m.canGoForward)
    }

    func testBackAndForwardThroughPagesKeepTheWayForward() {
        let m = MacShellModel()
        m.go("/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        m.goBack()
        XCTAssertTrue(m.canGoForward, "Back closing a page is a retrace, not a new step")
        m.goForward()
        XCTAssertEqual(m.stack.map(\.path), ["/orders/ORD-D0002"])
    }

    func testARoleChangeForgetsPlacesItCanNoLongerOpen() {
        let m = MacShellModel()
        m.go("/orders")
        m.go("/expenses")
        m.go(MacShell.searchID)
        m.go("/invoices")
        m.goBack()
        m.goBack()
        // Now on /expenses with /invoices and search ahead, Today and /orders behind.
        m.forget(keeping: ["/", "/invoices"])
        XCTAssertEqual(m.history.compactMap(\.selection), ["/"])
        XCTAssertEqual(m.future.compactMap(\.selection), ["/invoices", MacShell.searchID])
        while m.canGoBack { m.goBack() }
        XCTAssertEqual(m.selection, "/")
    }

    func testAMementoPutsTheWindowBackExactly() {
        let m = MacShellModel()
        m.go("/orders")
        m.stack.append(Route(path: "/orders/ORD-D0002"))
        m.go("/invoices")
        m.goBack()
        let before = m.memento
        for p in ["/customers", "/repairs", "/products"] { m.go(p) }
        m.restore(before)
        XCTAssertEqual(m.selection, before.selection)
        XCTAssertEqual(m.stack, before.stack)
        XCTAssertEqual(m.history, before.history)
        XCTAssertEqual(m.future, before.future)
        XCTAssertTrue(m.canGoForward, "the snapshot walk must not cost the person their Forward")
    }

    // MARK: Windows, print and home

    func testEveryNewIsAWindowOfItsOwn() {
        for path in ["/invoices/new", "/orders/add", "/repairs?new=1", "/scan"] {
            let a = MacWindows.fresh(Route(path: path)), b = MacWindows.fresh(Route(path: path))
            XCTAssertNotEqual(a, b, "a second \(path) would bring the first window forward")
            XCTAssertEqual(ScreenRoute.bare(a.path), ScreenRoute.bare(path), "the mark must not change the screen")
            XCTAssertTrue(ScreenRegistry.hasNative(a.path) || ScreenRoute.bare(path) == "/repairs", a.path)
            if path.contains("new=1") {
                XCTAssertEqual(URLComponents(string: a.path)?.queryItems?.first { $0.name == "new" }?.value, "1",
                               "the repair's own ask survives the mark")
            }
        }
    }

    func testPrintOffersOnlyRecordsThatPrint() {
        XCTAssertFalse(MacPrint.canPrint(Route(path: "/orders/online")), "the online inbox is not an order")
        XCTAssertFalse(MacPrint.canPrint(Route(path: "/orders/add")))
        XCTAssertFalse(MacPrint.canPrint(Route(path: "/invoices/new")))
        XCTAssertFalse(MacPrint.canPrint(Route(path: "/products/bulk-add")))
        XCTAssertFalse(MacPrint.canPrint(Route(path: "/orders")))
        XCTAssertFalse(MacPrint.canPrint(nil))
        XCTAssertTrue(MacPrint.canPrint(Route(path: "/orders/ORD-D0002")))
        XCTAssertTrue(MacPrint.canPrint(Route(path: "/invoices/INV-D0001")))
        XCTAssertTrue(MacPrint.canPrint(Route(path: "/products/SKU-1")))
        XCTAssertTrue(MacPrint.canPrint(Route(path: "/repairs?id=REP-1")))
        XCTAssertEqual(MacPrint.title(for: Route(path: "/orders/ORD-D0002")), "Print Order Slip…")
    }

    func testEveryRoleStartsOnAPlaceItHas() {
        for role in Self.roles {
            let s = sections(role)
            let home = MacShell.home(s)
            XCTAssertTrue(MacSidebarMap.allPaths(s).contains(home), "\(role) starts on \(home), not in its sidebar")
            if role != "marketing" { XCTAssertEqual(home, "/", role) }
        }
    }

    func testSettingsPanesFollowTheRole() {
        let owner = MacSettingsPane.groups(owner: true, websiteSelling: true).flatMap(\.panes)
        let staff = MacSettingsPane.groups(owner: false, websiteSelling: true).flatMap(\.panes)
        XCTAssertTrue(owner.contains(.general) && staff.contains(.general), "the fallback pane is everyone's")
        XCTAssertFalse(staff.contains(.shop))
        XCTAssertFalse(staff.contains(.ai))
        XCTAssertEqual(Set(owner).count, owner.count, "a pane listed twice")
        XCTAssertFalse(MacSettingsPane.groups(owner: true, websiteSelling: false).flatMap(\.panes).contains(.website))
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
        // The rows docs/parity.md marks "pg" for the Mac: the ERP's own page in the window, covered until a native screen
        // is built (Posts › Stories, 2026-10-27, is drawn in the browser at 2160 × 3840). A row here must say pg there.
        let webPages: Set<String> = ["/posts/stories"]
        for role in Self.roles {
            for path in MacSidebarMap.allPaths(sections(role)) {
                let bare = ScreenRoute.bare(path)
                XCTAssertTrue(macPlaces.contains(bare) || ScreenRegistry.hasNative(path) || webPages.contains(bare),
                              "\(role): the sidebar row \(path) has no native page (and is not one parity.md marks pg)")
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

    // MARK: Figure cards in even columns (MacEvenLayout)

    func testFigureRowsFillTheWidthAndBalance() {
        func cols(_ n: Int, _ w: CGFloat, _ m: CGFloat = 190) -> Int { MacEvenLayout.columns(count: n, width: w, minimum: m, spacing: 12) }
        XCTAssertEqual(cols(4, 1350), 4, "Today's four figures in one row on a wide window")
        XCTAssertEqual(cols(4, 600, 220), 2, "two and two at a list's narrowest")
        XCTAssertEqual(cols(6, 1000), 3, "six that fit five a row are three and three, never five and one")
        XCTAssertEqual(cols(10, 1350, 170), 5, "Analytics' ten figures: five and five")
        XCTAssertEqual(cols(3, 260), 1, "an inspector's figures stack")
        XCTAssertEqual(cols(1, 2000), 1)
        XCTAssertEqual(cols(0, 800), 1)
        XCTAssertEqual(cols(5, .infinity), 5, "an unbounded width lays one row")
        for n in 1...12 {
            for w in stride(from: CGFloat(200), through: 2400, by: 50) {
                let c = cols(n, w)
                let rows = Int((Double(n) / Double(c)).rounded(.up))
                XCTAssertLessThanOrEqual(c, n)
                // Balanced: the last row is never more than one card short of the others.
                XCTAssertLessThanOrEqual(c * rows - n, max(0, rows - 1), "\(n) cards at \(w): \(c) columns")
            }
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
