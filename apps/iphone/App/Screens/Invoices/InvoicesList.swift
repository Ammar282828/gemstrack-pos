import SwiftUI
import ERPCore

/// How the list is broken up (invoices/page.tsx `groupBy`): by day to start (the owner, 2026-10-05),
/// or by status to chase what is still owed.
enum InvoiceGrouping: String, CaseIterable, Identifiable {
    case day, week, month, status

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        case .status: return "Status"
        }
    }
}

/// The page's tabs and statuses as one row of chips: what is owed, what is settled, what is in credit.
enum InvoiceChip: String, CaseIterable, Identifiable {
    case all, unpaid, paid, credit, shopify

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .unpaid: return "Unpaid"
        case .paid: return "Paid"
        case .credit: return "In credit"
        case .shopify: return "Shopify"
        }
    }

    func matches(_ inv: Invoice) -> Bool {
        switch self {
        case .all:
            return true
        case .unpaid:
            return isOwing(inv)
        case .paid:
            return inv.status != .refunded && balanceLine(inv.balanceDue).state == .paid
        case .credit:
            return inv.status != .refunded && balanceLine(inv.balanceDue).state == .credit
        case .shopify:
            return (inv.source ?? "").hasPrefix("shopify")
        }
    }
}

/// One section of the list, with what it is worth and what is still owed on it.
struct InvoiceSection: Identifiable {
    let id: String
    let title: String
    /// A word under the heading when nothing is owed on it ("Oldest first"); "" for none.
    let hint: String
    let rows: [Invoice]
    let billed: Double
    let owed: Double
}

/// The three figures at the head of the list: billed today, billed this month, still owed. Each is a tap to
/// the invoices it counts (today's, this month's, the Unpaid chip).
struct InvoiceSummary {
    enum Figure { case today, month, owed }

    var today = 0.0
    var todayCount = 0
    var month = 0.0
    var monthCount = 0
    var owed = 0.0
    var owedCount = 0

    /// Billed as the sections bill (each invoice's grand total, as the web's list sums a day), and owed by the
    /// ERP's one rule (lib/owed.ts `owedToYou`, invoices alone: the list has no hisaab).
    static func of(_ rows: [Invoice], now: Date) -> InvoiceSummary {
        var s = InvoiceSummary()
        let today = ERPDate.karachiDay(now)
        let month = String(today.prefix(7))
        // Reading a date is the slow part at ten times the books: anything stamped well before this month is passed
        // over by its text ("2026-08-…" sorts before the floor), and only the rest is read as Karachi's day.
        let floor = String(ERPDate.iso(now.addingTimeInterval(-35 * 86_400)).prefix(10))
        for inv in rows {
            if String(inv.createdAt.prefix(10)) < floor { continue }
            guard let made = ERPDate.parse(inv.createdAt) else { continue }
            let day = ERPDate.karachiDay(made)
            guard day.hasPrefix(month) else { continue }
            s.month += inv.grandTotal
            s.monthCount += 1
            if day == today {
                s.today += inv.grandTotal
                s.todayCount += 1
            }
        }
        let owed = owedToYou(rows)
        s.owed = owed.total
        s.owedCount = owed.invoices.count
        return s
    }
}

