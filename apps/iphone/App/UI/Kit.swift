import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// Static placeholders never obscure a page with a spinning activity indicator.
///
/// `.controlSize(.large)` is a whole page still loading: the ledger page's own shape (a date line, the hero
/// card, a folded card, then a section of rows) on the page's own cards and margins, pinned to the top, so
/// the page arrives where its outline already stood rather than the outline floating mid-screen and jumping.
/// Nothing moves in it: a cold start shows one steady frame until the books are in.
struct SkeletonLoading: View {
    @Environment(\.controlSize) private var size
    private let label: String
    init(_ label: String = "Loading") { self.label = label }

    var body: some View {
        Group {
            if size == .large {
                page
            } else {
                VStack(alignment: .leading, spacing: pt(5)) {
                    ForEach(0..<3, id: \.self) { index in
                        Capsule()
                            .fill(.secondary.opacity(0.12))
                            .frame(width: index == 1 ? 54 : 76, height: 5)
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var page: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            line(width: 132, height: 10).padding(.horizontal, pt(4)).padding(.top, pt(6))
            card(height: 172) {
                VStack(alignment: .leading, spacing: pt(12)) {
                    line(width: 84, height: 10)
                    line(width: 190, height: 30)
                    line(width: 120, height: 10)
                }
            }
            card(height: 52) { line(width: 120, height: 12) }
            line(width: 96, height: 12).padding(.horizontal, pt(4)).padding(.top, pt(14))
            card(height: nil) {
                VStack(spacing: 0) {
                    ForEach(0..<3, id: \.self) { index in
                        HStack(spacing: pt(12)) {
                            Circle().fill(.secondary.opacity(0.12)).frame(width: 36, height: 36)
                            VStack(alignment: .leading, spacing: pt(8)) {
                                line(width: index == 1 ? 120 : 150, height: 11)
                                line(width: 90, height: 9)
                            }
                            Spacer(minLength: 8)
                            line(width: 56, height: 11)
                        }
                        .frame(height: 64)
                    }
                }
            }
        }
        .padding(.horizontal, pt(16))
        .padding(.top, pt(4))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func line(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: height / 2.5, style: .continuous)
            .fill(.secondary.opacity(0.12))
            .frame(width: width, height: height)
    }

    private func card<C: View>(height: CGFloat?, @ViewBuilder _ content: () -> C) -> some View {
        content()
            .padding(.horizontal, pt(16))
            .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
            .houseCard()
    }
}

// The few pieces every native screen shares (CONVENTIONS.md rule 4): content on the system's own
// lists and backgrounds, Liquid Glass only on controls that float over it. Screens build from these
// so a figure, a status or a payment looks and behaves the same everywhere.

/// A sum the way the shop reads it: "PKR 4.5 lac" at a glance, the exact rupees where they are owed.
struct MoneyText: View {
    let amount: Double
    var exact = false

    var body: some View {
        Text(exact ? Money.pkr(amount) : Money.pkrLac(amount))
            .monospacedDigit()
            .contentTransition(.numericText(value: amount))
    }
}

/// One figure: a label, its value large, and a line under it.
struct FigureTile: View {
    let label: String
    let value: String
    var detail: String?
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(value)
                .font(.system(.title2, design: .serif).weight(.semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
                // A new period's figure rolls over digit by digit rather than blinking.
                .contentTransition(.numericText())
                .fixedSize(horizontal: false, vertical: true)
            if let detail, !detail.isEmpty {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        // A tile grows with its words rather than clipping the detail or shrinking the amount.
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .ledgerCard()
    }
}

/// Figures stay side by side at ordinary sizes and read top to bottom at accessibility sizes.
struct FigureRow<Content: View>: View {
    var alignment: VerticalAlignment = .top
    var spacing: CGFloat = 12
    @ViewBuilder let content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: alignment, spacing: spacing))
        layout { content() }
    }
}

struct FigureGrid<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder let content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var availableWidth: CGFloat = 0

    /// Two across, up to four where 240 pt each fit; on an iPad's wide window four across as soon as 160 pt each do
    /// (a dashboard's figures in one row). Accessibility sizes stack in one column.
    private var columns: Int {
        if typeSize.isAccessibilitySize { return 1 }
        if sizeClass.isPadLayout, availableWidth >= 640 { return 4 }
        return max(2, min(4, Int(availableWidth / 240)))
    }

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing),
                                 count: columns), spacing: spacing) {
            content()
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { availableWidth = $0 }
    }
}

