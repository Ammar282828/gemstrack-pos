import SwiftUI
import ERPCore

/// Money → Overheads (src/app/overheads/page.tsx): what this month has to cover before anything is profit,
/// whether each month since the benchmark started did, and the sheet that makes the target.
///
/// The sheet is a benchmark, not a ledger: nothing on it is an expense, counted against profit or put in
/// the hisaab. Its plans come from the ERP (/api/app/overheads, resolved as the page resolves them, the
/// starting sheet included); the score is worked out here from the books by the page's own rules
/// (ERPCore Overheads, ported from lib/overheads.ts). A save applies from this month on, so a month
/// already scored keeps the target it was scored against (`saveOverheadPlan`, lib/writes/overheads.ts).
struct OverheadsScreen: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isOwner {
            OverheadsBoard()
        } else {
            MoneyOwnersOnly(title: "Overheads")
        }
    }
}

/// One line of the sheet as it is being typed: the amount kept as typed, read the way the web's
/// amount box reads it.
struct OverheadDraftLine: Identifiable, Equatable {
    var id: String
    var label: String
    var amountText: String

    init(id: String) {
        self.id = id
        label = ""
        amountText = ""
    }

    init(_ item: OverheadItem) {
        id = item.id
        label = item.label
        // A sale-flow number field shows 0 as blank (decision "Number fields").
        amountText = item.amount == 0 ? "" : PaymentText.field(item.amount)
    }

    var item: OverheadItem { OverheadItem(id: id, label: label, amount: MoneyParse.rupees(amountText) ?? 0) }

    static func lines(_ items: [OverheadItem]) -> [OverheadDraftLine] { items.map { OverheadDraftLine($0) } }
}

private struct OverheadsBoard: View {
    @Environment(Book.self) private var book

    @State private var answer: OverheadPlansAnswer?
    @State private var loadError: String?
    @State private var lines: [OverheadDraftLine] = []
    @State private var saving = false
    @State private var saveError: String?
    @State private var note: Note?
    /// Bumped on each saved sheet, so the money tap fires on the event.
    @State private var savedCount = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// One clock for the whole screen, so the month boundary and the days-left figure cannot disagree
    /// part-way down.
    @State private var now = Date()
    @State private var revenueMemo = Memo<[String: OverheadRevenue]>()

    private var thisMonth: String { Overheads.monthKey(now) }
    private var monthName: String { Overheads.monthLabel(thisMonth).components(separatedBy: " ").first ?? "" }
    private var plans: [OverheadPlan] { answer?.plans ?? [] }
    /// The sheet in force this month, as saved.
    private var liveItems: [OverheadItem] { Overheads.planForMonth(plans, thisMonth) ?? [] }
    /// What is on screen: the bar moves with an edit before it is saved.
    private var items: [OverheadItem] { lines.map(\.item) }
    private var dirty: Bool { answer != nil && lines != OverheadDraftLine.lines(liveItems) }

    private var ready: Bool { (answer != nil || loadError != nil) && book.invoices.loaded && book.orders.loaded }