/// Karachi's days, weeks (from Monday) and months: what the shop means by "today" and "this week".
enum InvoiceCalendar {
    static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        return c
    }()

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let dayName = formatter("EEEE d MMM")
    private static let shortDay = formatter("d MMM")
    private static let fullDay = formatter("d MMM yyyy")
    private static let yearOnly = formatter("yyyy")
    private static let monthName = formatter("MMMM yyyy")
    private static let monthParse = formatter("yyyy-MM")

    struct Bucket {
        let key: String
        let title: String
        let hint: String
    }

    static func bucket(_ d: Date, by grouping: InvoiceGrouping, now: Date) -> Bucket {
        switch grouping {
        case .month:
            let start = karachi.dateInterval(of: .month, for: d)?.start ?? d
            let thisMonth = karachi.isDate(start, equalTo: now, toGranularity: .month)
            return Bucket(key: "m\(Int(start.timeIntervalSince1970))", title: monthName.string(from: start), hint: thisMonth ? "This month" : "")
        case .week:
            let start = karachi.dateInterval(of: .weekOfYear, for: d)?.start ?? d
            let thisWeek = karachi.isDate(start, equalTo: now, toGranularity: .weekOfYear)
            return Bucket(key: "w\(Int(start.timeIntervalSince1970))", title: "Week of " + shortDay.string(from: start), hint: thisWeek ? "This week" : yearOnly.string(from: start))
        case .day, .status:
            let key = ERPDate.karachiDay(d)
            let today = key == ERPDate.karachiDay(now)
            let yesterday = key == ERPDate.karachiDay(now.addingTimeInterval(-86_400))
            let title = today ? "Today" : (yesterday ? "Yesterday" : dayName.string(from: d))
            return Bucket(key: "d" + key, title: title, hint: today || yesterday ? fullDay.string(from: d) : yearOnly.string(from: d))
        }
    }

    private static let dayOfYear = formatter("EEEE d MMM yyyy")
    private static let shortDayOfYear = formatter("d MMM yyyy")
    private static let monthOnly = formatter("MMMM")

    /// A section's heading in the ledger (Invoices, 2026-10-09): "Today", "Yesterday", "Wednesday 7 Oct", "This
    /// week", "Week of 28 Sep", "October"; the year only when it is not this one, so a heading never wraps.
    static func heading(_ d: Date, by grouping: InvoiceGrouping, now: Date) -> String {
        let thisYear = karachi.isDate(d, equalTo: now, toGranularity: .year)
        switch grouping {
        case .month:
            let start = karachi.dateInterval(of: .month, for: d)?.start ?? d
            return (thisYear ? monthOnly : monthName).string(from: start)
        case .week:
            let start = karachi.dateInterval(of: .weekOfYear, for: d)?.start ?? d
            if karachi.isDate(start, equalTo: now, toGranularity: .weekOfYear) { return "This week" }
            let sameYear = karachi.isDate(start, equalTo: now, toGranularity: .year)
            return "Week of " + (sameYear ? shortDay : shortDayOfYear).string(from: start)
        case .day, .status:
            let key = ERPDate.karachiDay(d)
            if key == ERPDate.karachiDay(now) { return "Today" }
            if key == ERPDate.karachiDay(now.addingTimeInterval(-86_400)) { return "Yesterday" }
            return (thisYear ? dayName : dayOfYear).string(from: d)
        }
    }

    /// The day a date picker shows, as "yyyy-MM-dd": the phone's own calendar (the 6th is the 6th wherever
    /// the phone is), whatever time of day the picker holds.
    static func day(picked: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: picked)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 1, c.day ?? 1)
    }

    /// A "yyyy-MM-dd" day as a date for a picker to show, in the phone's own calendar.
    static func picked(day: String?) -> Date? {
        guard let day, day.count == 10 else { return nil }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// "1 Oct – 8 Oct 2026", or "From 1 Oct 2026" while the end is open (up to today).
    static func caption(from: String, to: String?) -> String {
        guard let start = ERPDate.parse(from) else { return from }
        guard let to, let end = ERPDate.parse(to) else { return "From " + fullDay.string(from: start) }
        return shortDay.string(from: start) + " – " + fullDay.string(from: end)
    }

    /// "2026-10" as the shop's month filter keeps it.
    static func monthKey(_ iso: String) -> String? {
        ERPDate.parse(iso).map { String(ERPDate.karachiDay($0).prefix(7)) }
    }

    static func monthLabel(_ key: String) -> String {
        monthParse.date(from: key).map { monthName.string(from: $0) } ?? key
    }
}

