import SwiftUI
import ERPCore

/// Settings → Shop (src/app/settings/page.tsx): the details printed on every invoice and order slip, the
/// shop's mode and style, and the next numbers. The counters move only through their own write
/// (/api/app/write `setCounters`, lib/writes/counters.ts), with the delete code: a number moved back gives the
/// next bill a number already printed on another, so it is never one of the plain settings.
struct ShopSettings: View {
    var body: some View {
        SettingsGate(title: "Shop") { ShopForm(settings: $0) }
    }
}

private struct ShopForm: View {
    let settings: Settings
    @State private var writer = SettingsWriter()
    @State private var draft: Draft
    /// What the book last held for each text, so only what was typed is sent.
    @State private var base: Draft
    @FocusState private var focus: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The numbering being changed: nil while it is only shown.
    @State private var numbers: Numbers?
    @State private var deleteCode = ""
    @State private var savingNumbers = false
    @State private var note: Note?

    private struct Numbers: Equatable {
        var invoice: Int?
        var order: Int?
        var repair: Int?
    }

    private enum Field: Hashable { case name, address, contact }

    private struct Draft: Equatable {
        var name: String
        var address: String
        var contact: String

        init(_ s: Settings) {
            name = s.shopName
            address = s.shopAddress
            contact = s.shopContact
        }
    }

    init(settings: Settings) {
        self.settings = settings
        _draft = State(initialValue: Draft(settings))
        _base = State(initialValue: Draft(settings))
    }

    var body: some View {
        Form { Group {
            Section {
                LabeledContent("Shop name") {
                    TextField("Shop name", text: $draft.name)
                        .multilineTextAlignment(.trailing)
                        .focused($focus, equals: .name)
                        .submitLabel(.done)
                        .onSubmit { commit() }
                }
                LabeledContent("Contact") {
                    TextField("Phone or email", text: $draft.contact)
                        .multilineTextAlignment(.trailing)
                        .focused($focus, equals: .contact)
                        .submitLabel(.done)
                        .onSubmit { commit() }
                }
                VStack(alignment: .leading, spacing: pt(4)) {
                    Text("Address").font(.subheadline).foregroundStyle(.secondary)
                    TextField("Address", text: $draft.address, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focus, equals: .address)
                }
            } header: {
                LedgerHeading(title: "Shop details")
            } footer: {
                Text("Printed at the top of every invoice and order slip.")
            }

            Section {
                Picker("Shop mode", selection: Binding<String>(
                    get: { writer.pick("theme", settings.theme == "default" ? "default" : "taheri") },
                    set: { writer.choose("theme", $0) }
                )) {
                    Text("Light").tag("default")
                    Text("Dark").tag("taheri")
                }
                Picker("Interface style", selection: Binding<String>(
                    get: { writer.pick("uiStyle", settings.uiStyle == "glass" ? "glass" : "standard") },
                    set: { writer.choose("uiStyle", $0) }
                )) {
                    Text("Standard").tag("standard")
                    Text("Liquid Glass").tag("glass")
                }
            } header: {
                LedgerHeading(title: "Appearance")
            } footer: {
                Text("For every device that has not chosen its own, on the ERP’s web pages.")
            }

            numbering
            }
            .houseRows()
        }
        .onChange(of: focus) { old, new in
            if old != nil, old != new { commit() }
        }
        .onChange(of: settings) { _, new in
            sync(new)
            writer.settled()
        }
        .onDisappear { commit() }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .settingsFailure(writer)
        .noteToast($note)
    }

    // MARK: Numbering

