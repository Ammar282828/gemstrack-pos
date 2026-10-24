import SwiftUI
import ERPCore

/// Settings → Labels → Printer: how the shop's own tag (ERPCore `Zpl`) reaches a Zebra without Label LIVE, on this
/// device (`TagPrinter.method` / `.route`), and the printer options that travel with the tag (`layout.printer`: media,
/// darkness, speed, offsets, the same on every device, saved through `saveLabelLayout` by owners; staff read them).
///
/// - **Mac**: Zebra Browser Print (any Zebra it sees), a printer from the Mac's own list sent raw, or a network address.
/// - **iPhone**: the network address only. Label LIVE through the counter Mac is the other way.
struct TagPrinterSettingsScreen: View {
    static let path = "/app/tag-printer"

    private enum Way: String, CaseIterable, Identifiable {
        case browserPrint, system, network
        var id: String { rawValue }
        var title: String {
            switch self {
            case .browserPrint: return "Zebra Browser Print"
            case .system: return "A printer on this Mac"
            case .network: return "Network address"
            }
        }
    }

    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @Environment(\.accessibilityReduceMotion) private var reduce

    @State private var method = TagPrinter.method
    @State private var way: Way = .network
    @State private var deviceUID = ""
    @State private var queue = ""
    @State private var host = ""
    @State private var port = "9100"
    @State private var devices: [BrowserPrintDevice] = []
    @State private var queues: [String] = []
    @State private var looking = false
    @State private var testing = false
    @State private var checking = false
    @State private var statusLine: String?
    @State private var note: Note?
    @State private var problem: String?
    @State private var layout: LabelLayout?
    @State private var edited = false

    private var saved: LabelLayout { book.settings.value?.labelLayout ?? LabelLayout.standard }
    private var canEdit: Bool { session.isOwner }

    #if os(macOS)
    private let ways: [Way] = [.browserPrint, .system, .network]
    #else
    private let ways: [Way] = [.network]
    #endif

