import XCTest
@testable import ERPCore

/// machines.json as src/lib/machines/export.ts writes it (an inline sample: made-up, small).
final class MachinesTests: XCTestCase {
    private let sample = """
    {"version":1,"machines":[
     {"name":"Order","field":"orders/<id>.status","states":["Pending","In Progress","Completed","Cancelled","Refunded"],"final":["Refunded"],
      "labels":{"Pending":"Pending","In Progress":"In Progress","Completed":"Completed","Cancelled":"Cancelled","Refunded":"Refunded"},
      "tones":{"Pending":"owed","In Progress":"working","Completed":"settled","Cancelled":"quiet","Refunded":"quiet"},
      "moves":[
       {"from":["Pending","In Progress","Completed","Cancelled"],"to":"Pending","event":"set","when":"not invoiced","note":"reopen or send back"},
       {"from":["Pending","Completed","Cancelled"],"to":"In Progress","event":"set","when":"not invoiced"},
       {"from":["Pending","In Progress","Cancelled"],"to":"Completed","event":"set","when":"not invoiced"},
       {"from":["Pending","In Progress","Completed"],"to":"Cancelled","event":"set","when":"not invoiced"},
       {"from":["Pending","In Progress","Completed"],"to":"Refunded","event":"refund"}]},
     {"name":"Anything","field":"x.state","states":["a","b"],"final":[],"labels":{"a":"A","b":"B"},"tones":{"a":"quiet","b":"late"},
      "moves":[{"from":"*","to":"b","event":"set"}]}
    ]}
    """

    private func machines() -> Machines { Machines.decode(Data(sample.utf8))! }

    func testReadsLabelsAndTones() {
        let m = machines()
        XCTAssertEqual(m.version, 1)
        XCTAssertEqual(m.machines.count, 2)
        XCTAssertEqual(m.label("Order", "In Progress"), "In Progress")
        XCTAssertEqual(m.tone("Order", "Pending"), "owed")
        XCTAssertEqual(m.tone("Order", "Completed"), "settled")
        XCTAssertNil(m.label("Order", "Nope"))
        XCTAssertNil(m.tone("Nope", "Pending"))
    }

    func testMovesFromByEvent() {
        let m = machines()
        XCTAssertEqual(m.movesFrom("Order", "Pending", event: "set").map { $0.to }, ["Pending", "In Progress", "Completed", "Cancelled"])
        XCTAssertEqual(m.movesFrom("Order", "Pending").count, 4 + 1)
        XCTAssertEqual(m.movesFrom("Order", "Refunded").count, 0)
        XCTAssertEqual(m.movesFrom("Order", "Completed", event: "refund").map { $0.to }, ["Refunded"])
        XCTAssertEqual(m.movesFrom("Order", "Pending", event: "set").first?.when, "not invoiced")
        XCTAssertTrue(m.movesFrom("Nope", "Pending").isEmpty)
    }

    func testSettableNeverOffersRefundedAndKeepsMachineOrder() {
        let m = machines()
        XCTAssertEqual(m.settable("Order", from: "Cancelled"), ["Pending", "In Progress", "Completed"])
        XCTAssertEqual(m.settable("Order", from: "Pending"), ["Pending", "In Progress", "Completed", "Cancelled"])
        XCTAssertEqual(m.settable("Order", from: "Refunded"), [])
        XCTAssertNil(m.settable("Nope", from: "Pending"))
    }

    func testFromStarMeansAnyState() {
        let m = machines()
        XCTAssertEqual(m.movesFrom("Anything", "a", event: "set").map { $0.to }, ["b"])
        XCTAssertEqual(m.movesFrom("Anything", "whatever", event: "set").map { $0.to }, ["b"])
    }

