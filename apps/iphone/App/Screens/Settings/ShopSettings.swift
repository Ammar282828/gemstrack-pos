import SwiftUI
import ERPCore

/// Settings → Shop (src/app/settings/page.tsx): the details printed on every invoice and order slip, the
/// shop's mode and style, and the next numbers. The counters are read here and never written from the
/// phone: moving them is for a change of system, in the ERP.
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
                VStack(alignment: .leading, spacing: 4) {
                    Text("Address").font(.subheadline).foregroundStyle(.secondary)
                    TextField("Address", text: $draft.address, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focus, equals: .address)
                }
            } header: {
                Text("Shop details")
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
                Text("Appearance")
            } footer: {
                Text("For every device that has not chosen its own, on the ERP’s web pages.")
            }

            Section {
                LabeledContent("Next invoice", value: Self.next("INV", settings.lastInvoiceNumber))
                LabeledContent("Next order", value: Self.next("ORD", settings.lastOrderNumber))
                LabeledContent("Next repair", value: Self.next("REP", settings.lastRepairNumber ?? 0))
                NavigationLink(value: Route(path: "/settings?web=1")) { Text("Change numbering") }
            } header: {
                Text("Document numbering")
            } footer: {
                Text("Changed only when moving from another system, in the ERP.")
            }

            SettingsErrorSection(writer: writer)
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
        let before = base
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
        Task {
            let ok = await writer.save(patch)
            // Not taken: what was typed stays, and the next time it is left it is sent again.
            if !ok { base = before }
        }
    }
}
