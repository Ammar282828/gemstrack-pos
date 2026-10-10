import SwiftUI
import ERPCore

/// Money → Shareholders (src/app/shareholders/page.tsx): the two partners side by side, who is in for
/// how much. Divided equally: revenue and expenses since the partnership started, each partner's loan,
/// equity and half of the P&L from their own ledger, what unequal salaries move between them, and the
/// distribution calculator (loans repaid first, then the split, above the working-capital floor).
///
/// Every figure is the page's own (ERPCore ShareholderFigures and Partnership, ported from
/// lib/shareholder-figures.ts and lib/partnership.ts). Paying a salary, a contribution and a withdrawal
/// are native; so are deleting an entry or a salary payment, which ask for the delete code the ERP checks
/// with the delete. Only the house that keeps partner ledgers has this page (`session.shop.partnership`).
struct ShareholdersScreen: View {
    @Environment(Session.self) private var session

    var body: some View {
        if !session.isOwner {
            MoneyOwnersOnly(title: "Shareholders")
        } else if !session.shop.partnership {
            // Reachable by address from either house; only one keeps this book.
            ContentUnavailableView("No partner ledgers", systemImage: "person.2", description: Text("This shop keeps no partner ledgers."))
                .navigationTitle("Shareholders")
        } else {
            ShareholdersBoard()
        }
    }
}

/// The partners' own books and the floor, read live for this screen only: the shop's Book has no
/// shelves for them, and nobody else reads them. Owners read Firestore themselves, as the page does.
@MainActor
final class ShareholderBooks {
    let mina = Shelf<ShareholderLedgerRow>(Collections.minaLedger) { $0.date > $1.date }
    let ammar = Shelf<ShareholderLedgerRow>(Collections.ammarLedger) { $0.date > $1.date }
    let floor = Single<PartnershipSettings>(Collections.settings, "partnership")

    func need() {
        mina.need()
        ammar.need()
        floor.need()
    }

    /// Off the screen, the listeners stop; coming back starts them again.
    func stop() {
        mina.reset()
        ammar.reset()
        floor.reset()
    }
}

/// Everything the page works out from the books, once per change of them.
struct ShareholderBoardFigures {
    let totals: ShareholderFigures.Totals
    let positions: [ShareholderFigures.Position]
    let gap: ShareholderFigures.SalaryGap?
}

private struct ShareholdersBoard: View {
    @Environment(Book.self) private var book

    @State private var books = ShareholderBooks()
    @State private var figures = Memo<ShareholderBoardFigures>()
    @State private var asking: ShareholderAsk?
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?
    @State private var cashText = ""
    @State private var floorText: String?
    @State private var savingFloor = false
    @State private var floorError: String?
    @State private var showHistory = false

    private var ready: Bool {
        book.expenses.loaded && book.invoices.loaded && book.orders.loaded && book.revenue.loaded
            && books.mina.loaded && books.ammar.loaded && books.floor.loaded
    }

    private var readError: String? {
        books.mina.error ?? books.ammar.error ?? book.expenses.error ?? book.invoices.error ?? book.orders.error ?? book.revenue.error
    }

