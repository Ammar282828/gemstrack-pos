import SwiftUI
import ERPCore

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
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            Text(value)
                .font(.title2.weight(.semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let detail, !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(.tertiary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card, in: .rect(cornerRadius: 18))
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
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
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

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(trailingTint)
            }
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

/// Taking money: an invoice's payment or an order's advance. The amount is typed in rupees and
/// shown back in lac as it is typed; the write is the ERP's (`save`), and the sheet stays open with
/// the ERP's own words if it refuses.
struct PaymentSheet: View {
    let title: String
    /// What is still owed, offered as the amount with one tap.
    var owed: Double?
    var askReference = true
    let save: (_ amount: Double, _ method: String, _ reference: String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var method = "Cash"
    @State private var reference = ""
    @State private var saving = false
    @State private var error: String?

    private var amount: Double { Double(amountText.replacingOccurrences(of: ",", with: "")) ?? 0 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Amount in rupees", text: $amountText)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                    if let owed, owed > 0 {
                        Button("All that's owed: \(Money.pkr(owed))") { amountText = String(Int(owed.rounded())) }
                    }
                }
                Section("How it was paid") {
                    Picker("Method", selection: $method) {
                        ForEach(PaymentMethods.all, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                    if askReference && method != "Cash" {
                        TextField("Reference (optional)", text: $reference)
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
                                try await save(amount, method, reference)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            saving = false
                        }
                    }
                    .disabled(amount <= 0 || saving)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
