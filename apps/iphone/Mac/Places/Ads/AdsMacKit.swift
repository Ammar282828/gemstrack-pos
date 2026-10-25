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
#endif
