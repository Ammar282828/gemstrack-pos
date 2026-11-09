import SwiftUI
import ERPCore

// The redesigned Analytics' shared parts (decision "Analytics redesign"): one host that reckons ERPCore's `Books` for the
// period and the one before, the page and card shapes, and the small words they share. Every figure is ERPCore's
// (Books.swift, ported from src/lib/analytics/books.ts); nothing here works out money.

/// What every redesigned page reads: the books for the period and for the period before, and what they were worked from.
struct AbCtx {
    let books: Books
    /// The period before (`previousPeriod`); nil for all time.
    let prev: Books?
    let previous: PreviousPeriod?
    let state: AnaPeriodState
    let input: BooksInput
    let options: BooksOptions
    /// Changes whenever the books or the period do: a page that works something more out re-reads on it.
    let stamp: Int
    /// Picks a period (a year in the Profit page's table).
    var setRange: (String) -> Void = { _ in }

    var range: AnalyticsRange? { state.range }
    var period: Period { Period(state.range) }
    var previousLabel: String? { previous?.label }
    var previousRange: Period? { previous.map { Period($0.range) } }
    var now: Date { options.now }
}

// MARK: The host

/// Loads the six shelves, works the books out off the main thread once per change of them, the period or the day, and
/// hands the result to its page. Owners only (lib/roles.ts: staff have no analytics).
struct AbHost<Content: View>: View {
    let title: String
    /// The Overview is the hub (large title); the pages drilled into from it are inline.
    var hub = false
    @ViewBuilder let content: (AbCtx) -> Content

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("erp.analytics.range") private var rangeKey = AnaPeriod.defaultKey
    @AppStorage("erp.analytics.from") private var customFrom = ""
    @AppStorage("erp.analytics.to") private var customTo = ""
    @State private var now = Date()
    @State private var covered = false
    @State private var reckoned: AbCtx?

    var body: some View {
        if session.isOwner { owners } else {
            NotAvailableState("Owners only", why: "Analytics are worked out from the owners’ books.").navigationTitle(title)
        }
    }

    private var owners: some View {
        titled(ShelfState(loaded: ready && reckoned != nil, error: firstError, offline: book.invoices.offline, shape: .cards) {
            if let r = reckoned { page(r) }
        })
        .navigationTitle(title)
        .trackCovered($covered)
        .onAppear { needAll() }
        .onChange(of: session.role) { _, _ in needAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { turnOver() }
        }
        .whileActive { await keepTime() }
        .task(id: reckonKey) { await reckon() }
    }

    @ViewBuilder private func titled<V: View>(_ view: V) -> some View {
        if hub { view.hubTitleDisplay() } else { view.navigationBarTitleDisplayMode(.inline) }
    }

    // MARK: Shelves

    private func needAll() {
        book.invoices.need()
        book.orders.need()
        book.products.need()
        book.customers.need()
        book.expenses.need()
        book.revenue.need()
    }

    private var ready: Bool {
        book.invoices.loaded && book.orders.loaded && book.products.loaded && book.customers.loaded
            && book.expenses.loaded && book.revenue.loaded
    }

    private var firstError: String? {
        book.invoices.error ?? book.orders.error ?? book.products.error ?? book.customers.error ?? book.expenses.error ?? book.revenue.error
    }

    // MARK: Time

    private func turnOver() {
        let next = Date()
        if !AnaDate.karachi.isDate(now, inSameDayAs: next) { now = next }
    }

    private func keepTime() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            turnOver()
        }
    }

    // MARK: Reckoning

    private var reckonKey: [Int] {
        [book.invoices.revision, book.orders.revision, book.products.revision, book.customers.revision,
         book.expenses.revision, book.revenue.revision, session.isOwner ? 1 : 0, rangeKey.hashValue, customFrom.hashValue,
         customTo.hashValue, AnaDate.karachi.ordinality(of: .day, in: .era, for: now) ?? 0, book.settings.revision,
         ready ? 1 : 0, covered ? 1 : 0]
    }

    /// Snapshots the shelves on the main actor (arrays of value types), then works the books out on a background task;
    /// a newer key cancels the wait and the stale result is dropped.
    private func reckon() async {
        guard ready, session.isOwner, !covered || reckoned == nil else { return }
        let state = AnaPeriod.read(key: rangeKey, from: customFrom, to: customTo, now: now)
        // House is read here, on the main actor: the business can be switched while the background works.
        let options = BooksOptions(now: now, metal: House.metal, margin: House.margin, goods: House.goodsExpenseCategories,
                                   goldApartMargin: House.goldApartMargin)
        let customers = book.customers.items.filter { (c: Customer) -> Bool in (c.deletedAt ?? "").isEmpty }
        let input = BooksInput(invoices: book.invoices.items, orders: book.orders.items, products: book.products.items,
                               customers: customers, expenses: book.expenses.items, additionalRevenues: book.revenue.items)
        let stamp = reckonKey.hashValue
        let priority: TaskPriority = reckoned == nil ? .userInitiated : .utility
        let made = await Task.detached(priority: priority) { () -> AbCtx in
            let engine = BooksEngine(input, options: options)
            let period = Period(state.range)
            let previous = previousPeriod(period, now: options.now)
            return AbCtx(books: engine.books(period), prev: previous.map { engine.books(Period($0.range)) }, previous: previous,
                         state: state, input: input, options: options, stamp: stamp)
        }.value
        guard !Task.isCancelled else { return }
        reckoned = made
    }

    private func page(_ r: AbCtx) -> some View {
        var ctx = r
        ctx.setRange = { (key: String) -> Void in rangeKey = key }
        let bar = AnaPeriodBar(key: $rangeKey, from: $customFrom, to: $customTo, state: r.state)
        let empty: AnaEmptyKind? = r.books.rangeEmpty ? .nothingInRange
            : (r.input.invoices.isEmpty && r.input.orders.isEmpty && r.input.expenses.isEmpty ? .noData : nil)
        return AbPage(bar: bar, empty: empty) { content(ctx) }
    }
}