/// Every invoice, and what is still owed on it (src/app/invoices/page.tsx), as the ledger (Ledger.swift): the
/// chips and the three figures scroll with the list, so the large title stays clear; a day's heading says what it
/// billed and what is still owed on it; a row leads with who, says what was sold, and carries one pill (none when
/// paid, CONVENTIONS rule 15).
struct InvoicesList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var search = ""
    @State private var chip: InvoiceChip = .all
    @State private var grouping: InvoiceGrouping = .day
    /// "" is Anyone.
    @State private var takenBy = ""
    /// "" is all time, else "yyyy-MM".
    @State private var month = ""
    /// A span of days, "yyyy-MM-dd": from the first to the last, or to today while the end is open.
    /// Nothing without a start, as the web's date picker has it (invoices/page.tsx).
    @State private var rangeFrom: String?
    @State private var rangeTo: String?
    @State private var pickingRange = false
    @State private var paying: Invoice?
    /// Send on WhatsApp from a swipe: the invoice page's own send (InvoiceWhatsAppSend).
    @State private var sending: Invoice?
    @State private var pdf: InvoicePDFTarget?
    @State private var note: Note?
    /// The payment link to make (InvoicePaymentLink): set to start it.
    @State private var linking: Invoice?
    /// Import Shopify CSV (InvoiceCSVImportSheet), an owner's.
    @State private var importingCSV = false

    private var canPay: Bool { InvoiceFacts.mayTakePayments(role: session.role) }

    var body: some View {
        let all = book.invoices.items
        ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
            content(all).motion(chip)
        }
        .navigationTitle("Invoices")
        .searchable(text: $search, prompt: "Search invoices")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { filterMenu(all) }
        }
        .invoicePaymentSheet(for: $paying) { paid, amount in recorded(paid, amount) }
        .invoiceWhatsAppSend($sending) { sent in
            Note.show(Note(title: sent.title, detail: sent.detail), in: $note, reduce: reduceMotion)
        }
        .invoicePaymentLink($linking) { made in
            Note.show(Note(title: made.title, detail: made.detail), in: $note, reduce: reduceMotion)
        }
        .sheet(isPresented: $importingCSV) {
            InvoiceCSVImportSheet { (done: InvoiceNote) in
                Note.show(Note(title: done.title, detail: done.detail), in: $note, reduce: reduceMotion)
            }
        }
        .noteToast($note)
        .sheet(isPresented: $pickingRange) {
            InvoiceRangeSheet(from: rangeFrom, to: rangeTo) { from, to in
                rangeFrom = from
                rangeTo = from == nil ? nil : to
            }
        }
        .navigationDestination(item: $pdf) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .task {
            book.invoices.need()
            book.customers.need()
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ all: [Invoice]) -> some View {
        let scoped = scope(all)
        let shown = scoped.filter { chip.matches($0) }
        let groups = sections(shown)
        GeometryReader { geometry in
          if geometry.size.width >= 760 && !typeSize.isAccessibilitySize {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    chipRow(scoped)
                    if filterActive { filterCaption }
                    summaryStrip(all)
                    ForEach(groups) { group in
                        InvoiceSectionHeader(section: group)
                        LazyVGrid(columns: CardColumns.grid(geometry.size.width - 48), alignment: .leading, spacing: 20) {
                            ForEach(group.rows) { inv in
                                VStack(alignment: .leading, spacing: 12) {
                                    row(inv).buttonStyle(.plain)
                                    Divider()
                                    HStack {
                                        if canPay && isOwing(inv) {
                                            Button("Take payment", systemImage: "banknote") { paying = inv }
                                                .buttonStyle(.borderless).font(.subheadline.weight(.medium))
                                                .frame(minHeight: 44)
                                        }
                                        Spacer()
                                        Menu { invoiceActions(inv) } label: {
                                            Image(systemName: "ellipsis").frame(width: 44, height: 44)
                                        }.accessibilityLabel("Actions for \(inv.id)")
                                    }
                                }
                                .ledgerCard(padding: 20)
                                // The signed-in person's own sale is lit a little (decision "Signed-in defaults"), as an order's card is.
                                .overlay {
                                    RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                                        .strokeBorder(Theme.accent.opacity(isMine(inv) ? 0.22 : 0.08), lineWidth: 1)
                                        .allowsHitTesting(false)
                                }
                            }
                        }
                    }
                    if groups.isEmpty { emptyState }
                }.padding(24)
            }
          } else {
        List {
            // The chips, the filter line and the figures are the list's first rows (a bar pinned over the list greyed
            // the large title out). The chips scroll edge to edge and pad themselves; the rest take the page's margin.
            Section {
                chipRow(scoped).chipRowInList()
                if filterActive { filterCaption.stripRow() }
                summaryStrip(all).stripRow()
            }
            if groups.isEmpty {
                Section { emptyState }.houseRows()
            } else {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.rows) { inv in row(inv) }
                    } header: {
                        InvoiceSectionHeader(section: group)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
          }
        }
    }

    private func chipRow(_ scoped: [Invoice]) -> some View {
        ChipRow {
            // Shopify's web orders arrive as invoices (never in Orders): their chip sits in the row, as on the web's
            // Show row, whenever there are any. Parked in the toolbar menu alone (a8d9e4e) it hid them from the owner.
            ForEach(rowChips(scoped)) { c in
                // Unpaid's count is the Owed to you card's own "n invoices": said once (CONVENTIONS rule 15).
                FilterChip(title: c.title, count: c == .unpaid ? nil : scoped.filter { c.matches($0) }.count, chosen: c == chip) {
                    chip = c
                }
            }
        }
    }

    /// The chips in the row: All, Unpaid, Paid, and Shopify while there are Shopify invoices (or it is chosen).
    private func rowChips(_ scoped: [Invoice]) -> [InvoiceChip] {
        var chips: [InvoiceChip] = [.all, .unpaid, .paid]
        if chip == .shopify || scoped.contains(where: { InvoiceChip.shopify.matches($0) }) { chips.append(.shopify) }
        return chips
    }

    /// Something the chips do not show is narrowing the list.
    private var filterActive: Bool {
        !takenBy.isEmpty || !month.isEmpty || rangeFrom != nil || chip == .credit
    }

    /// What the list is narrowed to, and a way back.
    private var filterCaption: some View {
        HStack {
            Text([chip == .all ? "" : chip.title, takenBy, month.isEmpty ? "" : InvoiceCalendar.monthLabel(month),
                  rangeFrom.map { InvoiceCalendar.caption(from: $0, to: rangeTo) } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button("Clear") { clearFilters() }
                .font(.caption.weight(.semibold)).buttonStyle(.borderless)
        }
    }

    private func clearFilters() {
        chip = .all; takenBy = ""; month = ""; rangeFrom = nil; rangeTo = nil
    }

    /// A payment taken from a swipe: what is left, said as the sheet closes.
    private func recorded(_ inv: Invoice, _ amount: Double) {
        let line = balanceLine(inv.balanceDue - amount)
        let detail: String
        switch line.state {
        case .due: detail = "\(Money.pkr(line.amount)) still due"
        case .credit: detail = "Paid in full, \(Money.pkr(line.amount)) in credit"
        case .paid: detail = "Paid in full"
        }
        Note.show(Note(title: "Payment recorded", detail: detail), in: $note, reduce: reduceMotion)
    }

    // MARK: The three figures

    /// Owed to you in the serif (a tap shows the unpaid), then Today and This month: the whole book's, or the
    /// chosen person's (Taken by), whatever else is filtered, so the figures hold still while the list below them
    /// is searched. Always in view: a fold hid the one number the counter opens this page for.
    private func summaryStrip(_ all: [Invoice]) -> some View {
        let base = takenBy.isEmpty ? all : all.filter { $0.takenBy == takenBy }
        let s = InvoiceSummary.of(base, now: Date())
        return VStack(alignment: .leading, spacing: 12) {
            Button { pick(.owed) } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Owed to you").font(.subheadline).foregroundStyle(.secondary)
                    Text(Money.pkr(s.owed))
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        .foregroundStyle(s.owed > 0 ? Tone.owed.color : Color.primary)
                        .monospacedDigit()
                        .contentTransition(.numericText(value: s.owed))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text("\(s.owedCount) invoice\(s.owedCount == 1 ? "" : "s")").font(.footnote).foregroundStyle(.secondary)
                }
                .ledgerCard()
                .overlay { chosenEdge(.owed) }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(chosen(.owed) ? .isSelected : [])
            FigureRow {
                figureButton("Today", s.today, s.todayCount, .today)
                figureButton("This month", s.month, s.monthCount, .month)
            }
        }
    }

    private func figureButton(_ title: String, _ amount: Double, _ count: Int, _ figure: InvoiceSummary.Figure) -> some View {
        Button { pick(figure) } label: {
            FigureTile(label: title, value: Money.pkrLac(amount), detail: "\(count) invoice\(count == 1 ? "" : "s")")
                .overlay { chosenEdge(figure) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen(figure) ? .isSelected : [])
    }

    /// The accent edge on the figure the list is showing.
    @ViewBuilder
    private func chosenEdge(_ f: InvoiceSummary.Figure) -> some View {
        if chosen(f) {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Theme.accent, lineWidth: 1.5)
        }
    }

    private var todayKey: String { ERPDate.karachiDay(Date()) }
    private var monthKey: String { String(todayKey.prefix(7)) }

    /// Whether the list is showing what a figure counts.
    private func chosen(_ f: InvoiceSummary.Figure) -> Bool {
        switch f {
        case .today: return month.isEmpty && rangeFrom == todayKey && (rangeTo == nil || rangeTo == todayKey)
        case .month: return month == monthKey && rangeFrom == nil
        case .owed: return chip == .unpaid
        }
    }

    /// A figure tapped shows what it counts, through the filters the list already has; tapped again, lets go.
    private func pick(_ f: InvoiceSummary.Figure) {
        let again = chosen(f)
        Motion.run(Motion.enter, reduce: reduceMotion) {
            switch f {
            case .today:
                month = ""
                rangeFrom = again ? nil : todayKey
                rangeTo = nil
            case .month:
                rangeFrom = nil
                rangeTo = nil
                month = again ? "" : monthKey
            case .owed:
                chip = again ? .all : .unpaid
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let filtering = !search.isEmpty || !takenBy.isEmpty || !month.isEmpty || rangeFrom != nil || chip != .all
        if filtering {
            ContentUnavailableView {
                Label("No matches", systemImage: "doc.text.magnifyingglass")
            } description: {
                Text("Try adjusting your search or filter.")
            } actions: {
                Button("Clear filters") { search = ""; clearFilters() }
            }
        } else {
            ContentUnavailableView {
                Label("No invoices yet", systemImage: "doc.text")
            } description: {
                Text("A sale you make will be here, with what is still owed on it.")
            } actions: {
                NavigationLink(value: SaleLinks.newSale) { Text("New sale") }
            }
        }
    }

    private func row(_ inv: Invoice) -> some View {
        InvoiceListRow(invoice: inv, mine: isMine(inv), dated: grouping != .day)
            // The page grows out of its row (the id is the route's path).
            .zoomSource(id: InvoiceFacts.path(inv.id))
            // The bill to the customer: the commonest thing after a sale, the same send as the invoice page's.
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                Button { sending = inv } label: { Label("Send on WhatsApp", systemImage: "message") }
                    .tint(Tone.credit.color)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
                        .tint(Tone.settled.color)
                }
            }
            .contextMenu {
                invoiceActions(inv)
            }
            // The signed-in person's own sales are lit where they stand, not sorted or filtered (2026-10-05).
            .listRowBackground(Theme.card)
            .listRowInsets(EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
    }

    @ViewBuilder
    private func invoiceActions(_ inv: Invoice) -> some View {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
                }
                Button { sending = inv } label: {
                    Label(inv.sentOnWhatsApp == nil ? "Send on WhatsApp" : "Send again on WhatsApp", systemImage: "message")
                }
                Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer) } label: {
                    Label("Print / PDF", systemImage: "printer")
                }
                // The page's Payment link on an unpaid invoice: Shopify's checkout, copied.
                if InvoiceFacts.offersPaymentLink(inv) {
                    Button { linking = inv } label: { Label(InvoiceFacts.paymentLinkTitle(inv), systemImage: "link.badge.plus") }
                }
    }

    private func isMine(_ inv: Invoice) -> Bool {
        guard let person = session.shop.person, !person.isEmpty, let by = inv.takenBy else { return false }
        return by == person
    }

    // MARK: Chips and the filter menu

    private func visibleChips(_ scoped: [Invoice]) -> [InvoiceChip] {
        InvoiceChip.allCases.filter { c in
            switch c {
            case .credit, .shopify:
                return c == chip || scoped.contains { c.matches($0) }
            case .all, .unpaid, .paid:
                return true
            }
        }
    }

    private func filterMenu(_ all: [Invoice]) -> some View {
        let people = Array(Set(all.compactMap { $0.takenBy }.filter { !$0.isEmpty })).sorted()
        let months = Array(Set(all.compactMap { InvoiceCalendar.monthKey($0.createdAt) })).sorted(by: >)
        let filtering = !takenBy.isEmpty || !month.isEmpty || rangeFrom != nil || chip != .all
        return Menu {
            Picker("Status", selection: $chip) {
                ForEach(visibleChips(all)) { c in Text(c.title).tag(c) }
            }
            Picker("Group by", selection: $grouping) {
                ForEach(InvoiceGrouping.allCases) { g in Text(g.title).tag(g) }
            }
            Picker("Taken by", selection: $takenBy) {
                Text("Anyone").tag("")
                ForEach(people, id: \.self) { p in Text(p).tag(p) }
            }
            Picker("Month", selection: $month) {
                Text("All time").tag("")
                ForEach(months, id: \.self) { m in Text(InvoiceCalendar.monthLabel(m)).tag(m) }
            }
            // Any span of days, on top of a month (the web's date range picker).
            Button { pickingRange = true } label: {
                Label(rangeFrom.map { InvoiceCalendar.caption(from: $0, to: rangeTo) } ?? "Date range", systemImage: "calendar")
            }
            if rangeFrom != nil {
                Button { rangeFrom = nil; rangeTo = nil } label: { Label("Clear the date range", systemImage: "xmark.circle") }
            }
            if filtering {
                Button("Clear filters", systemImage: "xmark.circle") {
                    chip = .all; takenBy = ""; month = ""; rangeFrom = nil; rangeTo = nil
                }
            }
            // The page's Import Shopify CSV: an owner's, as its own Firestore write is.
            if session.isOwner {
                Divider()
                Button { importingCSV = true } label: { Label("Import Shopify CSV", systemImage: "square.and.arrow.down") }
            }
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    // MARK: Filtering and grouping

    /// Search, Taken by, Month and the date range: everything but the chip, so the chips can count what
    /// they would show.
    private func scope(_ all: [Invoice]) -> [Invoice] {
        var out = all
        if !takenBy.isEmpty { out = out.filter { $0.takenBy == takenBy } }
        if !month.isEmpty { out = out.filter { InvoiceCalendar.monthKey($0.createdAt) == month } }
        if let start = rangeFrom {
            // The last day included; open, it runs to the end of today (isWithinInterval, invoices/page.tsx).
            let end = rangeTo ?? ERPDate.karachiDay(Date())
            out = out.filter { inv in
                guard let made = ERPDate.parse(inv.createdAt) else { return false }
                let day = ERPDate.karachiDay(made)
                return day >= start && day <= end
            }
        }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty {
            // The customer's own number, for an invoice that does not carry one.
            let digits = q.filter { $0 >= "0" && $0 <= "9" }
            let wanted = String(digits.drop(while: { $0 == "0" }))
            var phones: [String: String] = [:]
            if wanted.count >= 3 {
                for c in book.customers.items {
                    if let p = c.phone, !p.isEmpty { phones[c.id] = p }
                }
            }
            out = out.filter { matches($0, query: q, digits: wanted, phones: phones) }
        }
        return out
    }

    /// Customer, phone, invoice id, a piece's SKU or its name ("drop earrings": the counter remembers what was sold).
    private func matches(_ inv: Invoice, query q: String, digits: String, phones: [String: String]) -> Bool {
        if inv.id.localizedCaseInsensitiveContains(q) { return true }
        if inv.customerName.localizedCaseInsensitiveContains(q) { return true }
        if inv.items.contains(where: { $0.sku.localizedCaseInsensitiveContains(q) || $0.name.localizedCaseInsensitiveContains(q) }) { return true }
        if digits.count >= 3 {
            let own = inv.customerContact ?? ""
            let theirs = inv.customerId.flatMap { phones[$0] } ?? ""
            for p in [own, theirs] {
                let d = p.filter { $0 >= "0" && $0 <= "9" }
                if d.contains(digits) { return true }
            }
        }
        return false
    }

    private func sections(_ rows: [Invoice]) -> [InvoiceSection] {
        if grouping == .status { return statusSections(rows) }
        let now = Date()
        var order: [String] = []
        var titles: [String: String] = [:]
        var members: [String: [Invoice]] = [:]
        for inv in rows {
            let key: String
            if let d = ERPDate.parse(inv.createdAt) {
                key = InvoiceCalendar.bucket(d, by: grouping, now: now).key
                if titles[key] == nil { titles[key] = InvoiceCalendar.heading(d, by: grouping, now: now) }
            } else {
                key = "undated"
                if titles[key] == nil { titles[key] = "No date" }
            }
            if members[key] == nil { order.append(key) }
            members[key, default: []].append(inv)
        }
        return order.map { key in
            makeSection(id: key, title: titles[key] ?? "", hint: "", rows: members[key] ?? [])
        }
    }

    /// Awaiting payment (the oldest debt first: that is the one to chase), then Settled.
    private func statusSections(_ rows: [Invoice]) -> [InvoiceSection] {
        let owing = rows.filter { isOwing($0) }.sorted { $0.createdAt < $1.createdAt }
        let settled = rows.filter { !isOwing($0) }
        var out: [InvoiceSection] = []
        if !owing.isEmpty { out.append(makeSection(id: "owing", title: "Awaiting payment", hint: "Oldest first", rows: owing)) }
        if !settled.isEmpty { out.append(makeSection(id: "settled", title: "Settled", hint: "Nothing outstanding", rows: settled)) }
        return out
    }

    private func makeSection(id: String, title: String, hint: String, rows: [Invoice]) -> InvoiceSection {
        var billed = 0.0
        var owed = 0.0
        for inv in rows {
            billed += inv.grandTotal
            if isOwing(inv) { owed += inv.balanceDue }
        }
        return InvoiceSection(id: id, title: title, hint: hint, rows: rows, billed: billed, owed: owed)
    }
}

/// A section's heading: its day, how many, what it billed; under it what is still owed on it.
private struct InvoiceSectionHeader: View {
    let section: InvoiceSection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            LedgerHeading(title: section.title, count: section.rows.count, trailing: Money.pkr(section.billed))
            if section.owed > 0.5 {
                Text(section.hint.isEmpty ? "\(Money.pkr(section.owed)) still owed" : "\(section.hint) · \(Money.pkr(section.owed)) still owed")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    // Quiet: the rows' own pills carry the amber (CONVENTIONS rule 15, one coloured thing).
                    .foregroundStyle(.secondary)
            } else if !section.hint.isEmpty {
                Text(section.hint).font(.caption).foregroundStyle(.secondary)
            }
        }
        .textCase(nil)
        .padding(.bottom, 2)
    }
}

