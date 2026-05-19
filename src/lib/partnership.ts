/**
 * Partnership math — shared between Mina's and Ammar's account pages.
 *
 * Ledger entries are classified as `equity` or `loan`:
 *   - payment + equity   → partner invests capital (counts toward their fair share)
 *   - payment + loan     → partner lends cash to the business (repayable first)
 *   - withdrawal + equity→ partner draws against their capital
 *   - withdrawal + loan  → business repays the partner's loan balance
 */

export type LedgerCategory = 'equity' | 'loan';
export type LedgerType = 'payment' | 'withdrawal';

export interface LedgerEntry {
  id: string;
  description: string;
  amount: number;
  date: Date;
  category: LedgerCategory;
}

export interface CategorisedLedger {
  equityIn: number;    // Σ payments classified as equity
  loanIn: number;      // Σ payments classified as loan
  equityOut: number;   // Σ withdrawals classified as equity (drawing against capital)
  loanOut: number;     // Σ withdrawals classified as loan (loan repayment received)
}

export function emptyCategorisedLedger(): CategorisedLedger {
  return { equityIn: 0, loanIn: 0, equityOut: 0, loanOut: 0 };
}

export function categorise(payments: LedgerEntry[], withdrawals: LedgerEntry[]): CategorisedLedger {
  const out = emptyCategorisedLedger();
  for (const p of payments) {
    if (p.category === 'loan') out.loanIn += p.amount;
    else out.equityIn += p.amount;
  }
  for (const w of withdrawals) {
    if (w.category === 'loan') out.loanOut += w.amount;
    else out.equityOut += w.amount;
  }
  return out;
}

export interface PartnerBalance {
  /** Sum of equity contributions minus equity draws (the partner's stake in retained capital). */
  equityBalance: number;
  /** Outstanding loan principal owed by the business to the partner. */
  loanBalance: number;
  /** Net share of post-partnership P&L attributable to this partner.
   *  Positive = profits earned; negative = losses absorbed. */
  netPnL: number;
  /** Total claim the partner has against the business right now.
   *  = loanBalance + (equityBalance + netPnL) */
  totalClaim: number;
}

/**
 * Compute the three-bucket view for one partner.
 *
 * @param l   categorised ledger
 * @param expShare partner's 50% share of all expenses since partnership start
 * @param revShare partner's 50% share of all revenue since partnership start
 */
export function partnerBalance(l: CategorisedLedger, expShare: number, revShare: number): PartnerBalance {
  const equityBalance = l.equityIn - l.equityOut;
  const loanBalance = l.loanIn - l.loanOut;
  const netPnL = revShare - expShare; // positive if revenue exceeds expense burden
  const totalClaim = loanBalance + equityBalance + netPnL;
  return { equityBalance, loanBalance, netPnL, totalClaim };
}

// ─── Distribution waterfall ──────────────────────────────────────────────────

export interface PartnerDistributionInput {
  name: string;
  loanBalance: number;
  equityBalance: number;
  netPnL: number;
}

export interface PartnerDistributionResult {
  name: string;
  loanRepayment: number;
  profitShare: number;
  equityDraw: number;
  total: number;
}

export interface DistributionResult {
  cashOnHand: number;
  workingCapitalFloor: number;
  distributableCash: number;
  totalLoanOutstanding: number;
  loanRepaymentsTotal: number;
  profitPoolTotal: number;
  perPartner: PartnerDistributionResult[];
  remainingAfter: number;
  feasible: boolean;
  shortfallToFirstDistribution: number;
}

/**
 * Run the standard distribution waterfall:
 *   1. Reserve working capital floor.
 *   2. Repay outstanding loans (pro-rata if not enough to cover all).
 *   3. Distribute remaining as equity draw, split 50/50.
 *
 * @param cashOnHand               business cash available right now
 * @param workingCapitalFloor      buffer that must remain
 * @param partners                 each partner's current loan + equity + P&L
 * @param distributionRatios       per-partner share for step 3 (defaults to equal)
 */
export function calculateDistribution(
  cashOnHand: number,
  workingCapitalFloor: number,
  partners: PartnerDistributionInput[],
  distributionRatios?: number[],
): DistributionResult {
  const distributableCash = Math.max(0, cashOnHand - workingCapitalFloor);

  const totalLoanOutstanding = partners.reduce((s, p) => s + Math.max(0, p.loanBalance), 0);
  const loanRepaymentsTotal = Math.min(distributableCash, totalLoanOutstanding);

  // If we can't cover all loans, repay each partner proportionally to their loan share.
  const perPartner: PartnerDistributionResult[] = partners.map((p) => {
    const loanShare = totalLoanOutstanding > 0 ? p.loanBalance / totalLoanOutstanding : 0;
    const loanRepayment = loanRepaymentsTotal * loanShare;
    return {
      name: p.name,
      loanRepayment,
      profitShare: 0,
      equityDraw: 0,
      total: loanRepayment,
    };
  });

  const profitPoolTotal = Math.max(0, distributableCash - loanRepaymentsTotal);

  // Default to equal split if no ratios supplied
  const ratios = distributionRatios && distributionRatios.length === partners.length
    ? distributionRatios
    : partners.map(() => 1 / partners.length);
  const ratioSum = ratios.reduce((s, r) => s + r, 0) || 1;

  for (let i = 0; i < partners.length; i++) {
    const share = (ratios[i] / ratioSum) * profitPoolTotal;
    perPartner[i].profitShare = share;
    perPartner[i].equityDraw = share;
    perPartner[i].total += share;
  }

  const feasible = distributableCash > 0;
  const shortfallToFirstDistribution = feasible ? 0 : Math.max(0, workingCapitalFloor - cashOnHand);

  return {
    cashOnHand,
    workingCapitalFloor,
    distributableCash,
    totalLoanOutstanding,
    loanRepaymentsTotal,
    profitPoolTotal,
    perPartner,
    remainingAfter: distributableCash - loanRepaymentsTotal - profitPoolTotal,
    feasible,
    shortfallToFirstDistribution,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export const fmtPKR = (n: number): string =>
  'PKR ' + Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