    var body: some View {
        ShelfState(loaded: ready, error: readError, offline: book.expenses.offline) {
            content
        }
        .navigationTitle("Shareholders")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { asking = ShareholderAsk(move: .contribution, who: "mina") } label: { Label("Add contribution", systemImage: "plus") }
                    Button { asking = ShareholderAsk(move: .salary, who: "mina") } label: { Label("Pay salary", systemImage: "banknote") }
                    Button { asking = ShareholderAsk(move: .withdrawal, who: "mina") } label: { Label("Withdraw capital", systemImage: "arrow.up.right") }
                } label: {
                    Label("Add", systemImage: "plus")
                }
            }
        }
        .sheet(item: $asking) { (a: ShareholderAsk) in
            ShareholderEntrySheet(ask: a, salaryPaid: salaryPaid) { (saved: OwnerNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                withAnimation { note = OwnerNote(title: d.what.hasPrefix("Delete expense") ? "Salary payment removed" : "Entry removed") }
            }
        }
        .ownerNote($note)
        .task {
            book.expenses.need()
            book.invoices.need()
            book.orders.need()
            book.revenue.need()
            books.need()
        }
        .onDisappear { books.stop() }
    }

    private var salaryPaid: [String: Double] {
        Dictionary(uniqueKeysWithValues: reckon().positions.map { ($0.id, $0.salaryPaid) })
    }

    private func reckon() -> ShareholderBoardFigures {
        let key = [book.expenses.revision, book.invoices.revision, book.orders.revision, book.revenue.revision,
                   books.mina.revision, books.ammar.revision]
        return figures(key) {
            let totals = ShareholderFigures.partnershipTotals(
                expenses: book.expenses.items, invoices: book.invoices.items, orders: book.orders.items,
                additionalRevenues: book.revenue.items)
            let ledgers = [
                "mina": ShareholderFigures.shown(books.mina.items),
                "ammar": ShareholderFigures.shown(books.ammar.items),
            ]
            let positions = ShareholderFigures.partnerPositions(
                partners: ShareholderPerson.all.map { (id: $0.id, name: $0.name) },
                ledgers: ledgers,
                salariesBy: ShareholderFigures.salariesByPartner(book.expenses.items),
                totals: totals)
            return ShareholderBoardFigures(totals: totals, positions: positions, gap: ShareholderFigures.salaryGap(positions))
        }
    }

    // MARK: The page

    @ViewBuilder
    private var content: some View {
        let f = reckon()
        List {
            Group {
                tilesSection(f.totals)
                ForEach(f.positions) { (p: ShareholderFigures.Position) in partnerSection(p) }
                notesSection(f)
                distributionSection(f.positions)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func tilesSection(_ t: ShareholderFigures.Totals) -> some View {
        let share = t.revShare - t.expShare
        return Section {
            VStack(spacing: 10) {
                FigureRow(alignment: .top, spacing: 10) {
                    FigureTile(label: "Revenue", value: ShareholderMoney.fmt(t.totalRevenue), tint: .green)
                    FigureTile(label: "Expenses", value: ShareholderMoney.fmt(t.totalExpenses))
                }
                FigureTile(label: "Each partner's share", value: ShareholderMoney.signed(share), tint: share >= 0 ? .green : .red)
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
        } header: {
            Text("Divided equally · expenses from \(OwnerText.shortDate(ShareholderFigures.expenseCutoff)) · revenue from Shopify #1103")
                .textCase(nil)
        }
    }

    // MARK: Each partner

    private func partnerSection(_ p: ShareholderFigures.Position) -> some View {
        let claim = p.balance.totalClaim
        let owed = claim > 0
        let words = owed ? "The business owes \(p.name)" : (claim < 0 ? "\(p.name) owes the business" : "All settled")
        let tone: Color = owed ? Color.green : (claim < 0 ? Color.orange : Color.primary)
        return Section {
            Group {
                HStack(alignment: .firstTextBaseline) {
                    Text(words).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Text(ShareholderMoney.fmt(claim))
                        .font(.title2.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(tone)
                }
                LabeledContent("Loan to the business") { Text(ShareholderMoney.fmt(p.balance.loanBalance)).monospacedDigit() }
                LabeledContent("Equity in the business") { Text(ShareholderMoney.fmt(p.balance.equityBalance)).monospacedDigit() }
                LabeledContent("Half of profit & loss") {
                    Text(ShareholderMoney.signed(p.balance.netPnL))
                        .monospacedDigit()
                        .foregroundStyle(p.balance.netPnL >= 0 ? Color.green : Color.red)
                }
                HStack(spacing: 8) {
                    smallFigure("Contributed", p.contributed, symbol: "arrow.down.left")
                    smallFigure("Salary", p.salaryPaid, symbol: "banknote")
                    smallFigure("Capital drawn", p.withdrawn, symbol: "arrow.up.right")
                }
            }
            Group {
                Button { asking = ShareholderAsk(move: .salary, who: p.id) } label: { Label("Pay salary", systemImage: "banknote") }
                Button { asking = ShareholderAsk(move: .contribution, who: p.id) } label: { Label("Add a contribution", systemImage: "plus.circle") }
                Button { asking = ShareholderAsk(move: .withdrawal, who: p.id) } label: {
                    Label("Withdraw capital", systemImage: "arrow.up.right.circle")
                }
            }
            Group {
                if p.rows.isEmpty && p.salaries.isEmpty {
                    Text("No entries recorded.").foregroundStyle(.secondary)
                }
                ForEach(p.salaries) { (e: Expense) in salaryRow(e, of: p) }
                ForEach(p.rows) { (r: ShareholderLedgerRow) in ledgerRow(r, of: p) }
            }
        } header: {
            Text(p.name).font(.headline).foregroundStyle(.primary).textCase(nil)
        } footer: {
            if !(p.rows.isEmpty && p.salaries.isEmpty) {
                Text("Withdrawing capital reduces their stake; it is not a salary. Swipe an entry to delete it.")
            }
        }
    }

    private func smallFigure(_ label: String, _ amount: Double, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(label, systemImage: symbol).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Text(ShareholderMoney.fmt(amount)).font(.subheadline.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func salaryRow(_ e: Expense, of p: ShareholderFigures.Position) -> some View {
        let shown = e.description.replacingOccurrences(of: "\(p.name) salary \u{2014} ", with: "")
        return TwoLine(
            title: shown,
            subtitle: "\(OwnerText.shortDate(e.date)) · Salary · recorded as a business cost",
            trailing: ShareholderMoney.fmt(e.amount),
            trailingTint: Theme.accent
        )
        .swipeActions {
            Button(role: .destructive) {
                deletion = OwnerDeletion(
                    what: "Delete expense \"\(e.description)\"",
                    detail: "Remove this salary payment? \(e.description) \u{2014} \(ShareholderMoney.fmt(e.amount)). It will be deleted from Expenses too."
                ) { code in
                    _ = try await ERPAPI.shared.write("deletePartnerSalary", ["expenseId": e.id, "deleteCode": code])
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func ledgerRow(_ r: ShareholderLedgerRow, of p: ShareholderFigures.Position) -> some View {
        let isIn = r.type == .payment
        var sub = "\(OwnerText.shortDate(r.date)) · \(r.category == .loan ? "Loan" : "Equity")"
        if r.linkedExpenseId != nil { sub += " · logged as an expense" }
        let linked = r.linkedExpenseId != nil
        return TwoLine(
            title: r.description,
            subtitle: sub,
            trailing: "\(isIn ? "+" : "\u{2212}")\(ShareholderMoney.fmt(r.amount))",
            trailingTint: isIn ? Color.green : Color.orange
        )
        .swipeActions {
            Button(role: .destructive) {
                deletion = OwnerDeletion(
                    what: "Delete this \(p.name) ledger entry",
                    detail: "Remove this entry? \(r.description) \u{2014} \(ShareholderMoney.fmt(r.amount))."
                        + (linked ? " The matching Partner Drawings expense will be deleted too." : "")
                ) { code in
                    _ = try await ERPAPI.shared.write("deleteShareholderEntry", ["shareholderId": p.id, "entryId": r.id, "deleteCode": code])
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    // MARK: What the figures mean

    @ViewBuilder
    private func notesSection(_ f: ShareholderBoardFigures) -> some View {
        if f.gap != nil || f.totals.drawings > 0 {
            Section {
                if let g = f.gap {
                    Label {
                        Text("\(g.ahead.name) has drawn \(ShareholderMoney.fmt(g.ahead.salaryPaid - g.behind.salaryPaid)) more salary than \(g.behind.name). A salary is a business cost split 50/50, so that gap has moved about \(ShareholderMoney.fmt(g.transferred)) from \(g.behind.name) to \(g.ahead.name). Equal salaries cancel out entirely.")
                    } icon: {
                        Image(systemName: "info.circle")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                if f.totals.drawings > 0 {
                    Label {
                        Text("\(ShareholderMoney.fmt(f.totals.drawings)) of drawings sits in Expenses under \u{201C}\(Partnership.partnerDrawings)\u{201D}. It is left out of the profit split above, because a draw already reduces that partner's own equity \u{2014} counting it as a shared cost as well would charge them for it twice.")
                    } icon: {
                        Image(systemName: "info.circle")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Distribution calculator

    private var floorSettings: PartnershipSettings { books.floor.value ?? .none }

    private func distributionSection(_ positions: [ShareholderFigures.Position]) -> some View {
        let s = floorSettings
        let cash = max(0, MoneyParse.amount(cashText) ?? 0)
        // The calculator holds back the floor as saved, as the page's does (onFloorChange fires on load and save).
        let d = Partnership.calculateDistribution(
            cashOnHand: cash, workingCapitalFloor: max(0, s.workingCapitalFloor),
            partners: positions.map { p in
                PartnerDistributionInput(name: p.name, loanBalance: p.balance.loanBalance, equityBalance: p.balance.equityBalance, netPnL: p.balance.netPnL)
            })
        return Section {
            if Partnership.isFloorStale(s) && Partnership.isMonthStart() {
                Label {
                    Text("It's a new month \u{2014} review the working-capital floor for \(Overheads.monthLabel(Overheads.monthKey(Date()))). Last set: \(lastSet(s)).")
                } icon: {
                    Image(systemName: "exclamationmark.circle")
                }
                .font(.footnote)
                .foregroundStyle(.orange)
            }
            LabeledContent("Cash available") {
                TextField("0", text: $cashText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            floorRow(s)
            if !s.floorHistory.isEmpty {
                DisclosureGroup(isExpanded: $showHistory) {
                    // Newest first, as the page lists them.
                    ForEach(Array(s.floorHistory.indices.reversed()), id: \.self) { (i: Int) in
                        floorHistoryRow(s.floorHistory[i])
                    }
                } label: {
                    Text("Last reviewed: \(s.floorLastSetAt.map { OwnerText.shortDate($0) } ?? "\u{2014}") · \(s.floorHistory.count) change\(s.floorHistory.count == 1 ? "" : "s")")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if cash > 0 {
                LabeledContent("Held back as working capital") { Text(ShareholderMoney.fmt(d.workingCapitalFloor)).monospacedDigit() }
                LabeledContent("Available to distribute") { Text(ShareholderMoney.fmt(d.distributableCash)).monospacedDigit() }
                ForEach(d.perPartner, id: \.name) { (pr: PartnerDistributionResult) in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(pr.name).fontWeight(.medium)
                            Spacer(minLength: 8)
                            Text(ShareholderMoney.fmt(pr.total)).fontWeight(.medium).monospacedDigit()
                        }
                        Text("loan \(ShareholderMoney.fmt(pr.loanRepayment))   equity \(ShareholderMoney.fmt(pr.equityDraw))   profit \(ShareholderMoney.fmt(pr.profitShare))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
                if !d.feasible {
                    Text("Not enough to clear the floor and the loans \u{2014} \(ShareholderMoney.fmt(d.shortfallToFirstDistribution)) short.")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }
            if let floorError {
                Label(floorError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
        } header: {
            LedgerHeading(title: "Distribution calculator")
        } footer: {
            Text("If there were cash to distribute, this is how it would flow \u{2014} loans repaid first, then the split.")
        }
    }

    private func floorHistoryRow(_ entry: FloorHistoryEntry) -> some View {
        let when = OwnerText.shortDate(entry.date)
        let who = entry.by.map { "\(when) · \($0)" } ?? when
        return LabeledContent(who) {
            Text(Money.pkr(entry.value)).monospacedDigit()
        }
        .font(.footnote)
    }

    private func lastSet(_ s: PartnershipSettings) -> String {
        let when = s.floorLastSetAt.map { OwnerText.shortDate($0) } ?? "\u{2014}"
        if let by = s.floorHistory.last?.by, !by.isEmpty { return "\(when) by \(by)" }
        return when
    }

    /// The floor, edited where it is shown and saved with a stamp (`setWorkingCapitalFloor`).
    private func floorRow(_ s: PartnershipSettings) -> some View {
        let typed = floorText ?? PaymentText.field(s.workingCapitalFloor)
        let parsed = max(0, MoneyParse.amount(typed) ?? 0)
        let changed = parsed != s.workingCapitalFloor
        return HStack(spacing: 10) {
            Text("Working capital floor")
            Spacer(minLength: 8)
            TextField("0", text: Binding(get: { typed }, set: { floorText = $0 }))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(maxWidth: 130)
            if changed {
                Button {
                    Task { await saveFloor(parsed) }
                } label: {
                    if savingFloor { SkeletonLoading() } else { Text("Save") }
                }
                .buttonStyle(.houseProminent)
                .disabled(savingFloor)
            } else {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
        }
    }

    private func saveFloor(_ value: Double) async {
        savingFloor = true
        floorError = nil
        do {
            _ = try await ERPAPI.shared.write("setWorkingCapitalFloor", ["value": value, "seq": UUID().uuidString])
            floorText = nil
            withAnimation { note = OwnerNote(title: "Working capital floor saved", detail: "\(Money.pkr(value)) \u{2014} recorded with timestamp.") }
        } catch {
            floorError = error.localizedDescription
        }
        savingFloor = false
    }
}
