import SwiftUI
import ERPCore

/// Static placeholders never obscure a page with a spinning activity indicator.
struct SkeletonLoading: View {
    @Environment(\.controlSize) private var size
    private let label: String
    init(_ label: String = "Loading") { self.label = label }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .large ? 20 : 5) {
            ForEach(0..<(size == .large ? 5 : 3), id: \.self) { index in
                RoundedRectangle(cornerRadius: size == .large ? 12 : 4)
                    .fill(.secondary.opacity(0.12))
                    .frame(width: size == .large ? nil : (index == 1 ? 54 : 76), height: size == .large ? 64 : 5)
            }
        }
        .padding(size == .large ? 20 : 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
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
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(value)
                .font(.system(.title2, design: .serif).weight(.semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
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

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing),
                                 count: typeSize.isAccessibilitySize ? 1 : 2), spacing: spacing) {
            content()
        }
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

    init(order status: OrderStatus) {
        self.init(status.rawValue.isEmpty ? "No status" : status.rawValue, color: Self.color(for: status))
    }

    static func color(for s: OrderStatus) -> Color {
        switch s {
        case .pending: return .orange
        case .inProgress: return .blue
        case .completed: return .green
        case .cancelled, .refunded: return .secondary
        case .unknown: return .secondary
        }
    }

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: .capsule)
    }
}

/// What a screen shows before and around a shelf's documents: a spinner until the first answer,
/// the error if the books could not be read, a line when the phone is showing its own copy.
struct ShelfState<Content: View>: View {
    let loaded: Bool
    let error: String?
    var offline = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        if !loaded {
            SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, !error.isEmpty, !offline {
            ContentUnavailableView("Couldn't read the books", systemImage: "exclamationmark.icloud", description: Text(error))
        } else {
            content()
                .safeAreaInset(edge: .top, spacing: 0) {
                    if offline {
                        Label("Offline: showing this phone's copy", systemImage: "icloud.slash")
                            .font(.footnote.weight(.medium))
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .glassEffect(.regular, in: .capsule)
                            .padding(.top, 4)
                    }
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
                VStack(alignment: .leading, spacing: 8) {
                    words
                    amount
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    words.frame(maxWidth: .infinity, alignment: .leading)
                    amount.fixedSize(horizontal: true, vertical: false)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).fontWeight(.medium)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var amount: some View {
        if let trailing {
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 4) {
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
    /// What was typed, as rupees and paise. Thousands commas are dropped; on a phone set to a region that
    /// types its decimal point as a comma ("1500,4") a comma followed by one or two digits is the
    /// decimal point, since a thousands comma always has three.
    static func amount(_ text: String) -> Double? {
        var t = text.trimmingCharacters(in: .whitespaces)
        if !t.contains("."), let comma = t.lastIndex(of: ",") {
            let after = t.distance(from: comma, to: t.endIndex) - 1
            if after == 1 || after == 2 { t.replaceSubrange(comma...comma, with: ".") }
        }
        t = t.replacingOccurrences(of: ",", with: "")
        guard !t.isEmpty, let v = Double(t), v.isFinite, v >= 0 else { return nil }
        return (v * 100).rounded() / 100
    }

    /// A balance for the amount field: up to two decimals, no grouping, no trailing zeros ("1500.4").
    static func field(_ v: Double) -> String {
        var s = String(format: "%.2f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// "PKR 1,500" for whole rupees, "PKR 1,500.4" when paise are owed: Money.pkr would round them away.
    static func pkr(_ v: Double) -> String {
        if abs(v - v.rounded()) < 0.005 { return Money.pkr(v) }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 2
        return "PKR " + (f.string(from: NSNumber(value: v)) ?? String(v))
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

/// Taking money: an invoice's payment or an order's advance. The amount is typed in rupees (paise
/// allowed) and shown back in lac as it is typed; the write is the ERP's (`save`), and the sheet stays
/// open with the ERP's own words if it refuses.
struct PaymentSheet: View {
    let title: String
    /// What is still owed, offered as the amount with one tap.
    var owed: Double?
    var askReference = true
    /// Set for an invoice: money over the balance is a named customer's credit, and a walk-in's is refused.
    var customer: PaymentCustomer?
    /// Set for an advance: the note it is written with, which can be changed but not left bare.
    var noteDefault: String?

    private let commit: (_ amount: Double, _ method: String, _ reference: String, _ note: String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    /// The balance as the books keep it, while the field still shows what "All that's owed" put there:
    /// 1500.4 is sent as 1500.4, never as the 1,500 the label would round it to.
    @State private var pinned: Pinned?
    @State private var method = "Cash"
    @State private var reference = ""
    @State private var note: String
    @State private var saving = false
    @State private var error: String?

    private struct Pinned {
        let text: String
        let value: Double
    }

    /// An invoice's payment, a repair's, or anything else with a reference and no note.
    init(title: String, owed: Double? = nil, askReference: Bool = true, customer: PaymentCustomer? = nil,
         save: @escaping (_ amount: Double, _ method: String, _ reference: String) async throws -> Void) {
        self.title = title
        self.owed = owed
        self.askReference = askReference
        self.customer = customer
        self.noteDefault = nil
        self.commit = { amount, method, reference, _ in try await save(amount, method, reference) }
        _note = State(initialValue: "")
    }

    /// An advance on an order: no reference, a note instead (order-dialogs.tsx RecordAdvanceDialog).
    init(title: String, owed: Double? = nil, note: String,
         save: @escaping (_ amount: Double, _ method: String, _ note: String) async throws -> Void) {
        self.title = title
        self.owed = owed
        self.askReference = false
        self.customer = nil
        self.noteDefault = note
        self.commit = { amount, method, _, note in try await save(amount, method, note) }
        _note = State(initialValue: note)
    }

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
        if noteDefault != nil, amount > 0, note.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
            return "Please add a brief note for the payment."
        }
        return nil
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
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                    if let owed, owed > 0 {
                        Button("All that's owed: \(PaymentText.pkr(owed))") {
                            amountText = PaymentText.field(owed)
                            pinned = Pinned(text: amountText, value: owed)
                        }
                    }
                } footer: {
                    if let problem {
                        Text(problem).foregroundStyle(.red)
                    } else if let creditNote {
                        Text(creditNote).foregroundStyle(.green)
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
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        Task {
                            saving = true
                            error = nil
                            do {
                                // A cash payment has no reference to carry, whatever was typed before it was switched.
                                try await commit(amount, method, method == "Cash" ? "" : reference,
                                                 note.trimmingCharacters(in: .whitespacesAndNewlines))
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            saving = false
                        }
                    }
                    .disabled(amount <= 0 || problem != nil || saving)
                }
            }
        }
        .presentationDetents([.medium, .large])
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
                Capsule().fill(Theme.accent).frame(width: 3).padding(.vertical, 10)
            }
    }
}

extension View {
    /// A list row on the house's card colour, lit when it is the signed-in person's own.
    func mineRow(_ mine: Bool) -> some View {
        listRowBackground(Group {
            if mine { MineRowBackground() } else { Theme.card }
        })
    }
}
