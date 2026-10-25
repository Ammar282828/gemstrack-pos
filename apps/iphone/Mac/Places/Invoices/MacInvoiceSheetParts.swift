#if os(macOS)
import SwiftUI
import ERPCore

// The parts of the Mac's invoice sheets (docs/features/mac-design.md, rule 7): a short modal task, about 440 pt wide, its
// first field focused, Return confirms, Esc cancels, the title in the sheet. The button says what it does ("Take PKR
// 25,000"), so nothing asks a second time. The sheets' own state and writes stay in their files (Kit's PaymentSheet,
// InvoiceAction*Sheet.swift); this is only the frame and the fields they share on a Mac.

/// A Mac sheet: its title and a line under it, a form, then Cancel and the confirming button as a dialog's footer.
struct MacInvoiceSheetFrame<Content: View>: View {
    let title: String
    var subtitle: String?
    let confirmTitle: String
    var confirmRole: ButtonRole?
    var cancelTitle = "Cancel"
    var canConfirm = true
    var busy = false
    let confirm: () -> Void
    let cancel: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            heading
            Form { content() }
                .formStyle(.columns)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            Divider()
            footer
        }
        .frame(width: 440)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.headline)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Spacer(minLength: 0)
            if busy { ProgressView().controlSize(.small) }
            Button(cancelTitle, action: cancel)
                .keyboardShortcut(.cancelAction)
            Button(role: confirmRole, action: confirm) { Text(confirmTitle) }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!canConfirm || busy)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

/// A box for a number in a sheet, with the keyboard in it when the sheet opens. Its label is the row's (LabeledContent).
struct MacInvoiceNumberField: View {
    let title: String
    @Binding var text: String
    var prompt = "0"
    var focused = true
    @FocusState private var hasFocus: Bool

    var body: some View {
        TextField(title, text: $text, prompt: Text(prompt))
            .labelsHidden()
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
            .focused($hasFocus)
            .onAppear {
                if focused { DispatchQueue.main.async { hasFocus = true } }
            }
    }
}

/// A box for a word or a name in a sheet, with the keyboard in it when the sheet opens (a note, a number to send to).
struct MacInvoiceTextField: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var focused = true
    @FocusState private var hasFocus: Bool

    var body: some View {
        TextField(title, text: $text, prompt: Text(prompt))
            .focused($hasFocus)
            .onAppear {
                if focused { DispatchQueue.main.async { hasFocus = true } }
            }
    }
}

/// A figure in a sheet, plain: the label, then the sum in steady digits ("Now": the invoice as it stands).
struct MacInvoiceFigureRow: View {
    let label: String
    let value: String
    var bold = false
    var tone: Tone = .quiet

    var body: some View {
        LabeledContent(label) {
            Text(value)
                .monospacedDigit()
                .fontWeight(bold ? .semibold : .regular)
                .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
        }
    }
}

// MARK: The round-off menu

/// The discount's "Round ▾": up to three offers to round the bill down (ERPCore's `roundOffOffers`, the rule the phone's
/// chips show), as a menu. Picking one adds its extra to the discount; picking the ticked one puts the discount back.
struct MacInvoiceRoundMenu: View {
    /// What the bill comes to before any discount (the pieces less the exchange).
    let payable: Double
    /// The discount as typed, already read to a number.
    let discount: Double
    /// Receives the bill's whole discount once an offer is taken (or undone).
    let onDiscountChange: (Double) -> Void

    private struct Applied: Equatable {
        let base: Double
        let target: Double
    }
    @State private var applied: Applied?

    var body: some View {
        let disc = rupees(discount)
        let whole = rupees(payable)
        let lit = applied.flatMap { whole - disc == $0.target ? $0 : nil }
        let base = lit?.base ?? disc
        let offers = roundOffOffers(whole, base)
        Menu("Round") {
            ForEach(offers, id: \.target) { o in
                Button {
                    if lit?.target == o.target {
                        applied = nil
                        onDiscountChange(base)
                    } else {
                        applied = Applied(base: base, target: o.target)
                        onDiscountChange(discountWithOffer(base, o))
                    }
                } label: {
                    if lit?.target == o.target {
                        Label(roundOffLabel(o), systemImage: "checkmark")
                    } else {
                        Text(roundOffLabel(o))
                    }
                }
            }
        }
        .disabled(offers.isEmpty)
        .help(offers.isEmpty ? "The bill is already round" : "Round the bill down by taking a little more off")
    }
}

// MARK: The delete code, inside the sheet

/// A sheet that ends in the delete code (decision "Delete code"): what goes, then the four digits, in this one sheet, never
/// a second one over it. The ERP checks the code with the delete itself (`OwnerDeletion.run`), so nothing is deleted unless
/// it was right. A Mac that keeps the code behind Touch ID offers it as a button. `prepare` makes the deletion when the
/// button is pressed (a refund works out its figures first).
struct MacInvoiceCodeSheet<Content: View>: View {
    let title: String
    var subtitle: String?
    let confirmTitle: String
    var canConfirm = true
    let prepare: () -> OwnerDeletion?
    let onDone: () -> Void
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var keep = true
    @State private var kept = FaceIDVault.has(OwnerDeleteCodeSheet.faceKey)
    @FocusState private var codeFocused: Bool
    private let canFace = FaceIDVault.biometry().available

    var body: some View {
        MacInvoiceSheetFrame(title: title, subtitle: subtitle, confirmTitle: confirmTitle, confirmRole: .destructive,
                             canConfirm: canConfirm && code.count >= 4, busy: busy,
                             confirm: { Task { await submit(code, byFace: false) } },
                             cancel: { dismiss() }) {
            content()
            codeFields
        }
        .interactiveDismissDisabled(busy)
    }

    @ViewBuilder
    private var codeFields: some View {
        SecureField("Delete Code", text: $code, prompt: Text("Four digits"))
            .focused($codeFocused)
            .onAppear { DispatchQueue.main.async { codeFocused = true } }
            .onChange(of: code) { _, typed in
                let digits = String(typed.filter { $0.isASCII && $0.isNumber }.prefix(8))
                if digits != typed { code = digits }
                // Typing again clears the last refusal.
                if !typed.isEmpty { error = nil }
            }
        if canFace && kept {
            Button { Task { await byFace() } } label: { Label("Use Touch ID", systemImage: "touchid") }
                .disabled(busy)
        }
        if canFace && !kept {
            Toggle("Use Touch ID next time on this Mac", isOn: $keep)
        }
        if let error {
            Text(error).foregroundStyle(Tone.problem.color)
        }
    }

    private func submit(_ given: String, byFace: Bool) async {
        guard !busy, given.count >= 4 else { return }
        guard let deletion = prepare() else { return }
        busy = true
        error = nil
        do {
            try await deletion.run(given)
            if !byFace && canFace && !kept && keep { try? FaceIDVault.save(given, for: OwnerDeleteCodeSheet.faceKey) }
            busy = false
            onDone()
            dismiss()
            return
        } catch let f as ERPAPI.Failure where f.status == 403 && f.message == "Wrong code." {
            if byFace {
                // The shop changed the code: this Mac's copy is no use any more.
                FaceIDVault.delete(OwnerDeleteCodeSheet.faceKey)
                kept = false
                error = "The delete code has changed. Type the new one."
            } else {
                error = "Wrong code."
            }
            code = ""
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    /// Touch ID unlocks the kept code and sends it; a closed Touch ID sheet leaves the box to type in.
    private func byFace() async {
        guard let saved = try? await FaceIDVault.read(OwnerDeleteCodeSheet.faceKey, reason: title) else { return }
        await submit(saved, byFace: true)
    }
}
#endif