    var body: some View {
        ShelfState(loaded: ready, error: book.invoices.error ?? book.orders.error, offline: book.invoices.offline) {
            content
        }
        .navigationTitle("Overheads")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { add() } label: { Label("Add a line", systemImage: "plus") }
                    .disabled(answer == nil)
                    #if os(macOS)
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                    .help("Add a line to the sheet (\u{21E7}\u{2318}L)")
                    #endif
            }
            #if os(macOS)
            ToolbarItem(placement: .confirmationAction) {
                Button("Save from \(monthName)") { Task { await save() } }
                    .disabled(!dirty || saving)
                    .keyboardShortcut("s", modifiers: .command)
                    .help("Save the sheet from this month on (\u{2318}S)")
            }
            #endif
        }
        #if os(macOS)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if dirty {
                MacActionFooter(
                    primary: .init("Save from \(monthName)", isBusy: saving) { Task { await save() } },
                    secondary: [.init("Discard", systemImage: "arrow.uturn.backward", isDisabled: saving) {
                        lines = OverheadDraftLine.lines(liveItems)
                        saveError = nil
                    }],
                    summary: "The sheet has changes that are not saved yet")
            }
        }
        #else
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if dirty { saveBar }
        }
        #endif
        .noteToast($note)
        .failureAlert($saveError, title: "Not saved")
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .task {
            book.invoices.need()
            book.orders.need()
            await load()
        }
    }

    // MARK: Reading

    /// The plans, from the ERP. What arrives is adopted, but never over the top of an edit in progress.
    private func load() async {
        let wasDirty = dirty
        do {
            let a = try await ERPAPI.shared.get("/api/app/overheads", as: OverheadPlansAnswer.self)
            answer = a
            loadError = nil
            now = Date()
            if !wasDirty { lines = OverheadDraftLine.lines(liveItems) }
        } catch {
            if answer == nil { loadError = error.localizedDescription }
        }
    }

    // MARK: The page

    @ViewBuilder
    private var content: some View {
        let revenue = revenueMemo([book.invoices.revision, book.orders.revision]) {
            Overheads.revenueByMonth(invoices: book.invoices.items, orders: book.orders.items)
        }
        let rows = Overheads.monthlyRows(plans, revenue: revenue, now: now)
        let summary = Overheads.benchmarkSummary(rows)
        let current = rows.first { (r: OverheadMonthRow) in r.inProgress }
        let target = Overheads.overheadTotal(items)
        let earned = current?.earned ?? 0
        let p = Overheads.overheadProgress(target: target, earned: earned, now: now)
        if answer == nil, let loadError {
            ErrorState(loadError) { Task { await load() } }
        } else {
            #if os(macOS)
            macBoard(rows: rows, summary: summary, target: target, earned: earned, p: p)
            #else
            sheetList(rows: rows, summary: summary, target: target, earned: earned, p: p)
            #endif
        }
    }

    private func sheetList(rows: [OverheadMonthRow], summary: OverheadSummary, target: Double, earned: Double, p: OverheadProgress) -> some View {
        List {
            Group {
                thisMonthSection(target: target, earned: earned, p: p)
                recordSection(rows, summary)
                if answer != nil { sheetSection(target) }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
        .motion(lines.count)
    }

    // MARK: This month, first

    private func thisMonthSection(target: Double, earned: Double, p: OverheadProgress) -> some View {
        let met = p.shortfall == 0 && target > 0
        return Section {
            VStack(spacing: 10) {
                FigureRow(alignment: .top, spacing: 10) {
                    FigureTile(label: "Needed this month", value: OwnerText.pkr(target), tint: Theme.accent)
                    FigureTile(label: "Revenue so far", value: OwnerText.pkr(earned))
                }
                VStack(alignment: .leading, spacing: 10) {
                    ProgressView(value: p.percent, total: 100).tint(Theme.accent)
                    if met {
                        Label("Covered \u{2014} \(OwnerText.pkr(earned - target)) above the benchmark", systemImage: "chart.line.uptrend.xyaxis")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 4) {
                            RowAmount(amount: p.shortfall, tone: Theme.accent)
                            Text("still to earn").foregroundStyle(.secondary)
                        }
                        .font(.subheadline)
                    }
                    Label(daysLine(p, met: met), systemImage: "calendar")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .ledgerCard(padding: 14)
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
        } header: {
            LedgerHeading(title: "This month")
        } footer: {
            Text("What \(monthName) has to cover before anything is profit. Scored from \(Overheads.monthLabel(Overheads.benchmarkStart)).")
        }
    }

    /// "22 days left · PKR 8,455/day".
    private func daysLine(_ p: OverheadProgress, met: Bool) -> String {
        let days = "\(p.daysLeft) day\(p.daysLeft == 1 ? "" : "s") left"
        return met ? days : "\(days) · \(OwnerText.pkr(p.perDayNeeded))/day"
    }

    // MARK: The record

    private func recordSection(_ rows: [OverheadMonthRow], _ s: OverheadSummary) -> some View {
        Section {
            ForEach(rows) { (r: OverheadMonthRow) in monthRow(r) }
        } header: {
            LedgerHeading(title: "Month by month")
        } footer: {
            Text(summaryLine(s))
        }
    }

    private func summaryLine(_ s: OverheadSummary) -> String {
        if s.monthsScored == 0 {
            return "Nothing scored yet \u{2014} \(Overheads.monthLabel(Overheads.benchmarkStart)) is the first full month."
        }
        return "\(s.monthsMet) of \(s.monthsScored) finished month\(s.monthsScored == 1 ? "" : "s") cleared the benchmark"
            + " · average \(OwnerText.pkr(s.averageRevenue)) · running \(OwnerText.signed(s.cumulativeSurplus))"
    }

    private func monthRow(_ r: OverheadMonthRow) -> some View {
        // A month that met its target is the expected end: no colour (rule 15); one that fell short is amber.
        let tone: Color = r.inProgress || r.met ? Color.secondary : Tone.owed.color
        let symbol = r.inProgress ? "minus.circle.fill" : (r.met ? "checkmark.circle.fill" : "arrow.down.right.circle.fill")
        return HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(tone)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.inProgress ? "\(r.label) · so far" : r.label).lineLimit(1)
                Text("\(OwnerText.pkr(r.earned)) of \(OwnerText.pkr(r.target))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            Text(OwnerText.signed(r.surplus))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(r.inProgress ? Color.secondary : (r.surplus >= 0 ? Color.primary : Tone.owed.color))
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: The sheet that produces the target

    private func sheetSection(_ target: Double) -> some View {
        Section {
            ForEach($lines) { $line in
                AdaptiveStack(spacing: 10, alignment: .center) {
                    TextField("What is it for", text: $line.label)
                        .textInputAutocapitalization(.sentences)
                    TextField("Amount", text: $line.amountText.wholeRupees)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                        .frame(maxWidth: 130)
                }
                .swipeActions {
                    Button(role: .destructive) { remove(line.id) } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
            }
            Button { add() } label: { Label("Add a line", systemImage: "plus.circle") }
            LabeledContent("Total") {
                RowAmount(amount: target, tone: Theme.accent)
            }
        } header: {
            LedgerHeading(title: "The sheet")
        } footer: {
            Text("A benchmark, not a ledger. Nothing here is recorded as an expense or counted against profit \u{2014} enter the real payments in Expenses as they go out. Changes apply from \(Overheads.monthLabel(thisMonth)) onward; months already scored keep the target they were scored against.")
        }
    }

    private func add() {
        lines.append(OverheadDraftLine(id: Overheads.newOverheadId(items)))
    }

    private func remove(_ id: String) {
        lines.removeAll { $0.id == id }
    }

    // MARK: Saving

    private var saveBar: some View {
        ActionBar(
            primary: .init("Save from \(monthName)", isBusy: saving) { Task { await save() } },
            secondary: [.init("Discard", systemImage: "arrow.uturn.backward", isDisabled: saving) {
                lines = OverheadDraftLine.lines(liveItems)
                saveError = nil
            }])
    }

    /// The ERP saves it from this month on (its own clock, in Karachi) and answers with the plans now on
    /// file; blank lines are dropped there, as the page drops them.
    private func save() async {
        guard !saving else { return }
        saving = true
        saveError = nil
        // Each line goes with its own id (the ERP refuses two alike): an old line saved without one gets a new one.
        var kept: [OverheadItem] = []
        for var line in items {
            if line.id.isEmpty || kept.contains(where: { $0.id == line.id }) { line.id = Overheads.newOverheadId(kept + items) }
            kept.append(line)
        }
        let sent: [[String: Any]] = kept.map { ["id": $0.id, "label": $0.label, "amount": $0.amount] }
        do {
            // `seq` makes each save its own: the same sheet saved, changed and saved back within half a minute
            // is not one change sent twice (ERPAPI names a write by its content).
            let out = try await ERPAPI.shared.write("saveOverheadPlan", ["items": sent, "seq": UUID().uuidString])
            let from = out["from"] as? String ?? thisMonth
            let saved = (out["items"] as? [[String: Any]] ?? []).compactMap { ERPDecode.model(OverheadItem.self, from: $0) }
            // The answer carries the plans now on file: the record and the sheet are drawn from them.
            if let onFile = out["plans"],
               let a = ERPDecode.model(OverheadPlansAnswer.self, from: ["start": answer?.start ?? Overheads.benchmarkStart, "plans": onFile, "saved": true]) {
                answer = a
                lines = OverheadDraftLine.lines(liveItems)
            } else {
                lines = OverheadDraftLine.lines(saved)
            }
            savedCount += 1
            Note.show(Note(title: "Benchmark saved", detail: "\(OwnerText.pkr(Overheads.overheadTotal(saved))) a month, from \(Overheads.monthLabel(from))."),
                      in: $note, reduce: reduceMotion)
        } catch {
            saveError = error.localizedDescription
        }
        saving = false
    }
}

#if os(macOS)

// MARK: - The Mac board

/// Overheads as a Mac page in two panes: this month's figures over the month-by-month record (a table) on the left, and the
/// sheet that makes the target (a form of lines you type into, with the total) on the right. Saving is ⌘S or the footer;
/// the record, the target and the save are the page's own.
extension OverheadsBoard {
    private func macBoard(rows: [OverheadMonthRow], summary: OverheadSummary, target: Double, earned: Double, p: OverheadProgress) -> some View {
        HSplitView {
            macRecord(rows, summary, target: target, earned: earned, p: p)
                .frame(minWidth: 420)
            macSheet(target)
                .frame(minWidth: 340, idealWidth: 420, maxWidth: 560)
        }
        .background(Theme.ground)
        .navigationSubtitle(monthName)
    }

    private func macRecord(_ rows: [OverheadMonthRow], _ s: OverheadSummary, target: Double, earned: Double, p: OverheadProgress) -> some View {
        let met = p.shortfall == 0 && target > 0
        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    FigureTile(label: "Needed this month", value: OwnerText.pkr(target), tint: Theme.accent)
                    FigureTile(label: "Revenue so far", value: OwnerText.pkr(earned))
                    FigureTile(label: met ? "Above the benchmark" : "Still to earn",
                               value: OwnerText.pkr(met ? earned - target : p.shortfall),
                               detail: daysLine(p, met: met))
                }
                ProgressView(value: p.percent, total: 100).tint(Theme.accent)
                Text("What \(monthName) has to cover before anything is profit. Scored from \(Overheads.monthLabel(Overheads.benchmarkStart)).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(14)
            Table(rows) {
                TableColumn("Month") { (r: OverheadMonthRow) in Text(r.inProgress ? "\(r.label) \u{00B7} so far" : r.label) }
                    .width(min: 120, ideal: 170)
                TableColumn("Needed") { (r: OverheadMonthRow) in Text(OwnerText.pkr(r.target)).monospacedDigit() }
                    .width(min: 90, ideal: 110)
                TableColumn("Revenue") { (r: OverheadMonthRow) in Text(OwnerText.pkr(r.earned)).monospacedDigit() }
                    .width(min: 90, ideal: 110)
                TableColumn("Over / short") { (r: OverheadMonthRow) in
                    // A month that met its target is the expected end: no colour; one that fell short is amber.
                    Text(OwnerText.signed(r.surplus))
                        .monospacedDigit()
                        .foregroundStyle(r.inProgress || r.surplus >= 0 ? Color.primary : Tone.owed.color)
                }
                .width(min: 100, ideal: 120)
                TableColumn("") { (r: OverheadMonthRow) in
                    if !r.inProgress { Image(systemName: r.met ? "checkmark.circle.fill" : "arrow.down.right.circle.fill").foregroundStyle(r.met ? Color.secondary : Tone.owed.color) }
                }
                .width(30)
            }
            VStack(spacing: 0) {
                Divider()
                Text(summaryLine(summary: s))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
            }
            .background(.bar)
        }
    }

    private func summaryLine(summary s: OverheadSummary) -> String {
        if s.monthsScored == 0 {
            return "Nothing scored yet \u{2014} \(Overheads.monthLabel(Overheads.benchmarkStart)) is the first full month."
        }
        return "\(s.monthsMet) of \(s.monthsScored) finished month\(s.monthsScored == 1 ? "" : "s") cleared the benchmark"
            + " \u{00B7} average \(OwnerText.pkr(s.averageRevenue)) \u{00B7} running \(OwnerText.signed(s.cumulativeSurplus))"
    }

    private func macSheet(_ target: Double) -> some View {
        Form {
            Section {
                ForEach($lines) { $line in
                    HStack(spacing: 10) {
                        TextField("What is it for", text: $line.label)
                        TextField("Amount", text: $line.amountText.wholeRupees)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .frame(width: 130)
                        Button(role: .destructive) { remove(line.id) } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                            .help("Remove this line")
                    }
                }
                Button { add() } label: { Label("Add a line", systemImage: "plus.circle") }
                    .disabled(answer == nil)
                LabeledContent("Total") {
                    RowAmount(amount: target, tone: Theme.accent)
                }
            } header: {
                Text("The sheet")
            } footer: {
                Text("A benchmark, not a ledger. Nothing here is recorded as an expense or counted against profit \u{2014} enter the real payments in Expenses as they go out. Changes apply from \(Overheads.monthLabel(thisMonth)) onward; months already scored keep the target they were scored against.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }
}
#endif