/// One invoice: who it was for, what was sold, its number and time; what it came to with where its balance stands under it.
private struct InvoiceListRow: View {
    let invoice: Invoice
    /// Taken by whoever is signed in.
    let mine: Bool
    /// Grouped by more than a day: the row says its day, not only its time.
    let dated: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var shopify: Bool { (invoice.source ?? "").hasPrefix("shopify") }

    var body: some View {
        NavigationLink(value: Route(path: InvoiceFacts.path(invoice.id))) {
            let stacked = typeSize.isAccessibilitySize
            let layout = stacked
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                HStack(alignment: .top, spacing: 12) {
                    Monogram(name: invoice.customerName, size: Monogram.Size.row)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(InvoiceFacts.customerName(invoice)).font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                        if let sold = InvoiceFacts.whatSold(invoice), !sold.isEmpty {
                            Text(sold).font(.subheadline).foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        reference
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: stacked ? .leading : .trailing, spacing: 4) {
                    RowAmount(amount: invoice.grandTotal)
                    InvoiceBalancePill(invoice: invoice)
                }
                .fixedSize(horizontal: !stacked, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }

    /// "INV-000123 · 3:45 pm" under its day's heading, "INV-000123 · Tue 6 Oct" under a week's, with "You" and
    /// "Shopify" beside it, or under it where the line is too narrow for all three.
    private var reference: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                referenceText
                if mine { MineTag() }
                if shopify { Pill("Shopify") }
            }
            VStack(alignment: .leading, spacing: 4) {
                referenceText
                HStack(spacing: 6) {
                    if mine { MineTag() }
                    if shopify { Pill("Shopify") }
                }
            }
        }
    }

