import XCTest
@testable import ERPCore

/// src/lib/machines/settlement.test.ts, case for case.
final class SettlementTests: XCTestCase {
    private func s(_ status: String? = nil, _ balance: Double? = nil, _ paid: Double? = nil) -> Settlement {
        settlementOf(status: status, balanceDue: balance, amountPaid: paid, machines: Machines(machines: []))
    }

    func testOwingWithNothingPaidIsDueWithSomethingPaidIsPartly() {
        let due = s(nil, 5_000, 0)
        XCTAssertEqual(due.state, .due)
        XCTAssertEqual(due.label, "Balance due")
        XCTAssertEqual(due.amountDue, 5_000)
        XCTAssertEqual(due.credit, 0)
        let partly = s(nil, 3_000, 2_000)
        XCTAssertEqual(partly.state, .partly)
        XCTAssertEqual(partly.amountDue, 3_000)
    }

    func testABalanceOfZeroIsPaidAndSoIsAnythingUnderARupeeEitherWay() {
        for b in [0, 0.4, -0.4, nil] as [Double?] {
            let p = s(nil, b)
            XCTAssertEqual(p.state, .paid)
            XCTAssertEqual(p.label, "Paid in full")
            XCTAssertEqual(p.amountDue, 0)
            XCTAssertEqual(p.credit, 0)
        }
        XCTAssertEqual(settlementOf(nil, machines: Machines(machines: [])).state, .paid)
    }

    func testABalanceBelowZeroIsTheCustomersCredit() {
        let c = s(nil, -5_000)
        XCTAssertEqual(c.state, .credit)
        XCTAssertEqual(c.label, "Credit to customer")
        XCTAssertEqual(c.amountDue, 0)
        XCTAssertEqual(c.credit, 5_000)
        XCTAssertEqual(s(nil, -1).state, .credit)
    }

    func testStatusRefundedWinsOverWhateverTheBalanceSays() {
        let r = s("Refunded", 11_850, 0)
        XCTAssertEqual(r.state, .refunded)
        XCTAssertEqual(r.label, "Refunded")
        XCTAssertEqual(r.amountDue, 0)
        XCTAssertEqual(r.credit, 0)
        let r2 = s("Refunded", -400)
        XCTAssertEqual(r2.state, .refunded)
        XCTAssertEqual(r2.credit, 0)
    }

    func testEveryStateHasALabelAndATone() {
        for st in SettlementState.allCases {
            XCTAssertFalse(SettlementRule.fallbackLabel(st).isEmpty)
            XCTAssertFalse(SettlementRule.fallbackTone(st).isEmpty)
        }
        XCTAssertEqual(s(nil, 5_000, 0).tone, "late")
        XCTAssertEqual(s(nil, 3_000, 2_000).tone, "owed")
        XCTAssertEqual(s(nil, 0).tone, "settled")
        XCTAssertEqual(s(nil, -5_000).tone, "credit")
        XCTAssertEqual(s("Refunded", 1).tone, "quiet")
    }

    func testBalanceLineKeepsItsOutputsAndARefundedInvoiceHasNoBalanceDue() {
        XCTAssertEqual(balanceLine(5_000), BalanceLine(label: "Balance due", amount: 5_000, state: .due))
        XCTAssertEqual(balanceLine(-5_000), BalanceLine(label: "Credit to customer", amount: 5_000, state: .credit))
        XCTAssertEqual(balanceLine(0), BalanceLine(label: "Paid in full", amount: 0, state: .paid))
        let r = balanceLine(11_850, status: "Refunded")
        XCTAssertEqual(r.label, "Refunded")
        XCTAssertEqual(r.amount, 0)
        XCTAssertTrue(r.refunded)
        XCTAssertFalse(r.label.lowercased().contains("due"))
        XCTAssertEqual(balanceLine(11_850, status: "Unpaid").state, .due)
    }

    func testIsReadFromMachinesJsonDerivedAndAMissingKeyFallsBack() {
        let json = """
        {"version":1,"machines":[],"derived":[{"name":"Invoice settlement","field":"x","states":["due","partly","paid","credit","refunded"],
        "labels":{"due":"Balance due","partly":"Balance due","paid":"Paid in full","credit":"Credit to customer","refunded":"Refunded"},
        "tones":{"due":"late","partly":"owed","paid":"settled","credit":"credit","refunded":"quiet"},"rule":"r"}]}
        """
        let m = Machines.decode(Data(json.utf8))!
        XCTAssertEqual(m.derivedRule("Invoice settlement")?.states.count, 5)
        XCTAssertEqual(m.derivedLabel("Invoice settlement", "refunded"), "Refunded")
        XCTAssertEqual(m.derivedTone("Invoice settlement", "credit"), "credit")
        XCTAssertEqual(settlementOf(status: "Refunded", balanceDue: 5, amountPaid: nil, machines: m).label, "Refunded")
        // A file from before `derived`, or an odd one, decodes to none and the rule's own words stand.
        let old = Machines.decode(Data(#"{"version":1,"machines":[]}"#.utf8))!
        XCTAssertTrue(old.derived.isEmpty)
        XCTAssertEqual(settlementOf(status: nil, balanceDue: 0, amountPaid: nil, machines: old).label, "Paid in full")
        let odd = Machines.decode(Data(#"{"version":1,"machines":[],"derived":[{"name":5},{"labels":3}]}"#.utf8))!
        XCTAssertNil(odd.derivedLabel("Invoice settlement", "due"))
    }
}
