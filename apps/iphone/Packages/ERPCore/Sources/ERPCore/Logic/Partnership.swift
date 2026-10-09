// Ported from src/lib/partnership.ts and the date rules of src/lib/partnership-settings.ts
// (tests: PartnershipTests, from partnership.test.ts).
//
// Ledger entries are classified as equity or loan:
//   - payment + equity    → partner invests capital (counts toward their fair share)
//   - payment + loan      → partner lends cash to the business (repayable first)
//   - withdrawal + equity → partner draws against their capital
//   - withdrawal + loan   → business repays the partner's loan balance

import Foundation

public enum Partnership {
    /// The expense category for money a shareholder takes out of the business.
    public static let partnerDrawings = "Partner Drawings"

    /// The expense category for a partner paying themselves for work done. Unlike a draw, a salary IS a
    /// cost of doing business, so it stays inside every profit figure: on a 50/50 split one partner's
    /// salary comes half out of the other partner's share. Equal salaries cancel out; unequal ones do not.
    public static let partnerSalary = "Partner Salary"

    /// lib/partnership-settings.ts DEFAULT_WORKING_CAPITAL_FLOOR.
    public static let defaultWorkingCapitalFloor: Double = 500_000

    /// Is this expense a genuine cost of doing business? A drawing is a distribution of profit, not a
    /// cost of earning it; a salary is a real cost, whether or not the partner owns the place.
    public static func isBusinessCost(category: String?) -> Bool { category != partnerDrawings }

    public static func isBusinessCost(_ e: Expense) -> Bool { isBusinessCost(category: e.category) }

    public static func categorise(payments: [ShareholderLedgerRow], withdrawals: [ShareholderLedgerRow]) -> CategorisedLedger {
        var out = CategorisedLedger()
        for p in payments {
            if p.category == .loan { out.loanIn += p.amount } else { out.equityIn += p.amount }
        }
        for w in withdrawals {
            if w.category == .loan { out.loanOut += w.amount } else { out.equityOut += w.amount }
        }
        return out
    }

    /// The three-bucket view for one partner. `expShare` and `revShare` are their 50% of every expense
    /// and of all revenue since the partnership started.
    public static func partnerBalance(_ l: CategorisedLedger, expShare: Double, revShare: Double) -> PartnerBalance {
        let equityBalance = l.equityIn - l.equityOut
        let loanBalance = l.loanIn - l.loanOut
        let netPnL = revShare - expShare // positive if revenue exceeds expense burden
        let totalClaim = loanBalance + equityBalance + netPnL
        return PartnerBalance(equityBalance: equityBalance, loanBalance: loanBalance, netPnL: netPnL, totalClaim: totalClaim)
    }

    // MARK: Distribution waterfall

    /// The standard waterfall: hold back the working-capital floor, repay outstanding loans (pro rata if
    /// there is not enough for all), then split what remains as an equity draw, equally unless ratios are
    /// given for every partner.
    public static func calculateDistribution(
        cashOnHand: Double, workingCapitalFloor: Double, partners: [PartnerDistributionInput], distributionRatios: [Double]? = nil
    ) -> DistributionResult {
        let distributableCash = max(0, cashOnHand - workingCapitalFloor)

        let totalLoanOutstanding = partners.reduce(0) { $0 + max(0, $1.loanBalance) }
        let loanRepaymentsTotal = min(distributableCash, totalLoanOutstanding)

        // If we can't cover all loans, repay each partner proportionally to their loan share.
        var perPartner: [PartnerDistributionResult] = partners.map { p in
            let loanShare = totalLoanOutstanding > 0 ? p.loanBalance / totalLoanOutstanding : 0
            let loanRepayment = loanRepaymentsTotal * loanShare
            return PartnerDistributionResult(name: p.name, loanRepayment: loanRepayment, profitShare: 0, equityDraw: 0, total: loanRepayment)
        }

        let profitPoolTotal = max(0, distributableCash - loanRepaymentsTotal)

        let ratios: [Double]
        if let given = distributionRatios, given.count == partners.count {
            ratios = given
        } else {
            ratios = partners.map { _ in 1 / Double(partners.count) }
        }
        let summed = ratios.reduce(0, +)
        let ratioSum = summed != 0 && !summed.isNaN ? summed : 1

        for i in partners.indices {
            let share = (ratios[i] / ratioSum) * profitPoolTotal
            perPartner[i].profitShare = share
            perPartner[i].equityDraw = share
            perPartner[i].total += share
        }

        let feasible = distributableCash > 0
        let shortfallToFirstDistribution = feasible ? 0 : max(0, workingCapitalFloor - cashOnHand)

        return DistributionResult(
            cashOnHand: cashOnHand,
            workingCapitalFloor: workingCapitalFloor,
            distributableCash: distributableCash,
            totalLoanOutstanding: totalLoanOutstanding,
            loanRepaymentsTotal: loanRepaymentsTotal,
            profitPoolTotal: profitPoolTotal,
            perPartner: perPartner,
            remainingAfter: distributableCash - loanRepaymentsTotal - profitPoolTotal,
            feasible: feasible,
            shortfallToFirstDistribution: shortfallToFirstDistribution
        )
    }

