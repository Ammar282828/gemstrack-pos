import SwiftUI
import ERPCore

/// Settings → Labels → Label LIVE (the web's label-live-card.tsx, docs/features/label-live.md): the link Label LIVE's
/// Integrate → Copy URL gives for the design is pasted once; its design, printer, copies and variable names are read
/// from it (ERPCore `LabelLive.parseIntegrateURL`), each variable is paired with a piece's field, and the whole is
/// saved in the shop's settings (`labelLive`, through /api/app/write `updateSettings`, the web card's shape), so every
/// device prints the same tag. A test print, how this device reaches Label LIVE, and what it printed lately.
struct LabelLiveSettingsScreen: View {
    static let path = "/app/label-live"

    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var config: LabelLiveConfig?
    @State private var pasted = ""
    @State private var writer = SettingsWriter()
    @State private var saving = false
    @State private var testing = false
    @State private var note: Note?
    @State private var problem: String?
    @State private var counterHost = LabelLivePrinter.counterHost
    @State private var history = LabelPrintHistory.all
    @State private var confirmingClear = false

    private var saved: LabelLiveConfig? { book.settings.value?.labelLiveConfig }
    private var changed: Bool { config != nil && config != saved }

    var body: some View {
        Form { Group {
            linkSection
            if let config {
                designSection(config)
                pairingSection(config)
            }
            deviceSection
            if !history.isEmpty { historySection }
        }
        .houseRows() }
        .houseForm()
        .navigationTitle("Label LIVE")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if session.isOwner {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(!changed || saving || config?.design.trimmingCharacters(in: .whitespaces).isEmpty != false)
                }
            }
        }
        .noteToast($note)
        .failureAlert($problem, title: "Not done")
        .confirmDestructive(isPresented: $confirmingClear, title: "Clear the print history?",
                            message: "Only this device's list of printed tags goes; nothing is printed or changed in the ERP.",
                            action: "Clear") {
            LabelPrintHistory.clear()
            history = []
        }
        .onAppear { book.settings.need(); book.products.need() }
        .onChange(of: saved) { _, next in if config == nil || !changed { config = next } }
        .task { if config == nil { config = saved } }
    }

    // MARK: The link

    private var linkSection: some View {
        Section {
            TextField("labellive://print?design=…", text: $pasted, axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.callout.monospaced())
                .disabled(!session.isOwner)
            Button("Read the link") { read() }
                .disabled(pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !session.isOwner)
        } header: {
            LedgerHeading(title: "The design's link")
        } footer: {
            Text("In Label LIVE, open the tag's design, then Data → Integrate → Copy URL, and paste it here. The design must be pinned to Label LIVE's Home screen.")
        }
    }

    private func read() {
        guard let parsed = LabelLive.parseIntegrateURL(pasted) else {
            problem = "That isn't a Label LIVE link. Copy it from the design's Data → Integrate."
            return
        }
        config = LabelLive.configFromIntegrate(parsed, previous: config ?? saved)
        pasted = ""
        Note.show(Note(title: "Read \(parsed.variables.count) variable\(parsed.variables.count == 1 ? "" : "s") from \(parsed.design)"), in: $note, reduce: reduce)
    }

    // MARK: The design

    private func designSection(_ c: LabelLiveConfig) -> some View {
        Section {
            LabeledContent("Design", value: c.design)
            printerField(c)
            Stepper(value: binding(\.copies), in: 1...99) {
                LabeledContent("Copies", value: "\(c.copies)")
            }
            .disabled(!session.isOwner)
            Toggle("Print without showing Label LIVE", isOn: binding(\.hideWindow))
                .disabled(!session.isOwner)
            let tags = LabelLive.tagsOf(c).count
            if tags > 1 {
                Text("\(tags) tags to a label: pieces fill them in turn, and a tag with no piece prints blank.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Button {
                Task { await testPrint() }
            } label: {
                Label(testing ? "Printing…" : "Test print", systemImage: "printer")
            }
            .disabled(testing || changed)
        } header: {
            LedgerHeading(title: "Design")
        } footer: {
            if changed { Text("Save first: a test prints what is saved, as every device will.") }
        }
    }

    @ViewBuilder
    private func printerField(_ c: LabelLiveConfig) -> some View {
        #if os(macOS)
        // Label LIVE names a Mac's printers "System-<name>"; the one in the link is kept even if this Mac lacks it.
        let choices = Array(Set(LabelLivePrinter.systemPrinters + [c.printer].filter { !$0.isEmpty })).sorted()
        Picker("Printer", selection: binding(\.printer)) {
            Text("The design's last").tag("")
            ForEach(choices, id: \.self) { Text($0.hasPrefix("System-") ? String($0.dropFirst(7)) : $0).tag($0) }
        }
        .disabled(!session.isOwner)
        #else
        LabeledContent("Printer", value: c.printer.isEmpty ? "The design's last" : c.printer)
        #endif
    }

    // MARK: The pairings

    private func pairingSection(_ c: LabelLiveConfig) -> some View {
        Section {
            ForEach(c.map.vars, id: \.name) { v in
                Picker(v.name, selection: Binding(
                    get: { v.field },
                    set: { field in config?.map[v.name] = field })) {
                    Text("Nothing (blank)").tag("")
                    Section("Piece") {
                        ForEach(LabelLive.labelFields, id: \.key) { Text($0.label).tag($0.key) }
                    }
                    Section("Tag CSV columns") {
                        ForEach(LabelLive.csvFields, id: \.key) { Text($0.label).tag($0.key) }
                    }
                }
                .disabled(!session.isOwner)
            }
        } header: {
            LedgerHeading(title: "Variables")
        } footer: {
            Text("Each of the design's variables gets one of a piece's fields. A variable named after a tag CSV column gets exactly what the CSV writes.")
        }
    }

    private func binding<V>(_ key: WritableKeyPath<LabelLiveConfig, V>) -> Binding<V> {
        Binding(get: { config![keyPath: key] }, set: { config?[keyPath: key] = $0 })
    }

    // MARK: This device

    private var deviceSection: some View {
        Section {
            TextField("Mac at the counter (e.g. counter-mac.local)", text: $counterHost)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .onSubmit { LabelLivePrinter.counterHost = counterHost }
                .onChange(of: counterHost) { _, v in LabelLivePrinter.counterHost = v }
        } header: {
            LedgerHeading(title: "This device")
        } footer: {
            #if os(macOS)
            Text("Leave empty when Label LIVE runs on this Mac: tags go to it directly. Name another Mac to print through its Label LIVE instead (MQTT switched on in its settings, on the same network).")
            #else
            Text("Label LIVE has no iPhone app: tags go to it on the Mac at the counter. On that Mac, switch on MQTT in Label LIVE's settings; this phone must be on the same Wi-Fi. Find the Mac's name in its System Settings → General → Sharing (ends in .local).")
            #endif
        }
    }

    private var historySection: some View {
        Section {
            ForEach(history.prefix(20)) { e in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.sku).font(.body.monospaced())
                        Text(e.message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(ShopDate.say(e.timestamp)).font(.caption).foregroundStyle(.secondary)
                        if !e.ok { Pill("Not printed", tone: .problem) }
                    }
                }
            }
            Button("Clear the history", role: .destructive) { confirmingClear = true }
        } header: {
            LedgerHeading(title: "Printed on this device")
        }
    }

    // MARK: Saving and testing

    private func save() async {
        guard let config else { return }
        saving = true
        defer { saving = false }
        let stored = LabelLive.toStored(config)
        let patch: [String: Any] = ["labelLive": [
            "design": stored.design, "printer": stored.printer, "copies": Int(stored.copies), "hideWindow": stored.hideWindow,
            "vars": stored.vars.map { ["name": $0.name, "field": $0.field] },
        ]]
        if await writer.save(patch) {
            Note.show(Note(title: "Label LIVE saved"), in: $note, reduce: reduce)
        } else {
            problem = writer.error ?? "Not saved. Check the connection and try again."
        }
    }

    /// The newest piece in stock, or made-up values when the stock is empty: what the saved set-up prints.
    private func testPrint() async {
        guard let saved, let settings = book.settings.value else { return }
        testing = true
        defer { testing = false }
        let outcome: LabelLivePrinter.Outcome
        if let piece = book.products.items.last {
            outcome = await LabelLivePrinter.print(pieces: [piece], settings: settings, config: saved, copies: 1)
        } else {
            let sample: LabelValues = ["sku": "TEST-0001", "name": "Test tag", "price": "Rs 0", "qr": "TEST-0001"]
            outcome = await LabelLivePrinter.send(LabelLive.printURL(saved, [sample], copies: 1))
        }
        history = LabelPrintHistory.all
        if outcome.ok { Note.show(Note(title: outcome.message), in: $note, reduce: reduce) } else { problem = outcome.message }
    }
}