    func testAnOddFileGivesFewerMachinesNotAThrow() {
        XCTAssertNil(Machines.decode(Data("[]".utf8)))
        let odd = Machines.decode(Data(#"{"machines":[{"name":"X"},7]}"#.utf8))
        XCTAssertEqual(odd?.machines.count, 1)
        XCTAssertEqual(odd?.machines.first?.moves.count, 0)
        XCTAssertTrue(Machines(machines: []).isEmpty)
    }

    func testARefusalSaysTheServersWordsAndWhatIsAllowed() {
        let m = machines()
        let body: [String: Any] = ["error": "A refunded order is final.", "machine": "Order", "from": "Refunded", "to": "Pending", "allowed": []]
        XCTAssertEqual(MachineRefusal.message(body, machines: m), "A refunded order is final.")
        let some: [String: Any] = ["error": "Not from Cancelled.", "machine": "Order", "from": "Cancelled", "to": "Refunded",
                                   "allowed": [["to": "Pending", "event": "set"], ["to": "Pending", "event": "undoInvoice"], ["to": "In Progress", "event": "set"]]]
        XCTAssertEqual(MachineRefusal.message(some, machines: m), "Not from Cancelled. It can be set to Pending, In Progress instead.")
        XCTAssertEqual(MachineRefusal.message(["error": "Plain."], machines: m), "Plain.")
        XCTAssertNil(MachineRefusal.message(["machine": "Order"], machines: m))
    }

    func testOrderChoicesAreTheMachinesSetMovesPlusTheCurrentOne() {
        let m = machines()
        XCTAssertEqual(m.orderStatusChoices(current: "Cancelled", invoiced: false), ["Pending", "In Progress", "Completed"] + ["Cancelled"])
        XCTAssertEqual(m.orderStatusChoices(current: "Pending", invoiced: false), ["Pending", "In Progress", "Completed", "Cancelled"])
        // Invoiced: read-only. Refunded: its own word only, never a choice.
        XCTAssertEqual(m.orderStatusChoices(current: "Completed", invoiced: true), ["Completed"])
        XCTAssertEqual(m.orderStatusChoices(current: "Refunded", invoiced: false), ["Refunded"])
        XCTAssertFalse(m.orderStatusChoices(current: "Pending", invoiced: false).contains("Refunded"))
        XCTAssertTrue(m.canSetOrder(from: "Pending", to: "Completed", invoiced: false))
        XCTAssertFalse(m.canSetOrder(from: "Pending", to: "Completed", invoiced: true))
        XCTAssertFalse(m.canSetOrder(from: "Pending", to: "Pending", invoiced: false))
        // A status the file does not know keeps the old list.
        XCTAssertEqual(m.orderStatusChoices(current: "Old", invoiced: false), ["Pending", "In Progress", "Completed", "Cancelled", "Old"])
    }

    func testNoFileKeepsTheOldChoices() {
        let none = Machines(machines: [])
        XCTAssertEqual(none.orderStatusChoices(current: "Pending", invoiced: false), ["Pending", "In Progress", "Completed", "Cancelled"])
        XCTAssertEqual(none.orderStatusChoices(current: "Refunded", invoiced: false), ["Pending", "In Progress", "Completed", "Cancelled", "Refunded"])
        XCTAssertTrue(none.canSetRepair(from: "received", to: "ready"))
    }

    func testRepairMovesFollowTheMachine() {
        let repair = Machine(name: "Repair", states: ["received", "ready", "collected", "cancelled"], moves: [
            MachineMove(from: ["ready", "cancelled", "collected"], to: "received", event: "set"),
            MachineMove(from: ["received", "collected"], to: "ready", event: "set"),
            MachineMove(from: ["received", "ready"], to: "collected", event: "set", when: "nothing owed"),
            MachineMove(from: ["received", "ready"], to: "cancelled", event: "set"),
        ])
        let m = Machines(machines: [repair])
        XCTAssertTrue(m.canSetRepair(from: "received", to: "ready"))
        XCTAssertTrue(m.canSetRepair(from: "ready", to: "collected"))
        XCTAssertFalse(m.canSetRepair(from: "cancelled", to: "collected"))
        XCTAssertFalse(m.canSetRepair(from: "collected", to: "cancelled"))
    }
}
