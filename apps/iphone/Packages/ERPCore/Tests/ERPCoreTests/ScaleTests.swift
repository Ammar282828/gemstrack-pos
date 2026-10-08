import XCTest
@testable import ERPCore

/// The books at ten times their size on 8 Oct 2026 (Taheri: 4,237 hisaab rows, 1,032 customers;
/// Mina: 424 invoices, 384 expenses): decoding every document and working out what the dashboard
/// shows must stay well under a second on a phone, so a screen never waits on the rules.
/// All made up; the limits are generous (Linux in CI is slower than an iPhone).
final class ScaleTests: XCTestCase {
    private static func docs(_ n: Int, _ make: (Int) -> [String: Any]) -> [[String: Any]] { (0..<n).map(make) }

    private static let day = ERPDate.iso(Date())

    private static let invoiceDocs = docs(5_000) { i in [
        "id": "INV-\(i)", "customerId": "c\(i % 10_000)", "customerName": "Demo \(i % 10_000)",
        "grandTotal": 100_000 + Double(i), "amountPaid": Double(i % 3) * 30_000, "balanceDue": 100_000 + Double(i) - Double(i % 3) * 30_000,
        "subtotal": 100_000 + Double(i), "discountAmount": 0, "createdAt": day,
        "items": [["sku": "S\(i)", "name": "Piece", "metalType": "gold", "karat": "21k", "metalWeightG": 4, "unitPrice": 100_000, "itemTotal": 100_000]],
        "paymentHistory": [["amount": Double(i % 3) * 30_000, "date": day, "method": "Cash"]],
        "ratesApplied": ["goldRatePerGram21k": 30_000],
    ] }
    private static let hisaabDocs = docs(42_000) { i in [
        "id": "h\(i)", "entityId": "c\(i % 10_000)", "entityType": "customer", "entityName": "Demo",
        "date": day, "description": "Row", "cashDebit": Double(i % 2) * 1_000, "cashCredit": Double((i + 1) % 2) * 400,
        "goldDebitGrams": 0, "goldCreditGrams": 0,
    ] }
    private static let orderDocs = docs(1_600) { i in [
        "id": "ORD-\(i)", "status": ["Pending", "In Progress", "Completed"][i % 3], "createdAt": day, "subtotal": 50_000,
        "advancePayment": 5_000, "grandTotal": 45_000, "customerName": "Demo",
        "items": [["description": "Ring", "estimatedWeightG": 4, "karat": "21k", "metalType": "gold", "isCompleted": i % 2 == 0]],
        "ratesApplied": ["goldRatePerGram21k": 30_000],
    ] }

    private func decode<T: Decodable>(_ type: T.Type, _ docs: [[String: Any]]) -> [T] {
        docs.compactMap { DocJSON.decode(T.self, id: $0["id"] as? String ?? "", data: $0) }
    }

    func testTenTimesTheBooksDecodeAndAddUpInTime() throws {
        let start = Date()
        let invoices = decode(Invoice.self, Self.invoiceDocs)
        let hisaab = decode(HisaabEntry.self, Self.hisaabDocs)
        let orders = decode(Order.self, Self.orderDocs)
        let decoded = Date().timeIntervalSince(start)
        XCTAssertEqual(invoices.count, 5_000)
        XCTAssertEqual(hisaab.count, 42_000)
        XCTAssertEqual(orders.count, 1_600)

        let rulesStart = Date()
        let owed = owedToYou(invoices, ledgerRows: hisaab)
        let cash = todaysCash(invoices: invoices, orders: orders, repairs: [], extraRevenues: [], expenses: [])
        let taken = invoices.reduce(0) { $0 + invoiceSaleValue($1) }
        let rules = Date().timeIntervalSince(rulesStart)

        XCTAssertGreaterThan(owed.total, 0)
        XCTAssertGreaterThan(taken, 0)
        _ = cash
        print("[scale] decoded 48,600 documents in \(Int(decoded * 1000)) ms; owed, today's cash and sale value in \(Int(rules * 1000)) ms")
        // Generous ceilings: they catch a rule gone quadratic, not a slow machine.
        XCTAssertLessThan(decoded, 20, "decoding 48,600 documents")
        XCTAssertLessThan(rules, 5, "the dashboard's rules over ten times the books")
    }
}
