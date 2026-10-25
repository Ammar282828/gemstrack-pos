import SwiftUI
import ERPCore

/// Online orders (/orders/online): the web Orders page's "Online — to confirm" inbox (components/order/
/// online-inbox.tsx), which Home's "online orders to confirm" opens. Every order from the website waits here
/// until a person looks at it (docs/decisions.md "Online orders"): each with its pieces, photographs and sizes,
/// who and where, and what the same pieces cost at today's rate, so whoever confirms knows how far gold has
/// moved. Confirm writes the ORD- order and starts the price hold; Decline sends the reason. Both tell the
/// customer on WhatsApp, so each asks first with the words that go (OnlineConfirmSheet, OnlineDeclineSheet).
/// Under them, the last fortnight's: a confirmed one opens its order, where the transfer is checked.
struct OnlineOrdersScreen: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var confirming: OnlineOrderRow?
    @State private var declining: OnlineOrderRow?
    /// What a decline said of the customer's WhatsApp, as the toast.
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var go: Route?
    #if os(macOS)
    /// The order picked in the Mac's list (an online order's number).
    @State private var picked: String?
    @Environment(\.openPlaceWindow) private var openPlaceWindow
    #endif

    private var store: OnlineOrdersStore { OnlineOrdersStore.shared }
    /// The accounts the server lets act on online orders (lib/website/staff-gate.ts): marketing is refused.
    private var mayAct: Bool { session.role == "owner" || session.role == "staff" }
    private var asks: Bool { session.shop.websiteSelling && mayAct }

    var body: some View {
        content
            .navigationTitle("Online orders")
            .hubTitleDisplay()
            #if os(macOS)
            .navigationDestination(item: macGoPushed) { (r: Route) in PlaceScreen(path: r.path) }
            .onChange(of: go) { _, r in macOpenGo(r) }
            #else
            .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
            #endif
            .sheet(item: $confirming) { (r: OnlineOrderRow) in
                OnlineConfirmSheet(row: r) { orderId in go = Route(path: "/orders/\(orderId)") }
            }
            .sheet(item: $declining) { (r: OnlineOrderRow) in
                OnlineDeclineSheet(row: r) { t in
                    Note.show(Note(title: t.words, failed: !t.ok), in: $note, reduce: reduceMotion)
                }
            }
            .noteToast($note)
            .refreshable { if asks { await store.load() } }
            .task { if asks { await store.load() } }
            // A new one placed while the screen is open: the app's two-minute count sees it first (OnlineInbox).
            .onChange(of: OnlineInbox.shared.waiting) { _, _ in
                if asks { Task { await store.load() } }
            }
    }

    @ViewBuilder
    private var content: some View {
        if !session.shop.websiteSelling {
            ContentUnavailableView("No online orders here", systemImage: "globe",
                                   description: Text("This house's website takes no orders."))
        } else if !mayAct {
            ContentUnavailableView("Owners and staff only", systemImage: "lock",
                                   description: Text("Only owner and staff accounts can act on online orders."))
        } else {
            switch store.phase {
            case .idle, .loading:
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ErrorState(message) { Task { await store.load() } }
            case .loaded:
                #if os(macOS)
                macList
                #else
                list
                #endif
            }
        }
    }

    // MARK: The list

    private var list: some View {
        let waiting = store.waiting
        let lately = store.lately
        return List {
            Group {
                if waiting.isEmpty && !lately.isEmpty {
                    Section {
                        Label("Nothing to confirm", systemImage: "checkmark.seal").foregroundStyle(.secondary)
                    }
                }
                ForEach(waiting) { (r: OnlineOrderRow) in waitingSection(r) }
                if !lately.isEmpty {
                    Section {
                        ForEach(lately) { (r: OnlineOrderRow) in latelyRow(r) }
                    } header: {
                        LedgerHeading(title: "The last two weeks")
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if waiting.isEmpty && lately.isEmpty {
                EmptyState("Nothing to confirm", symbol: "checkmark.seal",
                           message: "Nothing is in the book, and nobody has the bank details, until you confirm.")
            }
        }
        .motion(waiting.map(\.id))
    }

    // MARK: One waiting

    @ViewBuilder
    private func waitingSection(_ r: OnlineOrderRow) -> some View {
        Section {
            whoRow(r)
            ForEach(Array(r.lines.enumerated()), id: \.offset) { pair in lineRow(pair.element) }
            customerRows(r)
            if let moved = OnlineOrdersLogic.movedLine(r) {
                let dearer = (OnlineOrdersLogic.moved(r)?.amount ?? 0) > 0
                Label(moved, systemImage: "chart.line.uptrend.xyaxis")
                    .font(.footnote)
                    .foregroundStyle(dearer ? Tone.owed.color : Color.secondary)
            }
            actionsRow(r)
        }
    }

    /// Who it is from first (the section says Online already); the number the customer quotes and how long ago
    /// are the quiet line, and the total sits at the right.
    private func whoRow(_ r: OnlineOrderRow) -> some View {
        HStack(alignment: .top, spacing: pt(12)) {
            Monogram(name: r.customer.name, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 3) {
                Text(r.customer.name.isEmpty ? "Customer" : r.customer.name)
                    .font(.headline)
                    .lineLimit(2)
                Text(["Online", r.id, OnlineOrdersLogic.ago(r.placedAt)].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                RowAmount(amount: r.grandTotal)
                Text(r.deliveryCharge > 0 ? "incl. \(Money.pkr(r.deliveryCharge)) delivery" : "free delivery")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .layoutPriority(1)
        }
        .accessibilityElement(children: .combine)
    }

    private func lineRow(_ l: OnlineOrderLine) -> some View {
        HStack(spacing: pt(12)) {
            StockImage(imageUrl: l.image, name: l.description, key: l.key)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(OnlineOrdersLogic.pieceName(l.description))
                    .font(.subheadline)
                    .lineLimit(2)
                if let size = l.size {
                    Text("Size \(size)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Tone.owed.color)
                }
            }
            Spacer(minLength: 8)
            Text(Money.pkr(l.price))
                .font(.subheadline)
                .monospacedDigit()
        }
    }

    @ViewBuilder
    private func customerRows(_ r: OnlineOrderRow) -> some View {
        if let call = OnlineOrdersLogic.callURL(r.customer.phone) {
            Button { openURL(call) } label: {
                Label(r.customer.phone, systemImage: "phone")
            }
        }
        if let chat = OnlineOrdersLogic.chatURL(r.customer.phone) {
            Button { openURL(chat) } label: {
                Label("WhatsApp", systemImage: "message")
            }
        }
        VStack(alignment: .leading, spacing: 2) {
            Label {
                Text([r.delivery.address, r.delivery.city].filter { !$0.isEmpty }.joined(separator: ", "))
            } icon: {
                Image(systemName: "mappin.and.ellipse")
            }
            .font(.subheadline)
            if let notes = r.delivery.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                Text("“\(notes)”")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func actionsRow(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirming" {
            // Someone pressed Confirm a moment ago; the server holds it for them for two minutes.
            HStack(spacing: pt(8)) {
                ProgressView().controlSize(.small)
                Text("Being confirmed" + (OnlineOrdersLogic.who(r.claimedBy).map { " by \($0)" } ?? "") + "\u{2026}")
                    .foregroundStyle(.secondary)
            }
        } else {
            // Each button its own row, so its tap is its own: two buttons in one List row fire together.
            decisionButtons(r)
        }
    }

    @ViewBuilder
    private func decisionButtons(_ r: OnlineOrderRow) -> some View {
        // Inside a row: tinted and bordered, never glass (rule 16).
        Button { confirming = r } label: {
            Label("Confirm", systemImage: "checkmark")
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.accent)
        .largeOnPhone()
        Button(role: .destructive) { declining = r } label: {
            Label("Decline", systemImage: "xmark")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .largeOnPhone()
    }

    // MARK: The last fortnight's

    @ViewBuilder
    private func latelyRow(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirmed", let orderId = r.orderId, !orderId.isEmpty {
            NavigationLink(value: Route(path: "/orders/\(orderId)")) {
                TwoLine(title: "\(r.id) · \(orderId)", subtitle: confirmedLine(r), trailing: Money.pkr(r.grandTotal))
            }
        } else if r.state == "declined" {
            TwoLine(title: "\(r.id) · declined",
                    subtitle: [r.customer.name, r.declineReason ?? ""].filter { !$0.isEmpty }.joined(separator: " · "),
                    trailing: Money.pkr(r.grandTotal),
                    trailingTint: .secondary)
        } else {
            TwoLine(title: r.id, subtitle: r.customer.name, trailing: Money.pkr(r.grandTotal))
        }
    }

    private func confirmedLine(_ r: OnlineOrderRow) -> String {
        var s = r.customer.name
        if let at = r.confirmedAt, !at.isEmpty { s += " · confirmed " + ShopDate.say(at, withTime: true) }
        if let by = OnlineOrdersLogic.who(r.confirmedBy) { s += " by " + by }
        return s
    }
}

#if os(macOS)
// MARK: The Mac's inbox: the orders down the left, the picked one as a document on the right

/// The online inbox on a Mac (docs/features/mac-design.md): the orders in a list at the left, the picked one at the right
/// as a document (who it is from, its pieces, the customer). Confirm and Decline are the window's toolbar, the Online
/// Order menu and the right-click menu, declared once; they ask in a sheet that says to whom and what is sent.
extension OnlineOrdersScreen {
    private var macRows: [OnlineOrderRow] { store.waiting + store.lately }

    fileprivate var macGoPushed: Binding<Route?> {
        Binding(get: { openPlaceWindow == nil ? go : nil }, set: { go = $0 })
    }

    /// A confirmed order's page opens in a window of its own where one can be made.
    fileprivate func macOpenGo(_ r: Route?) {
        guard let r, let openPlaceWindow else { return }
        openPlaceWindow(r)
        go = nil
    }

    fileprivate var macList: some View {
        let waiting = store.waiting
        let lately = store.lately
        let current = macRows.first { $0.id == picked }
        let groups = macActions(current)
        return HSplitView {
            List(selection: $picked) {
                if waiting.isEmpty && !lately.isEmpty {
                    Label("Nothing to confirm", systemImage: "checkmark.seal").foregroundStyle(.secondary)
                }
                if !waiting.isEmpty {
                    Section("To confirm") {
                        ForEach(waiting) { (r: OnlineOrderRow) in macRow(r).tag(r.id) }
                    }
                }
                if !lately.isEmpty {
                    Section("The last two weeks") {
                        ForEach(lately) { (r: OnlineOrderRow) in macLatelyRow(r).tag(r.id) }
                    }
                }
            }
            .listStyle(.inset)
            .frame(minWidth: 300, idealWidth: 360, maxWidth: 460)
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                if let id = ids.first, let r = macRows.first(where: { $0.id == id }) { macMenu(r) }
            }
            macDetail(current)
                .frame(minWidth: 460, maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay {
            if waiting.isEmpty && lately.isEmpty {
                EmptyState("Nothing to confirm", symbol: "checkmark.seal",
                           message: "Nothing is in the book, and nobody has the bank details, until you confirm.")
            }
        }
        .navigationSubtitle(waiting.isEmpty ? "" : "\(waiting.count) to confirm")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                ForEach(MacOrdersMenu.pick(groups, ["decline", "confirm", "open"])) { (a: MacAction) in
                    MacToolbarAction(action: a)
                }
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Online Order", groups: groups))
        .macRefresh { if asks { Task { await store.load() } } }
        .onAppear { if picked == nil { picked = waiting.first?.id ?? lately.first?.id } }
        .onChange(of: store.waiting.map(\.id)) { _, ids in
            if picked == nil || !macRows.contains(where: { $0.id == picked }) { picked = ids.first ?? lately.first?.id }
        }
    }

    // MARK: The list

    private func macRow(_ r: OnlineOrderRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.customer.name.isEmpty ? "Customer" : r.customer.name).lineLimit(1)
                Text([r.id, OnlineOrdersLogic.ago(r.placedAt)].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(Money.pkr(r.grandTotal)).monospacedDigit()
        }
    }

    @ViewBuilder
    private func macLatelyRow(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirmed", let orderId = r.orderId, !orderId.isEmpty {
            TwoLine(title: "\(r.id) \u{00B7} \(orderId)", subtitle: confirmedLine(r), trailing: Money.pkr(r.grandTotal))
        } else if r.state == "declined" {
            TwoLine(title: "\(r.id) \u{00B7} declined",
                    subtitle: [r.customer.name, r.declineReason ?? ""].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
                    trailing: Money.pkr(r.grandTotal),
                    trailingTint: .secondary)
        } else {
            TwoLine(title: r.id, subtitle: r.customer.name, trailing: Money.pkr(r.grandTotal))
        }
    }

    // MARK: The actions

    /// Whether Confirm and Decline are on offer for this one: waiting, and nobody else pressing Confirm just now.
    private func macCanDecide(_ r: OnlineOrderRow) -> Bool {
        OnlineOrdersLogic.isWaiting(r) && r.state != "confirming" && mayAct
    }

    /// The order a confirmed one became.
    private func macOrderID(_ r: OnlineOrderRow?) -> String? {
        guard let r, r.state == "confirmed", let id = r.orderId, !id.isEmpty else { return nil }
        return id
    }

    private func macOpenOrder(_ id: String) {
        let route = Route(path: "/orders/\(id)")
        if let openPlaceWindow { openPlaceWindow(route) } else { go = route }
    }

    /// Confirm, Decline and the customer, declared once: the toolbar, the Online Order menu and the right-click menu.
    private func macActions(_ r: OnlineOrderRow?) -> [[MacAction]] {
        let decide = r.map { macCanDecide($0) } ?? false
        let orderID = macOrderID(r)
        let phone = r?.customer.phone ?? ""
        let call = OnlineOrdersLogic.callURL(phone)
        let chat = OnlineOrdersLogic.chatURL(phone)
        let decision: [MacAction] = [
            MacAction("Confirm\u{2026}", symbol: "checkmark", shortcut: KeyboardShortcut(.return, modifiers: .command),
                      enabled: decide, isDefault: true, id: "confirm") { if let r { confirming = r } },
            MacAction("Decline\u{2026}", symbol: "xmark", role: .destructive, enabled: decide, id: "decline") {
                if let r { declining = r }
            },
        ]
        let reach: [MacAction] = [
            MacAction("Open the Order", symbol: "list.clipboard", enabled: orderID != nil, id: "open") {
                if let orderID { macOpenOrder(orderID) }
            },
            MacAction("Call", symbol: "phone", enabled: call != nil, id: "call") { if let call { openURL(call) } },
            MacAction("WhatsApp Chat", symbol: "bubble.left.and.text.bubble.right", enabled: chat != nil, id: "whatsapp") {
                if let chat { openURL(chat) }
            },
        ]
        return [decision, reach]
    }

    @ViewBuilder
    private func macMenu(_ r: OnlineOrderRow) -> some View {
        MacActionItems(groups: macActions(r))
        if let id = macOrderID(r) {
            Divider()
            Button("Open in New Window") { macOpenOrder(id) }
                .disabled(openPlaceWindow == nil)
        }
    }

    // MARK: The picked order

    @ViewBuilder
    private func macDetail(_ r: OnlineOrderRow?) -> some View {
        if let r {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    MacDocumentHeader(
                        title: r.customer.name.isEmpty ? "Customer" : r.customer.name,
                        subtitle: ["Online", r.id, OnlineOrdersLogic.ago(r.placedAt)].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
                        status: macStatus(r),
                        headline: MacHeadline("Customer pays", Money.pkr(r.grandTotal))
                    )
                    Divider()
                    VStack(alignment: .leading, spacing: 24) {
                        macPieces(r)
                        macCustomer(r)
                        macState(r)
                    }
                    .padding(20)
                    .frame(maxWidth: 720, alignment: .leading)
                }
            }
        } else {
            ContentUnavailableView("Pick an Online Order", systemImage: "globe",
                                   description: Text("The order and its pieces show here."))
        }
    }

    private func macStatus(_ r: OnlineOrderRow) -> MacStatus {
        switch r.state {
        case "to_confirm": return MacStatus("To confirm", tone: .owed)
        case "confirming": return MacStatus("Being confirmed", tone: .working)
        case "confirmed": return MacStatus("Confirmed", tone: .settled)
        case "declined": return MacStatus("Declined", tone: .quiet)
        default: return MacStatus(r.state.isEmpty ? "Online" : r.state, tone: .quiet)
        }
    }

    private func macPieces(_ r: OnlineOrderRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(r.lines.count == 1 ? "1 piece" : "\(r.lines.count) pieces").font(.headline)
                Spacer(minLength: 8)
                Text(r.deliveryCharge > 0 ? "incl. \(Money.pkr(r.deliveryCharge)) delivery" : "free delivery")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            VStack(spacing: 0) {
                ForEach(Array(r.lines.enumerated()), id: \.offset) { pair in
                    macLine(pair.element)
                    Divider()
                }
            }
        }
    }

    private func macLine(_ l: OnlineOrderLine) -> some View {
        HStack(spacing: 12) {
            StockImage(imageUrl: l.image, name: l.description, key: l.key)
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(OnlineOrdersLogic.pieceName(l.description)).lineLimit(2)
                if let size = l.size {
                    Text("Size \(size)").font(.callout.weight(.medium)).foregroundStyle(Tone.owed.color)
                }
            }
            Spacer(minLength: 8)
            Text(Money.pkr(l.price)).monospacedDigit()
        }
        .padding(.vertical, 6)
    }

    private func macCustomer(_ r: OnlineOrderRow) -> some View {
        let address = [r.delivery.address, r.delivery.city].filter { !$0.isEmpty }.joined(separator: ", ")
        let notes = r.delivery.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            Text("The customer").font(.headline)
            if !r.customer.phone.isEmpty {
                MacOrdersFact(label: "Phone") {
                    if let call = OnlineOrdersLogic.callURL(r.customer.phone) {
                        Button(r.customer.phone) { openURL(call) }.buttonStyle(.link)
                    } else {
                        Text(r.customer.phone)
                    }
                }
            }
            if !address.isEmpty { MacOrdersFact(label: "Ships to") { Text(address).textSelection(.enabled) } }
            if !notes.isEmpty { MacOrdersFact(label: "Note") { Text("\u{201C}\(notes)\u{201D}").textSelection(.enabled) } }
            if let moved = OnlineOrdersLogic.movedLine(r) {
                let dearer = (OnlineOrdersLogic.moved(r)?.amount ?? 0) > 0
                Text(moved).foregroundStyle(dearer ? Tone.owed.color : Color.secondary)
            }
        }
    }

    /// Where the order stands after the person's look: being confirmed by someone, confirmed, or declined and why.
    @ViewBuilder
    private func macState(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirming" {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Being confirmed" + (OnlineOrdersLogic.who(r.claimedBy).map { " by \($0)" } ?? "") + "\u{2026}")
                    .foregroundStyle(.secondary)
            }
        } else if r.state == "confirmed" {
            MacOrdersFact(label: "Confirmed") { Text(confirmedLine(r)) }
        } else if r.state == "declined", let why = r.declineReason, !why.isEmpty {
            MacOrdersFact(label: "Declined because") { Text(why) }
        }
    }
}
#endif