    private var referenceText: some View {
        let when = dated ? ShopDate.say(invoice.createdAt) : InvoiceFacts.time(invoice.createdAt)
        return Text([invoice.id, when].filter { !$0.isEmpty }.joined(separator: " · "))
            .font(.caption).foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

/// Pick the days to look at: from a first day to a last, or from a first day up to today. Cleared from
/// the filter menu. A sheet of its own, so it has its own stack (the web uses a popover calendar).
private struct InvoiceRangeSheet: View {
    let apply: (_ from: String?, _ to: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var from: Date
    @State private var until: Date
    @State private var hasEnd: Bool

    init(from: String?, to: String?, apply: @escaping (_ from: String?, _ to: String?) -> Void) {
        self.apply = apply
        let start = InvoiceCalendar.picked(day: from) ?? Date()
        _from = State(initialValue: start)
        _until = State(initialValue: InvoiceCalendar.picked(day: to) ?? start)
        _hasEnd = State(initialValue: to != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("From", selection: $from, displayedComponents: .date)
                    Toggle("Up to a last day", isOn: $hasEnd.animation())
                    if hasEnd {
                        DatePicker("To", selection: $until, in: from..., displayedComponents: .date)
                    }
                } footer: {
                    Text(hasEnd ? "Both days are included." : "Everything from that day up to today.")
                }.houseRows()
            }
            .navigationTitle("Date range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        let start = InvoiceCalendar.day(picked: from)
                        // A last day set before the first reads as that one day.
                        let end = hasEnd ? max(start, InvoiceCalendar.day(picked: until)) : nil
                        apply(start, end)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

private extension View {
    /// A row of the list's head that sits on the ground: the page's margin, no card, no rule.
    func stripRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}
