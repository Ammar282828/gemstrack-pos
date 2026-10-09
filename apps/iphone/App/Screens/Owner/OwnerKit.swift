import SwiftUI
import ERPCore

// What the owners' pages share (Overheads, Shareholders, Recently removed): the delete code, asked
// before a delete the ERP's server carries out, and the line said after a save. Every type here
// carries Owner in its name so it cannot meet another group's helpers in the one module.

/// One delete waiting for its code: what is deleted (said in the sheet and in the ERP's log of who
/// tried), what goes with it, and the write that runs once the code is typed.
struct OwnerDeletion: Identifiable {
    let id = UUID()
    /// The store's own words for it ("Delete this Mina ledger entry").
    let what: String
    /// What else happens, said before the code is asked for (the web's confirmation).
    let detail: String
    /// The ERP's write, sent with the code; it throws the ERP's words when refused.
    let run: (_ code: String) async throws -> Void
}

/// The delete code (decision "Delete code"): four digits the ERP's server checks with the delete itself,
/// so nothing is deleted unless the code was right. As on the web's dialog, a phone with Face ID can keep
/// the code behind it (the same place the web dialog keeps it inside the app, `delete-code`): offered once
/// a typed code has been taken, then asked for by face, and forgotten when the shop changes the code.
struct OwnerDeleteCodeSheet: View {
    let deletion: OwnerDeletion
    /// Told once the delete has gone through.
    let onDone: () -> Void

    /// The key the ERP's own dialog uses (components/shared/delete-code-dialog.tsx FACE_KEY).
    static let faceKey = "delete-code"

    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var keep = true
    @State private var kept = FaceIDVault.has(OwnerDeleteCodeSheet.faceKey)
    private let canFace = FaceIDVault.biometry().available

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    SecureField("Delete code", text: $code)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .onChange(of: code) { _, typed in
                            let digits = String(typed.filter { $0.isASCII && $0.isNumber }.prefix(8))
                            if digits != typed { code = digits }
                            // Typing again clears the last refusal; the box emptied after one keeps it said.
                            if !typed.isEmpty { error = nil }
                        }
                    if canFace && kept {
                        Button { Task { await byFace() } } label: { Label("Use Face ID", systemImage: "faceid") }
                            .disabled(busy)
                    }
                    if canFace && !kept {
                        Toggle("Use Face ID next time on this phone", isOn: $keep)
                    }
                } header: {
                    Text(deletion.what).textCase(nil)
                } footer: {
                    Text(deletion.detail.isEmpty ? "This can't be undone. Enter the code to go ahead." : "\(deletion.detail) This can't be undone. Enter the code to go ahead.")
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("Delete code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Delete", role: .destructive) { Task { await submit(code, byFace: false) } }
                        .disabled(busy || code.count < 4)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
        // Asked by face as soon as the sheet opens, when this phone keeps the code.
        .task { if canFace && kept { await byFace() } }
    }

    private func submit(_ given: String, byFace: Bool) async {
        guard !busy, given.count >= 4 else { return }
        busy = true
        error = nil
        do {
            try await deletion.run(given)
            if !byFace && canFace && !kept && keep { try? FaceIDVault.save(given, for: Self.faceKey) }
            busy = false
            onDone()
            dismiss()
            return
        } catch let f as ERPAPI.Failure where f.status == 403 && f.message == "Wrong code." {
            if byFace {
                // The shop changed the code: the phone's copy is no use any more.
                FaceIDVault.delete(Self.faceKey)
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

    /// Face ID unlocks the kept code and sends it; a closed Face ID sheet leaves the box to type in.
    private func byFace() async {
        guard let saved = try? await FaceIDVault.read(Self.faceKey, reason: deletion.what) else { return }
        await submit(saved, byFace: true)
    }
}

/// What was said after a save, for a few seconds (the web's toast).
struct OwnerNote: Equatable {
    let title: String
    var detail = ""
}

struct OwnerNoteBanner: View {
    let note: OwnerNote

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                if !note.detail.isEmpty {
                    Text(note.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

extension View {
    /// The note floating over the bottom of the screen, gone after four seconds.
    func ownerNote(_ note: Binding<OwnerNote?>) -> some View {
        overlay(alignment: .bottom) {
            if let shown = note.wrappedValue {
                OwnerNoteBanner(note: shown)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task(id: note.wrappedValue) {
            guard note.wrappedValue != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { withAnimation { note.wrappedValue = nil } }
        }
    }
}

enum OwnerText {
    /// The pages' money: whole rupees, grouped in threes (`PKR ${Math.round(n).toLocaleString()}`).
    static func pkr(_ n: Double) -> String { Money.pkr(n) }

    /// "+ PKR 30,000" / "− PKR 30,000", the minus a real minus (overheads/page.tsx `signed`).
    static func signed(_ n: Double) -> String { "\(n < 0 ? "\u{2212}" : "+") \(Money.pkr(abs(n)))" }

    /// The form's day for the ERP ("2026-10-09"): the day picked, in Karachi, as the web's date box gives it.
    static func day(_ d: Date) -> String { ERPDate.karachiDay(d) }

    /// "1 Oct 2026" (date-fns 'd MMM yyyy', the web's ledger rows).
    static func shortDate(_ iso: String) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM yyyy"
        return f.string(from: d)
    }
}