// MARK: Page and cards

/// A page of cards on the house's ground: the period under the title, then the page.
struct AbPage<Content: View>: View {
    let bar: AnaPeriodBar
    var empty: AnaEmptyKind?
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(16)) {
                bar
                if let empty {
                    AbEmpty(kind: empty)
                } else {
                    VStack(alignment: .leading, spacing: pt(16)) { content() }
                        .padding(.horizontal, Metrics.cardPadding)
                }
            }
            .padding(.vertical, pt(12))
            // A wide window keeps the cards in a readable column.
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background { HouseGroundFill().ignoresSafeArea() }
    }
}

struct AbEmpty: View {
    let kind: AnaEmptyKind

    var body: some View {
        switch kind {
        case .nothingInRange:
            NotAvailableState("Nothing in this range", why: "There are no invoices or orders in the selected period. Pick another period to see more.",
                              symbol: "chart.bar")
        case .noData:
            NotAvailableState("No data yet", why: "There is no data available to generate analytics yet.", symbol: "chart.bar")
        }
    }
}

/// A picture with its question as the title and one computed sentence under it. With a `path` the whole card is the
/// link to the page that answers it in depth (the Overview); without, it is a card of the page you are on.
struct AbCard<Content: View>: View {
    let title: String
    var takeaway: String?
    var path: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        if let path {
            NavigationLink(value: Route(path: path)) { card }
                .buttonStyle(.pressable)
        } else {
            card
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
                Text(title)
                    .font(.house(.headline))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if path != nil {
                    Image(systemName: "chevron.right")
                        .font(.house(.footnote).weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
            if let takeaway, !takeaway.isEmpty {
                Text(takeaway)
                    .font(.house(.subheadline))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
        .contentShape(.rect(cornerRadius: Radius.card))
    }
}

/// The cards of a page: one column on a phone, as many as fit on a wide window.
struct AbGrid<Content: View>: View {
    var minimum: CGFloat = 340
    @ViewBuilder let content: () -> Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: pt(16), alignment: .top)], alignment: .leading, spacing: pt(16)) {
            content()
        }
    }
}

/// A headline figure: its name, the number, and how it moved against the period before. The whole tile opens its page.
struct AbTile: View {
    let label: String
    let value: String
    let path: String
    var delta: Delta?
    var against: String?
    var sub: String?
    var tone: Tone?

    var body: some View {
        NavigationLink(value: Route(path: path)) {
            VStack(alignment: .leading, spacing: pt(6)) {
                Text(label).font(.house(.subheadline)).foregroundStyle(.secondary)
                Text(value)
                    .font(.house(.title2).weight(.semibold))
                    .foregroundStyle(tone?.color ?? Color.primary)
                    .monospacedDigit()
                    .minimumScaleFactor(0.8)
                    .contentTransition(.numericText())
                    .fixedSize(horizontal: false, vertical: true)
                if let delta {
                    AbDeltaPill(delta: delta, against: against ?? "the period before")
                }
                if let sub, !sub.isEmpty {
                    Text(sub).font(.house(.footnote)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Metrics.cardPadding)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .houseCard()
            .contentShape(.rect(cornerRadius: Radius.card))
        }
        .buttonStyle(.pressable)
        .accessibilityElement(children: .combine)
    }
}

/// "▲ 12% vs last month": the arrow says the direction, the tone says whether it is good; neither is the colour alone.
struct AbDeltaPill: View {
    let delta: Delta
    let against: String

    private var flat: Bool { abs(delta.pct) < 0.5 }
    private var tone: Tone { flat ? .quiet : (delta.better ? .settled : .late) }
    private var shown: String {
        let a = abs(delta.pct)
        if a >= 1000 { return "999+" }
        return a < 10 ? AnaFormat.fixed(a, 1) : String(Int(a.rounded()))
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: flat ? "minus" : (delta.pct > 0 ? "arrow.up" : "arrow.down"))
                .font(.house(.caption2).weight(.bold))
            Text(flat ? "No change vs \(against)" : "\(shown)% vs \(against)")
                .font(.house(.caption).weight(.medium))
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.12), in: .capsule)
    }
}