/// How the app moves: the ERP's three curves (docs/decisions.md "Motion"), so a filter, a reveal or a figure
/// changes here at the pace it does in the browser. Reduce Motion gets no movement, only the change.
enum Motion {
    /// What arrives: a revealed row, a chosen filter's results. ease-enter (0.22, 1, 0.36, 1), 220 ms.
    static let enter = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.22)
    /// What leaves. ease-exit (0.4, 0, 1, 1), 150 ms.
    static let exit = Animation.timingCurve(0.4, 0, 1, 1, duration: 0.15)
    /// What travels across the page. ease-sheet (0.32, 0.72, 0, 1), 300 ms.
    static let travel = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.3)

    /// `withAnimation(Motion.enter)` unless the reader asked for less motion.
    @MainActor static func run(_ animation: Animation = enter, reduce: Bool, _ change: () -> Void) {
        if reduce { change() } else { withAnimation(animation, change) }
    }
}

/// `.motion(value:)`: the page's change animates on the enter curve, or not at all under Reduce Motion.
struct MotionOnChange<V: Equatable>: ViewModifier {
    let value: V
    var animation: Animation = Motion.enter
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content.animation(reduce ? nil : animation, value: value)
    }
}

extension View {
    func motion<V: Equatable>(_ value: V, _ animation: Animation = Motion.enter) -> some View {
        modifier(MotionOnChange(value: value, animation: animation))
    }
}

/// Whether the tab's create menu (New sale, New order, Scan) is in this page's toolbar, so a page's own
/// "New order" does not stand beside it twice (iPad).
private struct CreateMenuShownKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var createMenuShown: Bool {
        get { self[CreateMenuShownKey.self] }
        set { self[CreateMenuShownKey.self] = newValue }
    }
}

extension Optional where Wrapped == UserInterfaceSizeClass {
    /// The iPad layout: an iPad whose window is wide. A Plus or Max iPhone turned sideways is `.regular` too, and must keep
    /// the phone's tabs and floating button; an iPad in Split View or Slide Over is `.compact` and takes the phone path.
    @MainActor var isPadLayout: Bool {
        #if os(macOS)
        // A Mac window is always the wide layout (the iPad's columns, lists beside their item).
        self == .regular
        #else
        UIDevice.current.userInterfaceIdiom == .pad && self == .regular
        #endif
    }
}

extension EnvironmentValues {
    /// The width class the screens lay themselves out by: the phone's and iPad's horizontal size class, and on the Mac,
    /// which has none, always regular (its windows take the iPad's wide layout).
    var layoutWidthClass: UserInterfaceSizeClass? {
        #if os(macOS)
        .regular
        #else
        horizontalSizeClass
        #endif
    }
}

/// A page's rows in a readable column on an iPad's wide window (about 70 characters of a form, as Settings
/// keeps them), the ground and the scrolling still the whole window's. The margin goes into the safe area, so a
/// List or Form insets its rows and keeps its scroll edge to edge; a phone (compact width) is never touched.
struct ReadableColumn: ViewModifier {
    var maxWidth: CGFloat = 720
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        let inset = sizeClass.isPadLayout ? max(0, ((width - maxWidth) / 2).rounded()) : 0
        Group {
            // Branching on the size class only (it does not change as the page is measured), so the page keeps
            // its state when the margin arrives.
            if sizeClass.isPadLayout {
                // A large title stays at the window's edge while the rows sit centred; in the bar, centred over
                // the column, the name and the page read as one.
                content.safeAreaPadding(.horizontal, inset)
                    .toolbarTitleDisplayMode(inset > 0 ? .inline : .automatic)
                    .environment(\.inReadableColumn, inset > 0)
            } else {
                content
            }
        }
        // Measured outside the margin, so the margin never feeds back into the width it is worked from.
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    /// `.readableColumn()`: rows and fields no wider than `maxWidth` on an iPad; nothing on a phone.
    func readableColumn(_ maxWidth: CGFloat = 720) -> some View { modifier(ReadableColumn(maxWidth: maxWidth)) }
}

private struct InReadableColumnKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The page sits in a centred column on an iPad (ReadableColumn), so its title belongs in the bar.
    var inReadableColumn: Bool {
        get { self[InReadableColumnKey.self] }
        set { self[InReadableColumnKey.self] = newValue }
    }
}

private struct InSectionedEntryKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The page sits under a sectioned entry's picker row (RootView's SectionPicker): its title stays in the bar.
    var inSectionedEntry: Bool {
        get { self[InSectionedEntryKey.self] }
        set { self[InSectionedEntryKey.self] = newValue }
    }
}

