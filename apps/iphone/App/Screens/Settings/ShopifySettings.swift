import SwiftUI
import ERPCore

/// Settings → Shopify. Where the store connection stands, which permissions the token holds, and a
/// selective, one-way import of Shopify orders into the ERP. Nothing here pushes ERP data out to Shopify.
/// The one action that writes to Shopify, registering webhooks, only touches webhook settings and asks first.
struct ShopifySettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Shopify") { ShopifyInnerForm() }
    }
}

/// GET /api/shopify/status. `configured` alone where the house has no SHOPIFY_STORE_DOMAIN; the store's
/// name, scopes and webhook counts only once the store has answered.
private struct ShopifyStatus: Decodable, Equatable {
    let configured: Bool
    let connected: Bool?
    let shop: String?
    let shopName: String?
    let scopes: [String]?
    let webhooksHere: Int?
    let webhooksTotal: Int?
    let lastSyncedAt: String?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case configured, connected, shop, shopName, scopes, webhooksHere, webhooksTotal, lastSyncedAt, error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        configured = c.bool(.configured, default: false)
        connected = c.bool(.connected)
        shop = c.string(.shop)
        shopName = c.string(.shopName)
        scopes = c.contains(.scopes) ? c.strings(.scopes) : nil
        webhooksHere = c.int(.webhooksHere)
        webhooksTotal = c.int(.webhooksTotal)
        lastSyncedAt = c.string(.lastSyncedAt)
        error = c.string(.error)
    }
}

private struct PullOrder: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let date: String
    let amount: Double
}

private struct ImportOutcome: Equatable {
    let requested: Int
    let imported: Int
    let errors: [String]
    let when: Date
}

private enum Busy: Equatable { case status, list, importing, webhooks }

private struct ScopeNeed: Identifiable {
    let resource: String
    let label: String
    var id: String { resource }
}

private let scopeNeeds: [ScopeNeed] = [
    .init(resource: "orders", label: "Orders"),
    .init(resource: "customers", label: "Customers"),
    .init(resource: "products", label: "Products"),
    .init(resource: "draft_orders", label: "Draft orders"),
]

