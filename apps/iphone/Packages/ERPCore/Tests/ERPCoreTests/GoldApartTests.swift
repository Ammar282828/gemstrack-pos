import XCTest
@testable import ERPCore

/// src/lib/analytics/gold-apart.test.ts (the split), and the books with gold apart (House of Mina, 10%).
final class GoldApartTests: XCTestCase {
    private let NOW = ERPDate.karachiCalendar.date(from: DateComponents(year: 2026, month: 11, day: 5, hour: 12))!
    private func d(_ s: String) -> Date { JS.parseISO(s)! }
    private lazy var NOV = Period(from: d("2026-11-01T00:00:00"), to: d("2026-11-05T00:00:00"))

    private func item(_ metal: String, _ total: Double) -> [String: Any] {
        ["sku": "X", "name": "Piece", "categoryId": "cat001", "metalType": metal, "karat": "22k", "metalWeightG": 0,
         "stoneWeightG": 0, "quantity": 1, "unitPrice": 0, "itemTotal": total, "metalCost": 0, "wastageCost": 0,
         "wastagePercentage": 0, "makingCharges": 0, "diamondChargesIfAny": 0, "stoneChargesIfAny": 0, "miscChargesIfAny": 0]
    }
    private func invoice(_ id: String, _ date: String, _ items: [[String: Any]], total: Double) -> Invoice {
        ERPDecode.model(Invoice.self, from: [
            "id": id, "customerName": "", "items": items, "subtotal": total, "discountAmount": 0, "grandTotal": total,
            "amountPaid": total, "balanceDue": 0, "createdAt": date, "paymentHistory": [], "status": "Paid",
        ] as [String: Any])!
    }
    private func order(_ items: [[String: Any]]) -> Order {
        ERPDecode.model(Order.self, from: ["id": "O", "createdAt": "2026-11-04T09:00:00", "status": "New", "items": items,
                                           "subtotal": 0, "grandTotal": 0] as [String: Any])!
    }

    func testSplitsASaleByItsLinesAndTheAdjustmentsFallInProportion() {
        XCTAssertEqual(GoldApart.goldShare([("gold", 30000), ("silver", 10000)]), 0.75)
        let mixed = invoice("A", "2026-11-02T10:00:00", [item("gold", 30000), item("silver", 10000)], total: 38000)
        XCTAssertEqual(GoldApart.invoiceGoldPart(mixed, 38000), 28500)
        XCTAssertEqual(GoldApart.invoiceGoldPart(invoice("B", "2026-11-02T10:00:00", [item("silver", 8000)], total: 8350), 8350), 0)
        XCTAssertEqual(GoldApart.invoiceGoldPart(invoice("C", "2026-11-02T10:00:00", [], total: 5000), 5000), 0)
        let o = order([["metalType": "gold", "isManualPrice": true, "manualPrice": 20000], ["metalType": "silver", "totalEstimate": 0]])
        XCTAssertEqual(GoldApart.orderGoldPart(o, 20000), 20000)
    }

    func testLabels() {
        XCTAssertEqual(GoldApart.goldRevenueLabel(10), "Gold revenue (est. 10% margin)")
        XCTAssertEqual(GoldApart.goldRevenueLabel(7.5), "Gold revenue (est. 7.5% margin)")
    }

    func testBooksSplitRevenueAndProfitWhereGoldIsApart() {
        let gold = invoice("G", "2026-11-02T10:00:00", [item("gold", 40000)], total: 40000)
        let silver = invoice("S", "2026-11-03T10:00:00", [item("silver", 60000)], total: 60000)
        let goods = ERPDecode.model(Expense.self, from: ["id": "E", "date": "2026-11-01T09:00:00", "category": "Stock & Karigars",
                                                         "description": "Stock", "amount": 35000] as [String: Any])!
        let rent = ERPDecode.model(Expense.self, from: ["id": "R", "date": "2026-11-01T09:00:00", "category": "Rent",
                                                        "description": "Rent", "amount": 5000] as [String: Any])!
        let input = BooksInput(invoices: [gold, silver], orders: [], customers: [], expenses: [goods, rent], additionalRevenues: [])
        let on = computeBooks(input, range: NOV, options: BooksOptions(now: NOW, goods: ["Stock & Karigars"], goldApartMargin: 10))
        XCTAssertEqual(on.totalSales, 100000)
        XCTAssertEqual(on.goldRevenue, 40000)
        XCTAssertEqual(on.silverRevenue, 60000)
        XCTAssertEqual(on.goldProfit, 4000, accuracy: 1e-6)
        // Profit is the old rule: revenue less goods (65,000), less running costs (5,000), gold or not.
        XCTAssertEqual(on.estProfitAdj, 65000, accuracy: 1e-6)
        XCTAssertEqual(on.netProfit, 60000, accuracy: 1e-6)
        XCTAssertEqual(on.salesOverTime.map { $0.gold }, [40000, 0])

        // Off (Taheri): one revenue, the old rule, nothing apart.
        let off = computeBooks(input, range: NOV, options: BooksOptions(now: NOW, goods: ["Stock & Karigars"]))
        XCTAssertEqual(off.estProfitAdj, 65000, accuracy: 1e-6)
        XCTAssertEqual(off.goldProfit, 0)
        XCTAssertEqual(off.netProfit, 60000, accuracy: 1e-6)
    }

    func testSilverGoldRowsSplitEachBucket() {
        let rows = silverGoldRows([SalesDay(date: "2026-11-02", sales: 100, orders: 1, itemsSold: 1, gold: 40)], .day, range: nil, now: NOW)
        XCTAssertEqual(rows.map { $0.gold }, [40])
        XCTAssertEqual(rows.map { $0.silver }, [60])
    }
}
