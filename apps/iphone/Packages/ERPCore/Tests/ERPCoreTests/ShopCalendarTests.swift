import XCTest
@testable import ERPCore

/// src/app/calendar/page.tsx has no test of its own. These pin its reckoning: a sale on the day of its order,
/// money only where the page counts it, and Karachi's days (8 Oct 20:00 UTC is already 9 Oct 01:00 there).
final class ShopCalendarTests: XCTestCase {
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    func testASaleSitsOnTheDayItsOrderWasTakenAndItsRowKeepsItsOwnTime() {
        let o = order(["id": "ORD-1", "createdAt": "2026-10-01T08:00:00Z", "status": "Completed", "invoiceId": "INV-1", "subtotal": 90_000])
        let i = invoice(["id": "INV-1", "createdAt": "2026-10-08T10:00:00Z", "sourceOrderId": "ORD-1", "grandTotal": 80_000,
                         "customerName": "Sana Ali"])
        let days = shopCalendarDays(invoices: [i], orders: [o])
        XCTAssertEqual(days.keys.sorted(), ["2026-10-01"])
        let day = days["2026-10-01"]!
        XCTAssertEqual(day.invoices, 1)
        XCTAssertEqual(day.orders, 1)
        // The sale, not the order too: an invoiced order's money is already in the sale.
        XCTAssertEqual(day.total, 80_000)
        let sale = day.events.first { $0.isInvoice }!
        XCTAssertEqual(sale.createdAt, "2026-10-08T10:00:00Z")
        XCTAssertEqual(sale.customerName, "Sana Ali")
        XCTAssertEqual(sale.grandTotal, 80_000)
    }

    func testADirectSaleSitsOnItsOwnKarachiDayWithTheExchangeAddedBackAndARefundLeftOut() {
        let sold = invoice(["id": "INV-2", "createdAt": "2026-10-08T20:00:00Z", "grandTotal": 25_000,
                            "exchanges": [["description": "Old ring", "value": 60_000]]])
        let refunded = invoice(["id": "INV-3", "createdAt": "2026-10-08T21:00:00Z", "grandTotal": 40_000, "status": "Refunded"])
        let days = shopCalendarDays(invoices: [sold, refunded], orders: [])
        // 8 Oct 20:00 UTC is 9 Oct in Karachi.
        XCTAssertEqual(days.keys.sorted(), ["2026-10-09"])
        let day = days["2026-10-09"]!
        XCTAssertEqual(day.invoices, 2)
        XCTAssertEqual(day.total, 85_000)
        // Newest first.
        XCTAssertEqual(day.events.map(\.docId), ["INV-3", "INV-2"])
    }

    func testAnOrderCountsItsSubtotalOnlyWhileUninvoicedAndLive() {
        let open = order(["id": "ORD-1", "createdAt": "2026-10-05T08:00:00Z", "status": "Pending", "subtotal": 50_000, "grandTotal": 30_000, "customerName": "Bilal"])
        let invoiced = order(["id": "ORD-2", "createdAt": "2026-10-05T09:00:00Z", "status": "Completed", "invoiceId": "INV-9", "subtotal": 70_000])
        let cancelled = order(["id": "ORD-3", "createdAt": "2026-10-05T10:00:00Z", "status": "Cancelled", "subtotal": 20_000])
        let day = shopCalendarDays(invoices: [], orders: [open, invoiced, cancelled])["2026-10-05"]!
        XCTAssertEqual(day.orders, 3)
        XCTAssertEqual(day.invoices, 0)
        XCTAssertEqual(day.total, 50_000)
        XCTAssertEqual(day.events.count, 3)
        // The row prints the document's own total (the balance, for an order).
        XCTAssertEqual(day.events.first { $0.docId == "ORD-1" }!.grandTotal, 30_000)
        XCTAssertEqual(day.events.first { $0.docId == "ORD-1" }!.customerName, "Bilal")
    }

    func testADateThatDoesNotReadHasNoDay() {
        let days = shopCalendarDays(invoices: [invoice(["id": "INV-1", "createdAt": "not a date", "grandTotal": 5])],
                                    orders: [order(["id": "ORD-1", "createdAt": ""])])
        XCTAssertTrue(days.isEmpty)
    }