    var body: some View {
        Form { Group {
            methodSection
            if method == .zebra {
                waySection
                testSection
            }
            if let layout { printerSection(layout) }
        }
        .houseRows() }
        .houseForm()
        .navigationTitle("Printer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!edited)
                }
            }
        }
        .noteToast($note)
        .failureAlert($problem, title: "Not printed")
        .onAppear { book.settings.need(); load() }
        .onChange(of: book.settings.value?.labelLayout) { _, _ in if !edited { layout = saved } }
        .onChange(of: method) { _, m in TagPrinter.method = m }
        .onChange(of: way) { _, _ in storeRoute(); refresh() }
        .onChange(of: deviceUID) { _, _ in storeRoute() }
        .onChange(of: queue) { _, _ in storeRoute() }
        .onChange(of: host) { _, _ in storeRoute() }
        .onChange(of: port) { _, _ in storeRoute() }
        .task { refresh() }
    }

    // MARK: Print with

    private var methodSection: some View {
        Section {
            Picker("Print with", selection: $method) {
                Text("Label LIVE").tag(TagPrinter.Method.labelLive)
                Text("Zebra: the shop's tag").tag(TagPrinter.Method.zebra)
            }
            if method == .labelLive {
                NavigationLink(value: Route(path: LabelLiveSettingsScreen.path)) { Label("Label LIVE", systemImage: "printer") }
            }
        } header: {
            LedgerHeading(title: "Print with")
        } footer: {
            #if os(macOS)
            Text("Label LIVE prints its own design. The Zebra way draws the shop's tag (Settings → Labels) and sends it to any Zebra, as the ERP does in the browser. This applies to this Mac only.")
            #else
            Text("Label LIVE prints its own design through the Mac at the counter. The Zebra way draws the shop's tag and sends it to a Zebra on the network. This applies to this iPhone only.")
            #endif
        }
    }

    // MARK: The Zebra's way

    @ViewBuilder
    private var waySection: some View {
        Section {
            #if os(macOS)
            Picker("Zebra", selection: $way) {
                ForEach(ways) { Text($0.title).tag($0) }
            }
            #endif
            switch way {
            case .browserPrint: browserPrintRows
            case .system: systemRows
            case .network: networkRows
            }
        } header: {
            LedgerHeading(title: "The Zebra")
        } footer: {
            #if os(macOS)
            Text(wayFooter)
            #else
            Text("The Zebra's address is on its configuration label (hold Feed while it starts) or in its web page. Port 9100 is Zebra's raw port. To print without an address, use Label LIVE through the Mac at the counter.")
            #endif
        }
    }

    private var wayFooter: String {
        switch way {
        case .browserPrint: return "Zebra Browser Print is Zebra's free helper: install it on this Mac and it lists every Zebra (USB or network) it finds."
        case .system: return "A printer added in System Settings → Printers, sent the tag's ZPL as it is. A Zebra added as Generic or a ZPL queue works."
        case .network: return "The Zebra's address on the shop's network. Port 9100 is Zebra's raw port."
        }
    }

    #if os(macOS)
    @ViewBuilder
    private var browserPrintRows: some View {
        if devices.isEmpty {
            Text(looking ? "Looking…" : "Browser Print isn't answering, or sees no Zebra.").foregroundStyle(.secondary)
        } else {
            Picker("Printer", selection: $deviceUID) {
                Text("Browser Print's default").tag("")
                ForEach(devices) { d in
                    Text(d.connection.isEmpty ? d.name : "\(d.name) (\(d.connection))").tag(d.uid)
                }
            }
        }
        Button { refresh() } label: { Label(looking ? "Looking…" : "Refresh the list", systemImage: "arrow.clockwise") }
            .disabled(looking)
        Link(destination: URL(string: ZebraTransport.browserPrintDownload)!) { Label("Get Zebra Browser Print", systemImage: "arrow.down.circle") }
    }

    @ViewBuilder
    private var systemRows: some View {
        if queues.isEmpty {
            Text("This Mac has no printers yet. Add the Zebra in System Settings → Printers.").foregroundStyle(.secondary)
        } else {
            Picker("Printer", selection: $queue) {
                Text("Choose…").tag("")
                ForEach(queues, id: \.self) { Text($0).tag($0) }
            }
        }
        Button { refresh() } label: { Label("Refresh the list", systemImage: "arrow.clockwise") }
    }
    #else
    private var browserPrintRows: some View { EmptyView() }
    private var systemRows: some View { EmptyView() }
    #endif

    @ViewBuilder
    private var networkRows: some View {
        TextField("Address", text: $host, prompt: Text("192.168.1.50"))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
        TextField("Port", text: $port, prompt: Text("9100"))
            .keyboardType(.numberPad)
    }

    // MARK: Test and status

    private var testSection: some View {
        Section {
            Button { Task { await testPrint() } } label: {
                HStack(spacing: 8) {
                    if testing { ProgressView().controlSize(.small) }
                    Label(testing ? "Printing…" : "Test print", systemImage: "printer")
                }
            }
            .disabled(testing || currentRoute == nil)
            Button { Task { await checkStatus() } } label: {
                HStack(spacing: 8) {
                    if checking { ProgressView().controlSize(.small) }
                    Label("Check the printer", systemImage: "stethoscope")
                }
            }
            .disabled(checking || currentRoute == nil)
            if let statusLine {
                Text(statusLine).foregroundStyle(statusLine == "Ready." ? Color.secondary : Color.orange)
            }
        } footer: {
            Text("A small tag: the shop's name, today's date and a QR of TEST, on the tag's size and the printer options below.")
        }
    }

    private var currentRoute: TagPrinter.Route? {
        switch way {
        case .browserPrint: return .browserPrint(deviceUID: deviceUID.isEmpty ? nil : deviceUID)
        case .system: return queue.isEmpty ? nil : .systemQueue(name: queue)
        case .network:
            let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
            return h.isEmpty ? nil : .network(host: h, port: Int(port) ?? 9100)
        }
    }

    private func testPrint() async {
        guard let route = currentRoute else { return }
        testing = true
        let zpl = TagPrinter.testZpl(shopName: session.shop.name, layout: layout ?? saved)
        let outcome = await ZebraTransport.send(zpl, to: route)
        testing = false
        if outcome.ok { Note.show(Note(title: "Test tag sent", detail: outcome.message), in: $note, reduce: reduce) }
        else { problem = outcome.message }
    }

    private func checkStatus() async {
        guard let route = currentRoute else { return }
        checking = true
        statusLine = await ZebraTransport.status(route) ?? "The printer didn't say. A Mac printer can't be asked, and some Zebras answer only on the network."
        checking = false
    }

    // MARK: Remembering the way

    private func load() {
        if layout == nil { layout = saved }
        switch TagPrinter.route {
        case .browserPrint(let uid)?: way = ways.contains(.browserPrint) ? .browserPrint : .network; deviceUID = uid ?? ""
        case .systemQueue(let name)?: way = ways.contains(.system) ? .system : .network; queue = name
        case .network(let h, let p)?: way = .network; host = h; port = String(p)
        case nil: way = ways.first ?? .network
        }
    }

    private func storeRoute() {
        if let r = currentRoute { TagPrinter.route = r }
        else if way == .network { TagPrinter.route = nil }
    }

    private func refresh() {
        #if os(macOS)
        queues = ZebraTransport.systemQueues()
        guard way == .browserPrint, !looking else { return }
        looking = true
        Task {
            devices = await ZebraTransport.browserPrintDevices()
            looking = false
        }
        #endif
    }

    // MARK: The layout's printer options

    private func printerSection(_ l: LabelLayout) -> some View {
        let p = l.effectivePrinter
        return Group {
            Section {
                choice("Printing", \.thermal, [("transfer", "Thermal transfer (ribbon)"), ("direct", "Direct thermal")], p)
                choice("After each label", \.mode, [("tear", "Tear off"), ("peel", "Peel off"), ("cutter", "Cut"), ("rewind", "Rewind"), ("delayed-cut", "Delayed cut")], p)
                choice("Label stock", \.media, [("gap", "Labels with gaps"), ("mark", "Black mark"), ("continuous", "Continuous")], p)
            } header: {
                LedgerHeading(title: "Media")
            } footer: {
                Text(canEdit ? "\"The printer's own\" leaves the setting to the Zebra. Saved with the shop's tag, so every device prints the same." : "Only an owner changes these.")
            }
            Section {
                number("Darkness", \.darkness, 0...30, 15, p)
                number("Speed (inches a second)", \.speed, 2...14, 4, p)
            } header: {
                LedgerHeading(title: "Print quality")
            }
            Section {
                number("Label top", \.labelTop, -120...120, 0, p)
                number("Label shift", \.labelShift, -9999...9999, 0, p)
                number("Tear-off adjust", \.tearOff, -120...120, 0, p)
                number("Home x", \.homeX, 0...9999, 0, p)
                number("Home y", \.homeY, 0...9999, 0, p)
            } header: {
                LedgerHeading(title: "Position, in dots")
            }
            Section {
                choice("Orientation", \.orientation, [("normal", "Normal"), ("inverted", "Upside down")], p)
                Picker("Mirror", selection: Binding<String>(
                    get: { p.mirror == nil ? "" : (p.mirror == true ? "yes" : "no") },
                    set: { v in edit { $0.mirror = v.isEmpty ? nil : v == "yes" } })) {
                    Text("The printer's own").tag("")
                    Text("Off").tag("no")
                    Text("Mirrored").tag("yes")
                }
                .disabled(!canEdit)
            } header: {
                LedgerHeading(title: "Direction")
            }
        }
    }

    private func choice(_ title: String, _ key: WritableKeyPath<LabelPrinterSettings, String?>, _ options: [(String, String)], _ p: LabelPrinterSettings) -> some View {
        Picker(title, selection: Binding<String>(
            get: { p[keyPath: key] ?? "" },
            set: { v in edit { $0[keyPath: key] = v.isEmpty ? nil : v } })) {
            Text("The printer's own").tag("")
            ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
        }
        .disabled(!canEdit)
    }

    @ViewBuilder
    private func number(_ title: String, _ key: WritableKeyPath<LabelPrinterSettings, Int?>, _ range: ClosedRange<Int>, _ start: Int, _ p: LabelPrinterSettings) -> some View {
        if let value = p[keyPath: key] {
            HStack {
                Stepper(value: Binding(get: { value }, set: { v in edit { $0[keyPath: key] = v } }), in: range) {
                    LabeledContent(title, value: "\(value)")
                }
                if canEdit {
                    Button("Printer's own") { edit { $0[keyPath: key] = nil } }
                        .buttonStyle(.borderless).font(.footnote)
                }
            }
        } else {
            LabeledContent(title) {
                if canEdit { Button("Set") { edit { $0[keyPath: key] = start } }.buttonStyle(.borderless) }
                else { Text("The printer's own").foregroundStyle(.secondary) }
            }
        }
    }

    private func edit(_ change: (inout LabelPrinterSettings) -> Void) {
        guard canEdit, var next = layout else { return }
        var p = next.effectivePrinter
        change(&p)
        next.printer = p.isEmpty ? nil : p
        layout = next
        edited = true
    }

    private func save() {
        guard canEdit, let layout else { return }
        // `seq` makes each save its own, as the designer's does.
        Outbox.shared.send(op: LabelLayout.saveOp, fields: layout.saveFields(), label: "Label layout")
        edited = false
        Note.show(Note(title: "Printer settings saved"), in: $note, reduce: reduce)
    }
}