    @ViewBuilder
    private var numbering: some View {
        if numbers != nil {
            Section {
                counterField("Last invoice number", \Numbers.invoice, prefix: "INV", stored: settings.lastInvoiceNumber)
                counterField("Last order number", \Numbers.order, prefix: "ORD", stored: settings.lastOrderNumber)
                counterField("Last repair number", \Numbers.repair, prefix: "REP", stored: settings.lastRepairNumber ?? 0)
                SecureField("Delete code", text: $deleteCode)
                    .keyboardType(.numberPad)
                    .fieldKind(.oneTimeCode)
                Button { Task { await saveNumbers() } } label: {
                    Text(savingNumbers ? "Saving…" : "Save numbering").frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .disabled(savingNumbers || deleteCode.count < 4 || !numbersValid)
                Button("Cancel", role: .cancel) { numbers = nil; deleteCode = "" }
                    .disabled(savingNumbers)
            } header: {
                LedgerHeading(title: "Document numbering")
            } footer: {
                Text("The next invoice, order or repair continues from these. Change them only when moving from another system: a number moved back gives the next bill a number already printed on another. Asks for the delete code.")
            }
        } else {
            Section {
                LabeledContent("Next invoice", value: Self.next("INV", settings.lastInvoiceNumber))
                LabeledContent("Next order", value: Self.next("ORD", settings.lastOrderNumber))
                LabeledContent("Next repair", value: Self.next("REP", settings.lastRepairNumber ?? 0))
                Button("Change numbering") {
                    numbers = Numbers(invoice: settings.lastInvoiceNumber, order: settings.lastOrderNumber, repair: settings.lastRepairNumber ?? 0)
                    deleteCode = ""
                }
            } header: {
                LedgerHeading(title: "Document numbering")
            } footer: {
                Text("Changed only when moving from another system.")
            }
        }
    }

    private func counterField(_ title: String, _ key: WritableKeyPath<Numbers, Int?>, prefix: String, stored: Int) -> some View {
        let value = Binding<Int?>(
            get: { numbers?[keyPath: key] },
            set: { numbers?[keyPath: key] = $0 }
        )
        let typed = value.wrappedValue
        return VStack(alignment: .leading, spacing: pt(4)) {
            LabeledContent(title) {
                TextField("\(stored)", value: value, format: .number.grouping(.never))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            Group {
                if let typed, typed >= 0 {
                    Text("Now \(stored). Next: \(Self.next(prefix, typed))")
                } else {
                    Text("A whole number, 0 or more.").foregroundStyle(Tone.problem.color)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var numbersValid: Bool {
        guard let n = numbers else { return false }
        return [n.invoice, n.order, n.repair].allSatisfy { ($0 ?? -1) >= 0 }
    }

    private func saveNumbers() async {
        guard let n = numbers, numbersValid, !savingNumbers else { return }
        var counters: [String: Any] = [:]
        if let v = n.invoice, v != settings.lastInvoiceNumber { counters["lastInvoiceNumber"] = v }
        if let v = n.order, v != settings.lastOrderNumber { counters["lastOrderNumber"] = v }
        if let v = n.repair, v != (settings.lastRepairNumber ?? 0) { counters["lastRepairNumber"] = v }
        guard !counters.isEmpty else {
            numbers = nil
            deleteCode = ""
            return
        }
        savingNumbers = true
        defer { savingNumbers = false }
        do {
            let out = try await ERPAPI.shared.write("setCounters", ["counters": counters, "deleteCode": deleteCode], business: writer.business)
            let moved = (out["moved"] as? [String])?.count ?? counters.count
            numbers = nil
            deleteCode = ""
            Note.show(Note(title: "Numbering changed", detail: "\(moved) counter\(moved == 1 ? "" : "s") moved. The next number continues from the new one."),
                      in: $note, reduce: reduceMotion)
        } catch {
            writer.error = error.localizedDescription
            if (error as? ERPAPI.Failure)?.status == 403 { deleteCode = "" }
        }
    }

    private static func next(_ prefix: String, _ last: Int) -> String {
        "\(prefix)-" + String(format: "%06d", last + 1)
    }

    /// What the book now holds replaces a text only where nothing has been typed over it.
    private func sync(_ s: Settings) {
        let fresh = Draft(s)
        for k in [\Draft.name, \Draft.address, \Draft.contact] where draft[keyPath: k] == base[keyPath: k] {
            draft[keyPath: k] = fresh[keyPath: k]
        }
        base = fresh
    }

    private func commit() {
        var next = base
        var patch: [String: Any] = [:]

        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name != base.name {
            if name.isEmpty {
                writer.error = "The shop needs a name."
                draft.name = base.name
            } else {
                patch["shopName"] = name
                next.name = name
            }
        }
        let address = draft.address.trimmingCharacters(in: .whitespacesAndNewlines)
        if address != base.address {
            patch["shopAddress"] = address
            next.address = address
        }
        let contact = draft.contact.trimmingCharacters(in: .whitespacesAndNewlines)
        if contact != base.contact {
            patch["shopContact"] = contact
            next.contact = contact
        }
        guard !patch.isEmpty else { return }

        base = next
        draft = next
        writer.queue(patch, label: "Shop details")
    }
}