    func testWhatIsPromisedOnEachDayIsActiveOrdersOnly() {
        let a = order(["id": "ORD-1", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending", "promisedDate": "2026-10-20"])
        let b = order(["id": "ORD-2", "createdAt": "2026-10-01T00:00:00Z", "status": "In Progress", "promisedDate": "2026-10-20"])
        // An instant is placed on its Karachi day: 19 Oct 20:00 UTC is 20 Oct there.
        let c = order(["id": "ORD-3", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending", "promisedDate": "2026-10-19T20:00:00.000Z"])
        let done = order(["id": "ORD-4", "createdAt": "2026-10-01T00:00:00Z", "status": "Completed", "promisedDate": "2026-10-20"])
        let none = order(["id": "ORD-5", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending"])
        let junk = order(["id": "ORD-6", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending", "promisedDate": "soon"])
        XCTAssertEqual(shopCalendarDue(orders: [a, b, c, done, none, junk]), ["2026-10-20": 3])
    }

    func testTheOrdersPromisedOnADay() {
        let a = order(["id": "ORD-1", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending", "promisedDate": "2026-10-20"])
        let b = order(["id": "ORD-2", "createdAt": "2026-10-01T00:00:00Z", "status": "In Progress", "promisedDate": "2026-10-19T20:00:00.000Z"])
        let done = order(["id": "ORD-3", "createdAt": "2026-10-01T00:00:00Z", "status": "Completed", "promisedDate": "2026-10-20"])
        let other = order(["id": "ORD-4", "createdAt": "2026-10-01T00:00:00Z", "status": "Pending", "promisedDate": "2026-10-21"])
        XCTAssertEqual(shopCalendarDueOn("2026-10-20", orders: [a, b, done, other]).map(\.id), ["ORD-1", "ORD-2"])
        XCTAssertEqual(shopCalendarDueOn("2026-10-22", orders: [a, b, done, other]).count, 0)
    }

    func testTheMonthOnScreenAddsItsOwnDaysOnly() {
        let i1 = invoice(["id": "INV-1", "createdAt": "2026-10-02T08:00:00Z", "grandTotal": 100_000])
        let i2 = invoice(["id": "INV-2", "createdAt": "2026-10-03T08:00:00Z", "grandTotal": 50_000])
        let i3 = invoice(["id": "INV-3", "createdAt": "2026-09-30T08:00:00Z", "grandTotal": 999_999])
        let o1 = order(["id": "ORD-1", "createdAt": "2026-10-03T09:00:00Z", "status": "Pending", "subtotal": 10_000])
        let o2 = order(["id": "ORD-2", "createdAt": "2026-10-04T09:00:00Z", "status": "Cancelled", "subtotal": 7_000])
        let days = shopCalendarDays(invoices: [i1, i2, i3], orders: [o1, o2])
        let oct = shopCalendarMonth(days, year: 2026, month: 10)
        XCTAssertEqual(oct, ShopCalendarMonth(sales: 2, orders: 2, total: 160_000, days: 2, perTradingDay: 80_000))
        let sep = shopCalendarMonth(days, year: 2026, month: 9)
        XCTAssertEqual(sep.sales, 1)
        XCTAssertEqual(sep.total, 999_999)
        // A month with nothing in it: no average.
        XCTAssertEqual(shopCalendarMonth(days, year: 2026, month: 8), ShopCalendarMonth(sales: 0, orders: 0, total: 0, days: 0, perTradingDay: 0))
    }

    func testTheGridHasAGapForEachWeekdayBeforeTheFirst() {
        // 1 Oct 2026 is a Thursday: Sunday to Wednesday are gaps.
        let oct = ShopCalendar.cells(year: 2026, month: 10)
        XCTAssertEqual(oct.count, 4 + 31)
        XCTAssertEqual(oct.prefix(5).map { $0 ?? 0 }, [0, 0, 0, 0, 1])
        XCTAssertEqual(oct.last!, 31)
        // 1 Feb 2026 is a Sunday: no gap. 2028 is a leap year.
        let feb = ShopCalendar.cells(year: 2026, month: 2)
        XCTAssertEqual(feb.count, 28)
        XCTAssertEqual(feb.first!, 1)
        XCTAssertEqual(ShopCalendar.cells(year: 2028, month: 2).compactMap { $0 }.count, 29)
    }

    func testStepsAndWords() {
        XCTAssertTrue(ShopCalendar.step(year: 2026, month: 12, by: 1) == (2027, 1))
        XCTAssertTrue(ShopCalendar.step(year: 2026, month: 1, by: -1) == (2025, 12))
        XCTAssertTrue(ShopCalendar.step(year: 2026, month: 10, by: 0) == (2026, 10))
        XCTAssertTrue(ShopCalendar.step(year: 2026, month: 3, by: -15) == (2024, 12))
        XCTAssertEqual(ShopCalendar.title(year: 2026, month: 10), "October 2026")
        XCTAssertEqual(ShopCalendar.longDay("2026-10-09"), "October 9, 2026")
        XCTAssertEqual(ShopCalendar.longDay("nonsense"), "nonsense")
        XCTAssertEqual(ShopCalendar.monthKey(year: 2026, month: 3), "2026-03")
        XCTAssertEqual(ShopCalendar.dayKey(year: 2026, month: 3, day: 7), "2026-03-07")
        // 20:00 UTC on the 8th is already the 9th in Karachi.
        let t = ShopCalendar.today(now: ERPDate.parse("2026-10-08T20:00:00Z")!)
        XCTAssertTrue(t == (2026, 10, 9))
    }

    func testAnEmptyCellsMoney() {
        XCTAssertEqual(ShopCalendar.dayMoney(0), "0")
        XCTAssertEqual(ShopCalendar.dayMoney(850), "850")
        XCTAssertEqual(ShopCalendar.dayMoney(999), "999")
        XCTAssertEqual(ShopCalendar.dayMoney(1000), "1k")
        XCTAssertEqual(ShopCalendar.dayMoney(12_499), "12k")
        XCTAssertEqual(ShopCalendar.dayMoney(12_500), "13k")
        XCTAssertEqual(ShopCalendar.dayMoney(999_499), "999k")
        XCTAssertEqual(ShopCalendar.dayMoney(999_500), "1M")
        XCTAssertEqual(ShopCalendar.dayMoney(1_500_000), "1.5M")
        XCTAssertEqual(ShopCalendar.dayMoney(12_345_678), "12.3M")
    }

    func testTheTimeOfDayIsKarachis() {
        XCTAssertEqual(ShopCalendar.clock(iso: "2026-10-08T20:00:00Z"), "1:00 am")
        XCTAssertEqual(ShopCalendar.clock(iso: "2026-10-08T19:00:00Z"), "12:00 am")
        XCTAssertEqual(ShopCalendar.clock(iso: "2026-10-09T07:05:00Z"), "12:05 pm")
        XCTAssertEqual(ShopCalendar.clock(iso: "2026-10-09T11:30:00Z"), "4:30 pm")
        XCTAssertEqual(ShopCalendar.clock(iso: ""), "")
    }
}