/// A hub's large title on a phone; over an iPad's centred column, the title in the bar, centred with the page,
/// rather than a large one left at the window's edge.
private struct HubTitleMode: ViewModifier {
    @Environment(\.inReadableColumn) private var inColumn
    @Environment(\.inSectionedEntry) private var sectioned
    func body(content: Content) -> some View {
        // Under a sectioned entry's picker (Analytics) a large title only reserves an empty band between the bar and
        // the picker (owner, 2026-10-25: "weird empty space in analytics"), so the title sits in the bar.
        content.navigationBarTitleDisplayMode(inColumn || sectioned ? .inline : .large)
    }
}

extension View {
    func hubTitleDisplay() -> some View { modifier(HubTitleMode()) }
}

/// Columns of cards for a wide window: as many as fit at `minimum` each (at most `limit`), all the same width,
/// so a lone card keeps a card's width rather than stretching across an iPad.
enum CardColumns {
    static func count(_ width: CGFloat, minimum: CGFloat = 340, spacing: CGFloat = 20, limit: Int = 3) -> Int {
        max(1, min(limit, Int((width + spacing) / (minimum + spacing))))
    }

    static func grid(_ width: CGFloat, minimum: CGFloat = 340, spacing: CGFloat = 20, limit: Int = 3) -> [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: spacing, alignment: .top),
              count: count(width, minimum: minimum, spacing: spacing, limit: limit))
    }
}

/// An order's status as a coloured word.
struct StatusBadge: View {
    let text: String
    let color: Color

    init(_ text: String, color: Color) {
        self.text = text
        self.color = color
    }

    /// A badge in a tone: the same as `Pill`, which new code uses directly.
    init(_ text: String, tone: Tone) {
        self.init(text, color: tone.color)
    }

    init(order status: OrderStatus) {
        self.init(status.rawValue.isEmpty ? "No status" : status.rawValue, tone: Tone(status: status))
    }

    /// An order status's colour: `Tone(status:)`'s, kept for call sites that still ask for a Color.
    static func color(for s: OrderStatus) -> Color { Tone(status: s).color }

    // A thin wrapper: one capsule look for every badge, which is `Pill`'s.
    var body: some View { Pill(text, color: color) }
}

/// Show cached books immediately; only a confirmed network loss warrants an offline warning.
struct ShelfState<Content: View>: View {
    let loaded: Bool
    let error: String?
    var offline = false
    @ViewBuilder let content: () -> Content

    private var showingOfflineCopy: Bool { offline && Connection.shared.isOffline }

    var body: some View {
        // The books arriving cross-fade over the outline (none under Reduce Motion).
        Group {
            if !loaded {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            } else if let error, !error.isEmpty, !showingOfflineCopy {
                ContentUnavailableView("Couldn't read the books", systemImage: "exclamationmark.icloud", description: Text(error))
            } else {
                loadedContent.transition(.opacity)
            }
        }
        .motion(loaded, Motion.travel)
    }

    private var loadedContent: some View {
        content()
            .safeAreaInset(edge: .top, spacing: 0) {
                if showingOfflineCopy {
                    Label("Offline: showing this phone's copy", systemImage: "icloud.slash")
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, pt(14)).padding(.vertical, pt(7))
                        .glassEffect(.regular, in: .capsule)
                        .padding(.top, pt(4))
                }
            }
    }
}