/// "How this is worked out": what used to be explained above the numbers lives here, at the foot of a page.
struct AbExplain<Content: View>: View {
    var title = "How this is worked out"
    @ViewBuilder let content: () -> Content

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: pt(8)) { content() }
                .font(.house(.footnote))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, pt(6))
        } label: {
            Text(title).font(.house(.subheadline).weight(.medium))
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }
}

/// A card of rows (a table): its title, then rows with hairlines between them.
struct AbTable<Content: View>: View {
    let title: String
    var detail: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Text(title).font(.house(.headline))
            if let detail, !detail.isEmpty {
                Text(detail).font(.house(.footnote)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 0) { content() }
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }
}

/// One row of a table: a name with a line under it and an amount (or any trailing words) at the end.
struct AbRow: View {
    let title: String
    var subtitle: String?
    let trailing: String
    var trailingTone: Tone?
    var dot: Color?

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .firstTextBaseline, spacing: pt(10)) {
                if let dot {
                    Circle().fill(dot).frame(width: 9, height: 9).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.house(.subheadline)).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.house(.footnote)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: pt(8))
                Text(trailing)
                    .font(.house(.subheadline).weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(trailingTone?.color ?? Color.primary)
            }
            .padding(.vertical, pt(10))
        }
    }
}

/// Figures in a grid (the page's numbers under its picture).
struct AbFigure: Identifiable {
    let label: String
    let value: String
    var detail: String?
    var tone: Tone?
    var id: String { label }
}

struct AbFigures: View {
    let items: [AbFigure]

    var body: some View {
        FigureGrid {
            ForEach(items) { (f: AbFigure) in
                FigureTile(label: f.label, value: f.value, detail: f.detail, tint: f.tone?.color ?? Color.primary)
            }
        }
    }
}

// MARK: Working something more out, off the main thread

/// A page's own heavier reckoning (twelve months, the years), made once per change of the books on a background task;
/// the last answer stays on screen while the next is made.
struct AbLoad<T, Content: View>: View {
    let ctx: AbCtx
    let work: @Sendable (BooksEngine, BooksInput, BooksOptions) -> T
    @ViewBuilder let content: (T?) -> Content
    @State private var value: T?

    var body: some View {
        content(value)
            .task(id: ctx.stamp) {
                let input = ctx.input, options = ctx.options, work = work
                value = await Task.detached(priority: .utility) { () -> T in
                    work(BooksEngine(input, options: options), input, options)
                }.value
            }
    }
}

// MARK: Words

/// The few words the pages' sentences share.
enum AbSay {
    /// "3 customers", "1 customer".
    static func count(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        AnaFormat.number(Double(n), maxDigits: 0) + " " + (n == 1 ? one : (many ?? one + "s"))
    }

    static func percent(_ part: Double, _ whole: Double) -> Int { whole > 0 ? Int((part / whole * 100).rounded()) : 0 }

    /// "12.4 tola".
    static func tola(_ grams: Double, digits: Int = 1) -> String {
        AnaFormat.number(AnaFormat.tola(grams), maxDigits: digits) + " tola"
    }

    static func grams(_ g: Double) -> String { AnaFormat.number(g, maxDigits: 2) + " g" }

    /// "+PKR 1.2 lac" / "−PKR 40,000".
    static func signed(_ n: Double) -> String { (n < 0 ? "−" : "+") + Money.pkrLac(abs(n)) }

    /// "12.5%".
    static func pct1(_ n: Double) -> String { AnaFormat.fixed((n * 10).rounded() / 10, 1) + "%" }

    private static let formatters: [String: DateFormatter] = {
        var out: [String: DateFormatter] = [:]
        for pattern in ["EEE d MMM", "EEE, d MMM yyyy", "d MMM", "d MMM yyyy"] {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = ERPDate.karachi
            f.dateFormat = pattern
            out[pattern] = f
        }
        return out
    }()

    /// A `yyyy-MM-dd` day key written as "Thu 8 Oct" (one of the patterns above).
    static func day(_ key: String, _ pattern: String = "EEE d MMM") -> String {
        guard let d = AnaDate.parseISO(key), let f = formatters[pattern] else { return key }
        return f.string(from: d)
    }

    /// The metal word of the house: Gold, or Silver at House of Mina (the descriptor's `metal`).
    static var metalWord: String { House.metal == "silver" ? "Silver" : "Gold" }
}

// MARK: Where a chart draws a day, a week or a month

/// Charts floor a date in the phone's own zone, so a Karachi midnight could land on the day before. Every plotted
/// date is placed at mid-day (mid-month for a month): the same day wherever the phone is.
enum AbPlot {
    static func day(_ start: Date) -> Date { start.addingTimeInterval(12 * 3600) }
    static func month(_ start: Date) -> Date { start.addingTimeInterval(14 * 86_400 + 12 * 3600) }
    static func bucket(_ start: Date, _ bucket: BooksBucket) -> Date {
        switch bucket {
        case .day: return day(start)
        case .week: return start.addingTimeInterval(3 * 86_400 + 12 * 3600)
        case .month: return month(start)
        }
    }
}
