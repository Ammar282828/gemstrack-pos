#if os(macOS)
import SwiftUI
import ERPCore

// What the Ads places share on the Mac (docs/features/mac-design.md, "Ads"): the account's alerts as a bar above a
// table, the foot of a short sheet, and a plain heading.

/// The account's own trouble (payment due, a login running out) as a bar above a page that is not a List.
struct AdsMacAlertBar: View {
    let status: AdsStatusAnswer

    var body: some View {
        let lines = AdsAlertsSection(status: status).macLines
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Label(line.text, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(line.bad ? Tone.problem.color : Tone.owed.color)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.bar)
        }
    }
}

/// The foot of a short sheet: Cancel (Esc) and the one button that says what it will do (Return).
struct AdsMacSheetFooter: View {
    let title: String
    var disabled = false
    var cancelTitle = "Cancel"
    let cancel: () -> Void
    let confirm: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Spacer()
                Button(cancelTitle, action: cancel)
                    .keyboardShortcut(.cancelAction)
                Button(title, action: confirm)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(disabled)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
    }
}

/// A short line under a table's head: what the table holds, in quiet words.
struct AdsMacNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A sum in an ad table's cell: the digits only, right-aligned, whole rupees from 100 up and the paise or cents below it
/// (a click costs "12.5", and a whole-rupee cell would say 13). `unit` is a quiet word after it ("a day"). The column's
/// header names the figure; an account in another currency says so there (`header`), not in every cell.
struct AdsMacMoney: View {
    let amount: Double?
    var unit: String?
    var tone: Tone = .quiet

    init(_ amount: Double?, unit: String? = nil, tone: Tone = .quiet) {
        self.amount = amount
        self.unit = unit
        self.tone = tone
    }

    var body: some View {
        HStack(spacing: 3) {
            if let amount {
                Text(AdsMacMoney.say(amount)).monospacedDigit()
                if let unit { Text(unit).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .lineLimit(1)
        .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    static func say(_ v: Double) -> String {
        guard v.isFinite else { return "" }
        if abs(v) >= 100 { return Money.grouped(v) }
        if abs(v) < 0.005 { return "0" }
        var s = String(format: "%.2f", v)
        while s.contains(".") && s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// "Spent", or "Spent (USD)" where the ad account is not in rupees.
    static func header(_ title: String, _ currency: String) -> String {
        let code = currency.uppercased()
        return code.isEmpty || code == "PKR" ? title : "\(title) (\(code))"
    }
}

/// A picked object's figures in an inspector: the label at the left, the value at the right and its change under it, one
/// to a line (two to a line would not fit 260 points).
struct AdsMacFigureRows: View {
    let figures: [MacFigure]

    var body: some View {
        ForEach(figures) { (f: MacFigure) in
            LabeledContent {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(f.value).monospacedDigit().foregroundStyle(f.tone?.color ?? Color.primary)
                    if let detail = f.detail, !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(f.detailTone?.color ?? Color.secondary)
                    }
                }
                .multilineTextAlignment(.trailing)
            } label: {
                Text(f.label)
            }
        }
    }
}
#endif