/// A row's two lines: what it is, and what to know about it.
struct TwoLine: View {
    let title: String
    var subtitle: String?
    var trailing: String?
    var trailingTint: Color = .primary
    var trailingLabel: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: pt(8)) {
                    words
                    amount
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
                    words.frame(maxWidth: .infinity, alignment: .leading)
                    amount.fixedSize(horizontal: true, vertical: false)
                }
            }
        }
        .padding(.vertical, Metrics.tap > 30 ? 4 : 1)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: Metrics.tap > 30 ? 6 : 2) {
            Text(title).fontWeight(.medium)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var amount: some View {
        if let trailing {
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: pt(4)) {
                Text(trailing).font(.subheadline.weight(.semibold))
                    .monospacedDigit().foregroundStyle(trailingTint)
                if let trailingLabel {
                    Text(trailingLabel).font(.caption).foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Dates the way the shop says them: "Today 4:05 pm", "Yesterday", "Tue 6 Oct", "6 Oct 2025".
enum ShopDate {
    private static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    private static func format(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f
    }
    private static let time = format("h:mm a")
    private static let thisYear = format("EEE d MMM")
    private static let older = format("d MMM yyyy")

    static func say(_ iso: String?, withTime: Bool = false) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        return stamp(d, withTime: withTime)
    }

    /// The same words for a `Date` already in hand (a picker's value, `Date()`): "Today 4:05 pm", "Tue 6 Oct".
    static func stamp(_ d: Date, withTime: Bool = false) -> String {
        let t = withTime ? " " + time.string(from: d) : ""
        if karachi.isDateInToday(d) { return "Today" + t }
        if karachi.isDateInYesterday(d) { return "Yesterday" + t }
        if karachi.isDateInTomorrow(d) { return "Tomorrow" + t }
        return (karachi.isDate(d, equalTo: Date(), toGranularity: .year) ? thisYear : older).string(from: d) + t
    }
}

/// How money arrived (the ERP's PAYMENT_TYPES), for the payment sheets.
enum PaymentMethods {
    static let all = ["Cash", "Card", "Bank Transfer", "Cheque"]
}

/// Whom a payment on an invoice is for, so the sheet can say what happens to money over the balance
/// (components/invoice/record-payment-dialog.tsx). Left off for advances and repairs, which have no hisaab.
struct PaymentCustomer {
    /// The name on the bill; empty for a sale to nobody in particular.
    let name: String
    /// A named customer holds the extra as credit on their hisaab; a walk-in cannot (lib/invoice-credit.ts canHoldCredit).
    let canHoldCredit: Bool
}

/// The sheet's numbers and words, kept apart from the view so they read the same wherever they are used.
enum PaymentText {
    /// What was typed, in whole rupees (owner, 2026-10-17: "there should be no decimals"). Thousands commas
    /// are dropped; on a phone set to a region that types its decimal point as a comma ("1500,4") a comma
    /// followed by one or two digits is the decimal point, since a thousands comma always has three. Paise
    /// typed are rounded away, as the ERP rounds every sum to the rupee.
    static func amount(_ text: String) -> Double? {
        guard let v = ShopNumber.parse(text), v >= 0 else { return nil }
        return v.rounded()
    }

    /// A balance for the amount field: whole rupees, no grouping ("1500").
    static func field(_ v: Double) -> String { String(Int(v.rounded())) }

    /// "PKR 1,500": whole rupees, always; an old bill's paise are not shown.
    static func pkr(_ v: Double) -> String { Money.pkr(v) }

    /// A money box's text kept to whole rupees: the number pad types only digits, and a pasted or prefilled
    /// "1,500.40" becomes "1500". Blank stays blank.
    static func whole(_ text: String) -> String {
        if text.allSatisfy({ $0.isASCII && $0.isNumber }) { return text }
        if let v = amount(text), v < 1e15 { return field(v) }
        return ShopNumber.ascii(text).filter { $0.isASCII && $0.isNumber }
    }

    /// What the reference box is for, by how it was paid (the web's labels).
    static func referenceLabel(_ method: String) -> String {
        switch method {
        case "Cheque": return "Cheque no."
        case "Card": return "Last 4 digits"
        case "Bank Transfer": return "Reference"
        default: return "Note"
        }
    }
}

/// A Settle whose payment was taken but whose remainder was not given off (the discount write was refused):
/// the money is on the bill, so the sheet must not offer to take it again.
struct SettleNotGiven: LocalizedError {
    let paid: Double
    let remainder: Double
    let why: String

    var errorDescription: String? {
        "\(PaymentText.pkr(paid)) is recorded. The remaining \(PaymentText.pkr(remainder)) was not taken off: \(why) Change the discount to give it."
    }
}

/// What a Settle does once tapped: take the payment exactly as Save would, then raise the bill's discount by
/// `remainder` (never a payment that was not made). A refusal after the payment is taken is thrown as `SettleNotGiven`.
typealias SettleAction = (_ amount: Double, _ method: String, _ reference: String, _ note: String, _ remainder: Double) async throws -> Void

/// Taking money: an invoice's payment or an order's advance. The amount is typed in whole rupees
/// (no paise) and shown back in lac as it is typed; the write is the ERP's (`save`), and the sheet stays
/// open with the ERP's own words if it refuses. With `settle`, a remainder under 5,000 (what is owed less the
/// amount typed) can be given off (record-payment-dialog.tsx and RecordAdvanceDialog's SettleOffer, ERPCore
/// `settleRemainderOffer`).
struct PaymentSheet: View {
    let title: String
    /// What is still owed, offered as the amount with one tap.
    var owed: Double?
    var askReference = true
    /// Set for an invoice: money over the balance is a named customer's credit, and a walk-in's is refused.
    var customer: PaymentCustomer?
    /// Set for an advance: the note it is written with, which can be changed but not left bare.
    var noteDefault: String?

    private let commit: (_ amount: Double, _ method: String, _ reference: String, _ note: String, _ exchanges: [[String: Any]]) async throws -> Void
    /// Set where the remainder may be given off: an invoice (owners: the discount is theirs to change) and an advance.
    private let settle: SettleAction?

    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    /// The balance as the books keep it, while the field still shows what "All that's owed" put there:
    /// 1500.4 is sent as 1500.4, never as the 1,500 the label would round it to.
    @State private var pinned: Pinned?
    @State private var method = "Cash"
    @State private var reference = ""
    @State private var note: String
    /// An advance may be paid in gold handed over, instead of or beside the cash (OrderAdvanceExchange).
    @State private var exchangeRows: [ExchangeRow] = [blankExchangeRow()]
    @State private var saving = false
    @State private var error: String?
    /// Counted, so the confirming tap is felt once per attempt.
    @State private var recorded = 0
    /// A Settle's payment was taken and its discount refused: nothing more is sent from this sheet.
    @State private var taken = false

    private struct Pinned {
        let text: String
        let value: Double
    }

    /// An invoice's payment, a repair's, or anything else with a reference and no note.
    init(title: String, owed: Double? = nil, askReference: Bool = true, customer: PaymentCustomer? = nil,
         settle: SettleAction? = nil,
         save: @escaping (_ amount: Double, _ method: String, _ reference: String) async throws -> Void) {
        self.title = title
        self.owed = owed
        self.askReference = askReference
        self.customer = customer
        self.noteDefault = nil
        self.commit = { amount, method, reference, _, _ in try await save(amount, method, reference) }
        self.settle = settle
        _note = State(initialValue: "")
    }

    /// An advance on an order: no reference, a note instead, and gold exchanged beside the cash or alone
    /// (order-dialogs.tsx RecordAdvanceDialog). `exchanges` are the rows as `recordOrderAdvance` takes them.
    init(title: String, owed: Double? = nil, note: String, settle: SettleAction? = nil,
         save: @escaping (_ amount: Double, _ method: String, _ note: String, _ exchanges: [[String: Any]]) async throws -> Void) {
        self.title = title
        self.owed = owed
        self.askReference = false
        self.customer = nil
        self.noteDefault = note
        self.commit = { amount, method, _, note, exchanges in try await save(amount, method, note, exchanges) }
        self.settle = settle
        _note = State(initialValue: note)
    }

    /// The exchange rows filled in, and what they come to (nothing for an invoice or a repair).
    private var exchanged: [ExchangeEntry] { noteDefault == nil ? [] : exchangesFromRows(exchangeRows) }
    private var exchangeValue: Double { exchanged.reduce(0) { $0 + $1.value } }

    private var amount: Double {
        if let pinned, pinned.text == amountText { return pinned.value }
        return PaymentText.amount(amountText) ?? 0
    }

    /// What the invoice still asks for; nothing once it is paid.
    private var balance: Double { max(0, owed ?? 0) }

    /// Rupees over the balance, as the web counts them: rounded, and only for an invoice.
    private var over: Double {
        guard customer != nil, amount > 0 else { return 0 }
        return (amount - balance).rounded()
    }

    /// Why Save is closed, in the web's words; nil when it is open.
    private var problem: String? {
        if let customer, over > 0, !customer.canHoldCredit {
            return "More than the balance of \(PaymentText.pkr(balance)). Credit needs a customer: name who this invoice is for first."
        }
        if exchanged.contains(where: { $0.value <= 0 }) {
            return "Give each exchange an amount, or its grams and rate."
        }
        if noteDefault != nil, amount > 0 || exchangeValue > 0, note.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
            return "Please add a brief note for the payment."
        }
        return nil
    }

    /// What would be left owing after this amount, when it is small enough to give off (0 < it < 5,000):
    /// the web's `rupees(balance) - rupees(amount)`. Nil without a Settle, an amount, or a balance.
    private var settleOffer: Double? {
        // Gold taken beside it is not offered a Settle (the web's dialog hides it too).
        guard settle != nil, !taken, let owed, amount > 0, exchangeValue == 0, problem == nil else { return nil }
        return settleRemainderOffer(rupees(owed) - rupees(amount))
    }

    private var creditNote: String? {
        guard let customer, customer.canHoldCredit, over > 0 else { return nil }
        let who = customer.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(Money.pkr(over)) over the balance stays as credit on \(who.isEmpty ? "the customer" : who)'s hisaab."
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Amount in rupees", text: $amountText)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                    if let owed, owed >= 1 {
                        Button("All that's owed: \(PaymentText.pkr(owed))") {
                            amountText = PaymentText.field(owed)
                            pinned = Pinned(text: amountText, value: owed.rounded())
                        }
                    }
                } footer: {
                    if let problem {
                        Text(problem).foregroundStyle(Tone.problem.color)
                    } else if let creditNote {
                        Text(creditNote).foregroundStyle(Tone.credit.color)
                    }
                }
                Section("How it was paid") {
                    Picker("Method", selection: $method) {
                        ForEach(PaymentMethods.all, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                    if askReference && method != "Cash" {
                        TextField(PaymentText.referenceLabel(method), text: $reference, prompt: Text("Optional"))
                    }
                    if noteDefault != nil {
                        TextField("Note", text: $note, prompt: Text("e.g. Second advance payment"))
                    }
                }
                if noteDefault != nil {
                    OrderAdvanceExchange(rows: $exchangeRows)
                }
                if let x = settleOffer {
                    Section {
                        Button(SettleWords.offer(x)) { send(settling: x) }
                            .buttonStyle(.bordered)
                            .tint(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .disabled(saving)
                    } footer: {
                        Text("Takes this payment, then adds \(PaymentText.pkr(x)) to the discount, so nothing is left owing.")
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { send(settling: nil) }
                        .disabled((amount <= 0 && exchangeValue <= 0) || problem != nil || saving || taken)
                }
            }
            // The ERP's words for a refusal, in an alert (which gives the error tap itself).
            .failureAlert($error)
        }
        .sensoryFeedback(.success, trigger: recorded)
        .presentationDetents([.medium, .large])
    }

    /// Save, or Settle (`settling` is the remainder to give off): the ERP's write, the sheet kept open with its words
    /// on a refusal. A Settle whose payment went through but whose discount did not stays open saying so, with
    /// nothing left to send.
    private func send(settling remainder: Double?) {
        if saving || taken { return }
        Task {
            saving = true
            error = nil
            // A cash payment has no reference to carry, whatever was typed before it was switched.
            let ref = method == "Cash" ? "" : reference
            let said = note.trimmingCharacters(in: .whitespacesAndNewlines)
            do {
                if let remainder, let settle {
                    try await settle(amount, method, ref, said, remainder)
                } else {
                    try await commit(amount, method, ref, said, exchanged.map { OrderAdvance.exchangeJSON($0) })
                }
                recorded += 1
                dismiss()
            } catch let e as SettleNotGiven {
                taken = true
                recorded += 1
                self.error = e.localizedDescription
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}

/// A row taken by whoever is signed in, left in its place in the list rather than sorted to the top
/// (src/lib/utils.ts `mineRowClass`; the owner, 2026-10-05): a short bar of the house's accent at its
/// leading edge. The whole row tinted, as it was until 2026-10-09, made a day's card look like a warning;
/// the rows of the redesigned lists also say "You" (MineTag).
struct MineRowBackground: View {
    var body: some View {
        Theme.card
            .overlay(alignment: .leading) {
                Capsule().fill(Theme.accent).frame(width: 3).padding(.vertical, pt(10))
            }
    }
}

extension Binding where Value == String {
    /// A money box's text in whole rupees, as shown and as kept (owner, 2026-10-17: "there should be no
    /// decimals"). Pair it with `.keyboardType(.numberPad)`.
    var wholeRupees: Binding<String> {
        Binding(get: { PaymentText.whole(wrappedValue) }, set: { wrappedValue = PaymentText.whole($0) })
    }
}

extension View {
    /// A list row on the house's card colour, lit when it is the signed-in person's own.
    @ViewBuilder
    func mineRow(_ mine: Bool) -> some View {
        #if os(macOS)
        // The system's row, so its selection still shows; one's own carries the accent's bar.
        listRowBackground(mine ? AnyView(Color.clear.overlay(alignment: .leading) {
            Capsule().fill(Theme.accent).frame(width: 3).padding(.vertical, 6)
        }) : nil)
        #else
        listRowBackground(Group {
            if mine { MineRowBackground() } else { Theme.card }
        })
        #endif
    }
}
