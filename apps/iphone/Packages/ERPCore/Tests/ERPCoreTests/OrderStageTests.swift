import XCTest
@testable import ERPCore

/// src/lib/order-stage.test.ts, case for case.
final class OrderStageTests: XCTestCase {
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    /// `k(karigarId, isCompleted)` of the TS.
    private func k(_ karigarId: String? = nil, _ isCompleted: Bool = false) -> OrderItem {
        var fields: [String: Any] = ["isCompleted": isCompleted]
        if let karigarId { fields["karigarId"] = karigarId }
        return ERPDecode.model(OrderItem.self, from: fields)!
    }

    // MARK: statusFromPieces

    func testEveryPieceWithAKarigarTakesANewOrderToInProgress() {
        XCTAssertEqual(statusFromPieces(.pending, [k("a"), k("b")]), .inProgress)
        XCTAssertNil(statusFromPieces(.pending, [k("a"), k()]))
        XCTAssertNil(statusFromPieces(.pending, [k("a"), k("none")]))
    }

    func testEveryPieceFinishedTakesItToCompletedFromPendingOrInProgress() {
        XCTAssertEqual(statusFromPieces(.inProgress, [k("a", true), k("b", true)]), .completed)
        XCTAssertEqual(statusFromPieces(.pending, [k(nil, true)]), .completed)
        XCTAssertNil(statusFromPieces(.inProgress, [k("a", true), k("b")]))
    }

    func testNeverMovesAFinishedCancelledRefundedOrInvoicedOrderNorOneWithNoPieces() {
        for s in ["Completed", "Cancelled", "Refunded"] {
            XCTAssertNil(statusFromPieces(OrderStatus(rawValue: s), [k("a", true)]))
        }
        XCTAssertNil(statusFromPieces(.inProgress, [k("a", true)], invoiced: true))
        XCTAssertNil(statusFromPieces(.pending, []))
        XCTAssertNil(statusFromPieces(.pending, nil))
    }

    // MARK: statusAfterUntick

    func testAFinishedOrderGoesBackToInProgressUnlessItIsInvoiced() {
        XCTAssertEqual(statusAfterUntick(.completed), .inProgress)
        XCTAssertNil(statusAfterUntick(.completed, invoiced: true))
        XCTAssertNil(statusAfterUntick(.inProgress))
    }

    // MARK: stageOf

    func testSortsOrdersTheWayTheyAreWorked() {
        XCTAssertEqual(stageOf(order(["status": "Completed"])), .ready)
        XCTAssertEqual(stageOf(order(["status": "In Progress"])), .karigar)
        XCTAssertEqual(stageOf(order(["status": "Pending"])), .new)
        XCTAssertEqual(stageOf(order(["status": "Completed", "invoiceId": "INV-1"]), owedOnInvoice: 5000), .payment)
        XCTAssertEqual(stageOf(order(["status": "Completed", "invoiceId": "INV-1"]), owedOnInvoice: 0), .done)
        XCTAssertEqual(stageOf(order(["status": "Refunded", "invoiceId": "INV-1"]), owedOnInvoice: 5000), .closed)
        XCTAssertEqual(stageOf(order(["status": "Cancelled"])), .closed)
    }

    func testHoldsAConfirmedOnlineOrderAtTheTransferUntilTheMoneyIsIn() {
        func online(_ status: String, _ payment: String) -> Order { order(["status": status, "website": ["paymentStatus": payment]]) }
        XCTAssertEqual(stageOf(online("Pending", "awaiting_transfer")), .transfer)
        XCTAssertEqual(stageOf(online("Pending", "slip_sent")), .transfer)
        XCTAssertEqual(stageOf(online("Pending", "transfer_received")), .new)
        XCTAssertEqual(stageOf(online("Cancelled", "expired")), .closed)
    }

    // MARK: pieceCounts

    func testCountsPiecesThoseWithoutAKarigarAndThoseFinished() {
        XCTAssertEqual(pieceCounts([k("a", true), k(), k("none")]), PieceCounts(total: 3, unassigned: 2, done: 1))
        XCTAssertEqual(pieceCounts(nil), PieceCounts(total: 0, unassigned: 0, done: 0))
    }

    // MARK: bookedAsSale

    func testCountsACounterOrderOnceTakenNotOnceInvoicedOrClosed() {
        let at = "2026-10-04T10:00:00Z"
        XCTAssertTrue(bookedAsSale(order(["createdAt": at, "status": "Pending"])))
        XCTAssertFalse(bookedAsSale(order(["createdAt": at, "status": "Completed", "invoiceId": "INV-1"])))
        XCTAssertFalse(bookedAsSale(order(["createdAt": at, "status": "Cancelled"])))
        XCTAssertFalse(bookedAsSale(nil))
    }

    func testCountsAnOnlineOrderOnlyOnceItsTransferIsIn() {
        let at = "2026-10-04T10:00:00Z"
        func online(_ payment: String) -> Order { order(["createdAt": at, "status": "Pending", "website": ["paymentStatus": payment]]) }
        XCTAssertFalse(bookedAsSale(online("awaiting_transfer")))
        XCTAssertFalse(bookedAsSale(online("slip_sent")))
        XCTAssertTrue(bookedAsSale(online("transfer_received")))
    }

    // Not in the TS tests: the table the hub prints.
    func testTheStagesAreInTheOrderTheyAreWorkedWithAWordEach() {
        XCTAssertEqual(STAGE_ORDER.map(\.rawValue), ["transfer", "ready", "karigar", "new", "payment", "done", "closed"])
        XCTAssertEqual(Set(STAGES.keys), Set(OrderStage.allCases))
        XCTAssertEqual(STAGES[.ready]?.title, "Ready to hand over")
    }
}