private struct ShopifyInnerForm: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    @State private var status: ShopifyStatus?
    @State private var statusFailure: String?

    @State private var orders: [PullOrder]?
    @State private var since: Int?
    @State private var olderSkipped = 0
    @State private var listFailure: String?

    @State private var picked: Set<String> = []
    @State private var query = ""
    @State private var outcome: ImportOutcome?
    @State private var importFailure: String?
    @State private var webhookMessage: String?
    @State private var webhookFailure: String?

    @State private var busy: Set<Busy> = []
    @State private var confirmImport = false
    @State private var confirmWebhooks = false

    /// Writes are refused in the demo house; reads still work so the screen can be seen.
    private var isDemo: Bool { House.isDemo }
    private var writing: Bool { busy.contains(.importing) || busy.contains(.webhooks) }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        Form {
            Group {
                statusSection
                if let status, status.configured {
                    permissionsSection(status)
                    webhooksSection(status)
                    importSection
                }
            }
            .houseRows()
        }
        .navigationTitle("Shopify")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if !picked.isEmpty { importBar }
        }
        .failureAlert($importFailure, title: "Import failed")
        .failureAlert($webhookFailure, title: "Couldn't set up order notices")
        .task { await loadStatus(); if status?.configured == true { await loadOrders() } }
        .refreshable { await loadStatus(); if status?.configured == true { await loadOrders() } }
        // Back from Safari's reauthorize: the store's permissions may have changed.
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await loadStatus() } } }
        .confirmationDialog(importTitle, isPresented: $confirmImport, titleVisibility: .visible) {
            Button("Import \(picked.count) order\(picked.count == 1 ? "" : "s")") { Task { await runImport() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They become ERP invoices with their Shopify payments. Nothing is written back to Shopify.")
        }
        .confirmationDialog("Set up order notices on Shopify?", isPresented: $confirmWebhooks, titleVisibility: .visible) {
            Button("Set up order notices") { Task { await registerWebhooks() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This changes the store's notice settings so Shopify notifies the ERP of new and updated orders. It does not change orders, customers or products.")
        }
    }

    /// Where Shopify's sign-in opens: the phone's Safari, the Mac's own browser.
    static var browserName: String {
        #if os(macOS)
        "your browser"
        #else
        "Safari"
        #endif
    }

    // MARK: Status

    @ViewBuilder private var statusSection: some View {
        Section {
            if let status {
                LabeledContent("Status") {
                    Label(statusText(status), systemImage: statusIcon(status))
                        .foregroundStyle(statusTint(status))
                }
                if let name = status.shopName, !name.isEmpty { LabeledContent("Store") { Text(name).multilineTextAlignment(.trailing) } }
                if let shop = status.shop { LabeledContent("Domain") { Text(shop).multilineTextAlignment(.trailing).textSelection(.enabled) } }
                if status.configured {
                    LabeledContent("Last import", value: status.lastSyncedAt.map { ShopDate.say($0, withTime: true) } ?? "Not yet")
                }
                if let error = status.error, !error.isEmpty {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(Tone.owed.color)
                }
                if !status.configured {
                    Text("This house has no Shopify store set up.").font(.footnote).foregroundStyle(.secondary)
                }
                if let failure = statusFailure {
                    Text("Couldn't refresh: \(failure)").font(.footnote).foregroundStyle(.secondary)
                }
                if status.configured, let url = reauthorizeURL(status) {
                    Button { openURL(url) } label: {
                        Label(status.connected == true ? "Reconnect in \(Self.browserName)" : "Connect in \(Self.browserName)", systemImage: "safari")
                            .frame(maxWidth: .infinity, minHeight: Metrics.tap, alignment: .leading)
                    }
                    .disabled(isDemo || writing)
                }
            } else if let statusFailure {
                Text(statusFailure).font(.footnote).foregroundStyle(.secondary)
                retryButton("Check connection again", busyWith: .status) { await loadStatus() }
            } else {
                SkeletonLoading()
            }
            if status != nil {
                retryButton("Check connection", busyWith: .status) { await loadStatus() }
            }
        } header: {
            LedgerHeading(title: "Connection")
        }
    }

    private func statusText(_ s: ShopifyStatus) -> String {
        !s.configured ? "Not configured" : (s.connected == true ? "Connected" : "Needs attention")
    }
    private func statusIcon(_ s: ShopifyStatus) -> String {
        !s.configured ? "minus.circle" : (s.connected == true ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
    }
    private func statusTint(_ s: ShopifyStatus) -> Color {
        // Connected is the normal state: quiet. Only what needs attention is coloured (rule 15).
        !s.configured ? .secondary : (s.connected == true ? .secondary : Tone.owed.color)
    }

    /// /api/shopify/auth?shop=… (as the web's Re-authorize button). It sets its state cookie and sends the
    /// browser on to Shopify, and the callback checks that cookie, so the whole round trip happens in Safari.
    /// The route refuses anything but a *.myshopify.com domain, so nothing else is offered.
    private func reauthorizeURL(_ s: ShopifyStatus) -> URL? {
        guard let shop = s.shop?.trimmingCharacters(in: .whitespaces), shop.hasSuffix(".myshopify.com") else { return nil }
        let base = House.serverURL.appendingPathComponent("api/shopify/auth")
        guard var c = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = [URLQueryItem(name: "shop", value: shop)]
        return c.url
    }

    // MARK: Permissions

    /// As the web's card: write_X implies read_X, and read_all_orders covers read_orders.
    private func holds(_ scopes: Set<String>, _ scope: String) -> Bool {
        if scopes.contains(scope) { return true }
        guard scope.hasPrefix("read_") else { return false }
        let resource = scope.dropFirst(5)
        return scopes.contains("write_" + resource) || scopes.contains("read_all_" + resource)
    }

    @ViewBuilder private func permissionsSection(_ s: ShopifyStatus) -> some View {
        let held = Set(s.scopes ?? [])
        let required = scopeNeeds.flatMap { ["read_\($0.resource)", "write_\($0.resource)"] }
        let missing = required.filter { !holds(held, $0) }
        Section {
            if s.connected != true || s.scopes == nil {
                Text("Permissions are shown once the store answers.").font(.footnote).foregroundStyle(.secondary)
            } else {
                LabeledContent("Required") {
                    Label(missing.isEmpty ? "All granted" : "\(missing.count) missing",
                          systemImage: missing.isEmpty ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(missing.isEmpty ? Color.secondary : Tone.owed.color)
                }
                DisclosureGroup("Permissions") {
                    ForEach(scopeNeeds) { need in
                        let r = holds(held, "read_\(need.resource)")
                        let w = holds(held, "write_\(need.resource)")
                        VStack(alignment: .leading, spacing: pt(4)) {
                            Text(need.label).font(.subheadline.weight(.semibold))
                            HStack(spacing: pt(12)) {
                                scopeChip("Read", r)
                                scopeChip("Write", w)
                            }
                        }
                        .frame(minHeight: Metrics.tap, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                    let extra = held.subtracting(required).sorted()
                    if !extra.isEmpty {
                        VStack(alignment: .leading, spacing: pt(4)) {
                            Text("Also granted").font(.subheadline.weight(.semibold))
                            Text(extra.joined(separator: ", ")).font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, pt(4))
                    }
                }
                .frame(minHeight: Metrics.tap)
                if !missing.isEmpty {
                    Text("Reconnect in Safari to allow: \(missing.joined(separator: ", ")).")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            LedgerHeading(title: "Permissions")
        } footer: {
            Text("Write access includes read access.")
        }
    }

    private func scopeChip(_ title: String, _ ok: Bool) -> some View {
        Label(title, systemImage: ok ? "checkmark.circle.fill" : "xmark.circle")
            .font(.footnote)
            .foregroundStyle(ok ? Color.secondary : Tone.problem.color)
            .accessibilityLabel("\(title) \(ok ? "granted" : "missing")")
    }

    // MARK: Webhooks

    @ViewBuilder private func webhooksSection(_ s: ShopifyStatus) -> some View {
        Section {
            if s.connected == true {
                LabeledContent("Pointing at this ERP", value: s.webhooksHere.map(String.init) ?? "Unknown")
                LabeledContent("On the store in all", value: s.webhooksTotal.map(String.init) ?? "Unknown")
                if s.webhooksHere == 0 {
                    Text("No order notices point at this ERP, so new Shopify orders won't arrive by themselves.")
                        .font(.footnote).foregroundStyle(Tone.owed.color)
                }
            }
            if let webhookMessage { Label(webhookMessage, systemImage: "checkmark.circle").font(.footnote).foregroundStyle(Tone.settled.color) }
            Button { confirmWebhooks = true } label: {
                HStack {
                    Label("Set up order notices", systemImage: "antenna.radiowaves.left.and.right")
                    Spacer()
                    if busy.contains(.webhooks) { ProgressView().controlSize(.small) }
                }
                .frame(maxWidth: .infinity, minHeight: Metrics.tap)
            }
            .disabled(isDemo || writing || s.connected != true)
        } header: {
            LedgerHeading(title: "Order notices")
        } footer: {
            Text(isDemo ? "Not available in the demo." : "Order notices let Shopify tell the ERP about orders as they happen.")
        }
    }

    // MARK: Import

    private var visible: [PullOrder] {
        let list = orders ?? []
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return list }
        return list.filter { $0.title.lowercased().contains(needle) || $0.subtitle.lowercased().contains(needle) }
    }
    private var pickedOrders: [PullOrder] { (orders ?? []).filter { picked.contains($0.id) } }
    private var pickedTotal: Double { pickedOrders.reduce(0) { $0 + $1.amount } }
    private var allVisibleOn: Bool { !visible.isEmpty && visible.allSatisfy { picked.contains($0.id) } }
    private var importTitle: String {
        "Import \(picked.count) order\(picked.count == 1 ? "" : "s") · \(money(pickedTotal))?"
    }

    private func money(_ v: Double) -> String { PaymentText.pkr(v) }

    @ViewBuilder private var importSection: some View {
        Section {
            if let outcome { outcomeView(outcome) }
            if let orders {
                if let listFailure {
                    Text("Couldn't refresh the list: \(listFailure)").font(.footnote).foregroundStyle(.secondary)
                }
                if olderSkipped > 0, let since {
                    Text("\(olderSkipped) older order\(olderSkipped == 1 ? "" : "s") at or below #\(since) \(olderSkipped == 1 ? "is" : "are") not offered; \(olderSkipped == 1 ? "it predates" : "they predate") the ERP.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if orders.isEmpty {
                    Label("Every Shopify order after #\(since.map(String.init) ?? "the cutoff") is already in the ERP.", systemImage: "checkmark.circle")
                        .foregroundStyle(Tone.settled.color)
                } else {
                    TextField("Filter by order number or customer", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .frame(minHeight: Metrics.tap)
                    HStack {
                        Button(allVisibleOn ? "Clear all \(visible.count)" : "Select all \(visible.count)") { toggleAllVisible() }
                            .disabled(visible.isEmpty || writing)
                            .frame(minHeight: Metrics.tap)
                        Spacer()
                        Text("\(orders.count) not imported").font(.footnote).foregroundStyle(.secondary)
                    }
                    if visible.isEmpty {
                        Text("Nothing matches that search.").foregroundStyle(.secondary)
                    }
                    ForEach(visible) { row($0) }
                }
            } else if let listFailure {
                Text(listFailure).font(.footnote).foregroundStyle(.secondary)
            } else {
                SkeletonLoading()
            }
            retryButton(orders == nil ? "Check for new orders" : "Re-check", busyWith: .list) { await loadOrders() }
        } header: {
            LedgerHeading(title: "Import orders")
        } footer: {
            Text("Shopify orders that aren't in the ERP yet. Import is one way: nothing is written back to Shopify.")
        }

        if !(orders ?? []).isEmpty || !picked.isEmpty {
            Section {
                if !picked.isEmpty {
                    LabeledContent("Selected", value: "\(picked.count)")
                    LabeledContent("Total", value: money(pickedTotal))
                    let hidden = pickedOrders.filter { o in !visible.contains(where: { $0.id == o.id }) }.count
                    if hidden > 0 {
                        Text("\(hidden) selected order\(hidden == 1 ? " is" : "s are") hidden by the filter and will still be imported.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("Review selection") {
                        ForEach(pickedOrders) { o in
                            HStack(alignment: .firstTextBaseline) {
                                Text(o.title).font(.subheadline.monospaced())
                                Spacer()
                                Text(money(o.amount)).font(.subheadline).monospacedDigit()
                            }
                            .frame(minHeight: Metrics.tap)
                        }
                    }
                    .frame(minHeight: Metrics.tap)
                }
                if !picked.isEmpty {
                    Button("Clear selection") { picked = [] }
                        .disabled(writing)
                        .frame(minHeight: Metrics.tap)
                }
            } footer: {
                if isDemo { Text("Importing is not available in the demo.") }
            }
        }
    }

    /// The one action, pinned at the foot while orders are chosen; it asks first.
    private var importBar: some View {
        ActionBar(
            primary: .init("Import \(picked.count) order\(picked.count == 1 ? "" : "s")", systemImage: "square.and.arrow.down",
                           isBusy: busy.contains(.importing),
                           isDisabled: isDemo || writing || busy.contains(.list)) { confirmImport = true },
            summary: money(pickedTotal)
        )
    }

    private func row(_ o: PullOrder) -> some View {
        let on = picked.contains(o.id)
        return Button { toggle(o.id) } label: {
            HStack(alignment: .top, spacing: pt(12)) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(on ? Theme.accent : .secondary)
                    .imageScale(.large)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(o.title).font(.body.monospaced().weight(.medium))
                        Spacer(minLength: 8)
                        if o.amount > 0 { Text(money(o.amount)).font(.subheadline).monospacedDigit() }
                    }
                    if !o.subtitle.isEmpty {
                        Text(o.subtitle).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if !o.date.isEmpty {
                        Text(ShopDate.say(o.date, withTime: false)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.tap, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(writing)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func outcomeView(_ r: ImportOutcome) -> some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Label("Imported \(r.imported) of \(r.requested) order\(r.requested == 1 ? "" : "s")",
                  systemImage: r.errors.isEmpty && r.imported == r.requested ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(r.errors.isEmpty && r.imported == r.requested ? Tone.settled.color : Tone.owed.color)
            Text(r.when.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(.secondary)
            if !r.errors.isEmpty {
                Text("\(r.errors.count) problem\(r.errors.count == 1 ? "" : "s"):").font(.footnote.weight(.semibold))
                ForEach(Array(r.errors.enumerated()), id: \.offset) { _, e in
                    Text("• " + e).font(.footnote).foregroundStyle(Tone.problem.color).fixedSize(horizontal: false, vertical: true)
                }
            }
            Button("Dismiss") { outcome = nil }.font(.footnote).frame(minHeight: Metrics.tap)
        }
    }

    private func retryButton(_ title: String, busyWith kind: Busy, _ action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack {
                Label(title, systemImage: "arrow.clockwise")
                Spacer()
                if busy.contains(kind) { ProgressView().controlSize(.small) }
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.tap)
        }
        .disabled(busy.contains(kind) || writing)
    }

    private func toggle(_ id: String) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }
    private func toggleAllVisible() {
        let on = allVisibleOn
        for o in visible { if on { picked.remove(o.id) } else { picked.insert(o.id) } }
    }

    // MARK: Network

    private func loadStatus() async {
        guard !busy.contains(.status) else { return }
        busy.insert(.status); defer { busy.remove(.status) }
        do {
            status = try await ERPAPI.shared.get("/api/shopify/status", as: ShopifyStatus.self)
            statusFailure = nil
        } catch { statusFailure = error.localizedDescription }
    }

    private func loadOrders() async {
        guard !busy.contains(.list) else { return }
        busy.insert(.list); defer { busy.remove(.list) }
        do {
            let v = try await MarketingRequest.get("/api/shopify/pull")
            if v["error"] != .null, !v.s("error").isEmpty { throw ERPAPI.Failure(status: 0, message: v.s("error")) }
            // The route sends each id as a string (String(o.id)); a number is read too, never rounded through Int.
            let list = v["orders"].array.map { o in
                let raw = o["id"]
                let id = raw.string.isEmpty ? (raw == .null ? "" : raw.number.formatted(.number.grouping(.never).precision(.fractionLength(0)))) : raw.string
                return PullOrder(id: id, title: o.s("title"), subtitle: o.s("subtitle"), date: o.s("date"), amount: o.n("amount"))
            }.filter { !$0.id.isEmpty && $0.id != "0" }
            orders = list
            since = v["since"] == .null ? nil : Int(v.n("since"))
            olderSkipped = Int(v.n("olderSkipped"))
            let ids = Set(list.map(\.id))
            picked = picked.intersection(ids)
            listFailure = nil
        } catch {
            // Keep the previous list; only report the failure.
            listFailure = error.localizedDescription
        }
    }

    private func runImport() async {
        guard !isDemo, !writing, !picked.isEmpty else { return }
        let ids = Array(picked)
        busy.insert(.importing); defer { busy.remove(.importing) }
        importFailure = nil
        do {
            // POST { orderIds } → { success, imported: { orders, customers, products }, errors: [string] }.
            // A refusal (not an owner, nothing selected, not connected) is a 4xx and throws in ERPAPI.
            let v = try await MarketingRequest.send("/api/shopify/pull", ["orderIds": ids])
            if !v["success"].bool, !v.s("error").isEmpty { throw ERPAPI.Failure(status: 0, message: v.s("error")) }
            let errors = v["errors"].array.map { $0.string.isEmpty ? $0.text : $0.string }
            outcome = ImportOutcome(requested: ids.count, imported: Int(v["imported"].n("orders")), errors: errors, when: .now)
            picked.subtract(ids)
        } catch {
            importFailure = error.localizedDescription
        }
        busy.remove(.importing)
        await loadOrders()
        await loadStatus()
    }

    private func registerWebhooks() async {
        guard !isDemo, !writing else { return }
        busy.insert(.webhooks); defer { busy.remove(.webhooks) }
        webhookMessage = nil; webhookFailure = nil
        do {
            // POST → { success, registered: [topic], skipped: [topic] } (orders/create and orders/updated).
            let v = try await MarketingRequest.send("/api/shopify/register-webhooks")
            if !v.s("error").isEmpty { throw ERPAPI.Failure(status: 0, message: v.s("error")) }
            let registered = v["registered"].array.map(\.string).filter { !$0.isEmpty }
            let skipped = v["skipped"].array.map(\.string).filter { !$0.isEmpty }
            if registered.isEmpty && skipped.isEmpty {
                webhookMessage = "Shopify answered; nothing to register."
            } else {
                var parts: [String] = []
                if !registered.isEmpty { parts.append("Set up \(registered.joined(separator: ", "))") }
                if !skipped.isEmpty { parts.append("already there: \(skipped.joined(separator: ", "))") }
                webhookMessage = parts.joined(separator: "; ") + "."
            }
        } catch { webhookFailure = error.localizedDescription }
        busy.remove(.webhooks)
        await loadStatus()
    }
}

#if os(macOS)
extension ShopifyInnerForm {
    /// Shopify on the Mac: the connection, permissions and order notices as grouped sections, and the orders to import as a
    /// multi-select table (Select all with ⌘A, the footer's Import button asks first).
    @ViewBuilder
    fileprivate var macBody: some View {
        Form {
            statusSection
            if let status, status.configured {
                permissionsSection(status)
                webhooksSection(status)
                macImportSection
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Shopify")
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !picked.isEmpty {
                MacActionFooter(
                    primary: .init("Import \(picked.count) order\(picked.count == 1 ? "" : "s")", systemImage: "square.and.arrow.down",
                                   isBusy: busy.contains(.importing),
                                   isDisabled: isDemo || writing || busy.contains(.list)) { confirmImport = true },
                    secondary: [.init("Clear selection", isDisabled: writing) { picked = [] }],
                    summary: "\(picked.count) selected · \(money(pickedTotal))")
            }
        }
        .failureAlert($importFailure, title: "Import failed")
        .failureAlert($webhookFailure, title: "Couldn't set up order notices")
        .task { await loadStatus(); if status?.configured == true { await loadOrders() } }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await loadStatus() } } }
        .confirmationDialog(importTitle, isPresented: $confirmImport, titleVisibility: .visible) {
            Button("Import \(picked.count) order\(picked.count == 1 ? "" : "s")") { Task { await runImport() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They become ERP invoices with their Shopify payments. Nothing is written back to Shopify.")
        }
        .confirmationDialog("Set up order notices on Shopify?", isPresented: $confirmWebhooks, titleVisibility: .visible) {
            Button("Set up order notices") { Task { await registerWebhooks() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This changes the store's notice settings so Shopify notifies the ERP of new and updated orders. It does not change orders, customers or products.")
        }
    }

    @ViewBuilder fileprivate var macImportSection: some View {
        Section {
            if let outcome { outcomeView(outcome) }
            if let orders {
                if let listFailure {
                    Text("Couldn't refresh the list: \(listFailure)").font(.footnote).foregroundStyle(.secondary)
                }
                if olderSkipped > 0, let since {
                    Text("\(olderSkipped) older order\(olderSkipped == 1 ? "" : "s") at or below #\(since) \(olderSkipped == 1 ? "is" : "are") not offered; \(olderSkipped == 1 ? "it predates" : "they predate") the ERP.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if orders.isEmpty {
                    Label("Every Shopify order after #\(since.map(String.init) ?? "the cutoff") is already in the ERP.", systemImage: "checkmark.circle")
                        .foregroundStyle(Tone.settled.color)
                } else {
                    TextField("Filter by order number or customer", text: $query)
                        .autocorrectionDisabled()
                    Table(visible, selection: $picked) {
                        TableColumn("Order") { (o: PullOrder) in Text(o.title).font(.body.monospaced().weight(.medium)) }
                        TableColumn("Customer") { (o: PullOrder) in Text(o.subtitle).foregroundStyle(.secondary).lineLimit(1) }
                        TableColumn("Date") { (o: PullOrder) in
                            Text(o.date.isEmpty ? "" : ShopDate.say(o.date, withTime: false)).foregroundStyle(.secondary)
                        }
                        TableColumn("Amount") { (o: PullOrder) in
                            Text(o.amount > 0 ? money(o.amount) : "").monospacedDigit()
                        }
                    }
                    .frame(minHeight: 280)
                    .disabled(writing)
                    HStack {
                        Button(allVisibleOn ? "Clear all \(visible.count)" : "Select all \(visible.count)") { toggleAllVisible() }
                            .disabled(visible.isEmpty || writing)
                        Spacer()
                        Text("\(orders.count) not imported").font(.footnote).foregroundStyle(.secondary)
                    }
                    let hidden = pickedOrders.filter { o in !visible.contains(where: { $0.id == o.id }) }.count
                    if hidden > 0 {
                        Text("\(hidden) selected order\(hidden == 1 ? " is" : "s are") hidden by the filter and will still be imported.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            } else if let listFailure {
                Text(listFailure).font(.footnote).foregroundStyle(.secondary)
            } else {
                SkeletonLoading()
            }
            Button(orders == nil ? "Check for new orders" : "Re-check") { Task { await loadOrders() } }
                .disabled(busy.contains(.list) || writing)
        } header: {
            Text("Import orders")
        } footer: {
            Text(isDemo ? "Importing is not available in the demo. " : "Shopify orders that aren't in the ERP yet. Import is one way: nothing is written back to Shopify.")
        }
    }
}
#endif