    // MARK: The floor's review (partnership-settings.ts)

    private static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    /// True when the floor hasn't been touched since the start of the current calendar month.
    public static func isFloorStale(_ settings: PartnershipSettings, now: Date = Date()) -> Bool {
        guard let last = JS.newDate(settings.floorLastSetAt) else { return true }
        return karachi.component(.year, from: last) != karachi.component(.year, from: now)
            || karachi.component(.month, from: last) != karachi.component(.month, from: now)
    }

    /// True only during the first 5 days of the month: the "review me" banner.
    public static func isMonthStart(now: Date = Date()) -> Bool {
        karachi.component(.day, from: now) <= 5
    }
}

public struct CategorisedLedger: Hashable {
    /// Σ payments classified as equity.
    public var equityIn: Double = 0
    /// Σ payments classified as loan.
    public var loanIn: Double = 0
    /// Σ withdrawals classified as equity (drawing against capital).
    public var equityOut: Double = 0
    /// Σ withdrawals classified as loan (loan repayment received).
    public var loanOut: Double = 0

    public init(equityIn: Double = 0, loanIn: Double = 0, equityOut: Double = 0, loanOut: Double = 0) {
        self.equityIn = equityIn
        self.loanIn = loanIn
        self.equityOut = equityOut
        self.loanOut = loanOut
    }
}

public struct PartnerBalance: Hashable {
    /// Equity contributions less equity draws: the partner's stake in retained capital.
    public let equityBalance: Double
    /// Outstanding loan principal the business owes the partner.
    public let loanBalance: Double
    /// Their share of the P&L since the partnership started: positive is profit, negative a loss absorbed.
    public let netPnL: Double
    /// What the partner can claim from the business right now: loan + equity + P&L.
    public let totalClaim: Double

    public init(equityBalance: Double, loanBalance: Double, netPnL: Double, totalClaim: Double) {
        self.equityBalance = equityBalance
        self.loanBalance = loanBalance
        self.netPnL = netPnL
        self.totalClaim = totalClaim
    }
}

public struct PartnerDistributionInput: Hashable {
    public let name: String
    public let loanBalance: Double
    public let equityBalance: Double
    public let netPnL: Double

    public init(name: String, loanBalance: Double, equityBalance: Double, netPnL: Double) {
        self.name = name
        self.loanBalance = loanBalance
        self.equityBalance = equityBalance
        self.netPnL = netPnL
    }
}

public struct PartnerDistributionResult: Hashable {
    public let name: String
    public let loanRepayment: Double
    public var profitShare: Double
    public var equityDraw: Double
    public var total: Double
}

public struct DistributionResult: Hashable {
    public let cashOnHand: Double
    public let workingCapitalFloor: Double
    public let distributableCash: Double
    public let totalLoanOutstanding: Double
    public let loanRepaymentsTotal: Double
    public let profitPoolTotal: Double
    public let perPartner: [PartnerDistributionResult]
    public let remainingAfter: Double
    public let feasible: Bool
    public let shortfallToFirstDistribution: Double
}
