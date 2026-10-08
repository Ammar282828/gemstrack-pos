import XCTest
@testable import ERPCore

/// src/lib/analytics/todays-cash.test.ts, case for case (the customers are made up).
final class TodaysCashTests: XCTestCase {
    private let now = ERPDate.parse("2026-10-01T15:00:00Z")! // 20:00 in Karachi

    private func T(_ hhmm: String) -> String { "2026-10-01T\(hhmm):00+05:00" }

    private func models<M: Decodable>(_ type: M.Type, _ list: [[String: Any]]) -> [M] { list.map { ERPDecode.model(M.self, from: $0)! } }

    private var invoices: [Invoice] {
        models(Invoice.self, [
            ["id": "INV-1", "customerName": "Sana Example", "status": "Paid", "createdAt": T("11:00"), "grandTotal": 100_000,
             "exchangeAmount1": 20_000, "exchangeDescription": "Old ring",
             "paymentHistory": [["amount": 60_000, "date": T("11:05"), "method": "Cash"], ["amount": 20_000, "date": T("11:06"), "method": "Card"]]],
            ["id": "INV-2", "customerName": "Walk-in Customer", "status": "Paid", "createdAt": "2026-09-20T10:00:00+05:00", "grandTotal": 50_000,
             "paymentHistory": [["amount": 50_000, "date": "2026-09-30T23:30:00+05:00", "method": "Cash"],
                                ["amount": 10_000, "date": T("00:30"), "method": "Bank Transfer"]]],
            ["id": "INV-3", "status": "Refunded", "createdAt": T("12:00"), "paymentHistory": [["amount": 9_999, "date": T("12:00"), "method": "Cash"]]],
        ])
    }
    private var orders: [Order] {
        models(Order.self, [
            ["id": "ORD-1", "customerName": "Fatima Sample", "status": "Pending", "createdAt": T("13:00"), "advancePayment": 15_000, "advanceMethod": "Cash"],
            ["id": "ORD-2", "customerName": "Old", "status": "Pending", "createdAt": T("13:30"), "advancePayment": 5_000, "invoiceId": "INV-9"],
        ])
    }
    private var repairs: [Repair] {
        models(Repair.self, [
            ["id": "REP-1", "customerName": "Batool Test", "payments": [["amount": 2_000, "date": T("14:00"), "method": "Card", "revenueId": "rev-1"]]],
        ])
    }
    private var extraRevenues: [AdditionalRevenue] {
        models(AdditionalRevenue.self, [
            ["id": "rev-1", "date": T("14:00"), "description": "Repair REP-1", "amount": 2_000, "repairId": "REP-1"],
            ["id": "rev-2", "date": T("15:00"), "description": "Polish", "amount": 1_000],
        ])
    }
    private var expenses: [Expense] {
        models(Expense.self, [
            ["id": "e1", "date": T("16:00"), "category": "Tea", "description": "Tea", "amount": 500],
            ["id": "e2", "date": T("16:30"), "category": "Other", "description": "Paid by a partner", "amount": 7_000, "paidBy": "mina"],
            ["id": "e3", "date": "2026-09-30T18:00:00+05:00", "category": "Tea", "description": "Yesterday", "amount": 300],
        ])
    }

    private var t: TodaysCash {
        todaysCash(invoices: invoices, orders: orders, repairs: repairs, extraRevenues: extraRevenues, expenses: expenses, now: now)
    }

    func testIsKarachisDay() {
        XCTAssertEqual(t.day, "2026-10-01")
        XCTAssertEqual(karachiDayPeriod(ERPDate.parse("2026-09-30T19:30:00Z")!).day, "2026-10-01") // 00:30 in Karachi
    }

    func testTakesMoneyInByHowItWasPaidInvoicesOrderAdvancesRepairsOtherExtraRevenue() {
        let r = t
        XCTAssertEqual(r.byMethod, [.cash: 75_000, .card: 22_000, .bankTransfer: 10_000, .cheque: 0, .notRecorded: 1_000])
        XCTAssertEqual(r.totalIn, 108_000)
        XCTAssertEqual(r.lines.map(\.ref), ["INV-2", "INV-1", "INV-1", "ORD-1", "REP-1", "Polish"])
    }

    func testKeepsExchangeGoldOnItsOwnLineNeverInCash() {
        let r = t
        XCTAssertEqual(r.exchange, 20_000)
        XCTAssertFalse(r.byMethod[.cash]! > 75_000)
    }

    func testTheDrawerIsCashInLessWhatTheBusinessPaidTodayNeverAPartnersOwnMoney() {
        let r = t
        XCTAssertEqual(r.expenses, 500)
        XCTAssertEqual(r.netCash, 74_500)
    }

    // Not in the TS tests: the lines themselves, and the edges of the Karachi day.
    func testEachLineSaysWhoWhatAndHow() {
        let lines = t.lines
        XCTAssertEqual(lines.map(\.source), [.invoice, .invoice, .invoice, .advance, .repair, .extra])
        XCTAssertEqual(lines.map(\.who), ["Walk-in Customer", "Sana Example", "Sana Example", "Fatima Sample", "Batool Test", ""])
        XCTAssertEqual(lines.map(\.method), [.bankTransfer, .cash, .card, .cash, .card, .notRecorded])
        XCTAssertEqual(lines.map(\.amount), [10_000, 60_000, 20_000, 15_000, 2_000, 1_000])
        XCTAssertEqual(t.expenseLines, [ExpenseLine(description: "Tea", amount: 500, category: "Tea")])
    }

    func testTheDayRunsFromKarachisMidnightToItsLastMillisecond() {
        let (_, period) = karachiDayPeriod(now)
        XCTAssertEqual(period.from, ERPDate.parse("2026-09-30T19:00:00Z"))
        XCTAssertEqual(JS.ms(period.to!), JS.ms(ERPDate.parse("2026-10-01T19:00:00Z")!) - 1)
        let late = models(Invoice.self, [["id": "INV-L", "customerName": "Sana Example",
                                          "paymentHistory": [["amount": 5, "date": "2026-10-01T23:59:59.999+05:00", "method": "Cash"],
                                                             ["amount": 7, "date": "2026-10-02T00:00:00.000+05:00", "method": "Cash"]]]])
        let r = todaysCash(invoices: late, orders: [], repairs: [], extraRevenues: [], expenses: [], now: now)
        XCTAssertEqual(r.totalIn, 5)
    }

    func testAMethodTheListDoesNotKnowIsNotRecorded() {
        let inv = models(Invoice.self, [["id": "INV-M", "paymentHistory": [["amount": 100, "date": T("10:00"), "method": "Easypaisa"], ["amount": 50, "date": T("10:01")]]]])
        let r = todaysCash(invoices: inv, orders: [], repairs: [], extraRevenues: [], expenses: [], now: now)
        XCTAssertEqual(r.byMethod[.notRecorded], 150)
        XCTAssertEqual(r.lines.map(\.who), ["Walk-in", "Walk-in"])
    }
}
