#if os(macOS)
import SwiftUI
import ERPCore

// A repair ticket on the Mac (docs/features/mac-design.md, "Repairs"): the same view in the inspector beside the table and, at
// a window's size, in a window of its own. Its header (who, what, where it stands, what it owes) carries the next step as the
// default button with Take Payment beside it; below, the pieces, the money and the details.

// MARK: The questions a ticket asks

/// The questions and sheets of a `MacRepairsModel`: the phone's (the status moves, the payment sheet, the cancel question and
/// the write alerts), the one question Collected asks, Edit in a sheet and the delete code's sheet.
struct MacRepairsDialogs: ViewModifier {
    let model: MacRepairsModel

    func body(content: Content) -> some View {
        content
            .repairsDesk(model.desk)
            .confirmationDialog(collectTitle, isPresented: collectShown, titleVisibility: .visible, presenting: model.collecting) { r in
                collectButtons(r)
            } message: { r in
                Text("\(r.id) still owes \(Money.pkr(RepairsKit.repairBalance(r).rounded())).")
            }
            .sheet(item: editingBinding) { r in
                RepairsForm(editing: r) { _, _ in }
            }
            .sheet(item: deletionBinding) { d in
                OwnerDeleteCodeSheet(deletion: d) { model.deleted = true }
            }
    }

    private var collectShown: Binding<Bool> {
        Binding(get: { model.collecting != nil }, set: { if !$0 { model.collecting = nil } })
    }

    private var collectTitle: String {
        guard let r = model.collecting else { return "" }
        return "Hand back \(r.id)?"
    }

    @ViewBuilder
    private func collectButtons(_ r: Repair) -> some View {
        Button("Take \(Money.pkr(RepairsKit.repairBalance(r).rounded())) and Hand Back") { model.handBack(r, takingBalance: true) }
        Button("Hand Back Without It") { model.handBack(r, takingBalance: false) }
        Button("Cancel", role: .cancel) {}
    }

    private var editingBinding: Binding<Repair?> {
        Binding(get: { model.editing }, set: { model.editing = $0 })
    }

    private var deletionBinding: Binding<OwnerDeletion?> {
        Binding(get: { model.deletion }, set: { model.deletion = $0 })
    }
}

// MARK: The ticket

struct MacRepairsTicket: View {
    let id: String
    /// What the ERP answered when the ticket was written, until the shelf has it.
    var seed: Repair?
    let model: MacRepairsModel
    /// A window's size (the details beside the pieces and money) rather than the inspector's column.
    var wide = false

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.openPlaceWindow) private var openPlace

    private var current: Repair? { book.repairs.item(id) ?? seed }

    var body: some View {
        Group {
            if let r = current {
                ticket(r)
            } else if !book.repairs.loaded {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Repair Not Found", systemImage: "wrench.and.screwdriver",
                                       description: Text("\(id) is not in the book. It may have been deleted."))
            }
        }
        .onAppear { book.repairs.need() }
    }

    // MARK: Layout

    @ViewBuilder
    private func ticket(_ r: Repair) -> some View {
        let status = model.desk.status(r)
        let owing = status == .cancelled ? 0 : RepairsKit.repairBalance(r)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                head(r, status: status, owing: owing)
                if wide {
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 14) {
                            piecesCard(r)
                            moneyCard(r, owing: owing)
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        VStack(spacing: 14) {
                            customerCard(r)
                            detailsCard(r, status: status)
                        }
                        .frame(width: 320, alignment: .top)
                    }
                } else {
                    customerCard(r)
                    piecesCard(r)
                    moneyCard(r, owing: owing)
                    detailsCard(r, status: status)
                }
            }
            .padding(wide ? 20 : 14)
        }
        .background(Theme.ground)
    }

    /// The iPhone's record head as a card: the monogram, the piece, who and which, the status pill, what is owed as the one
    /// figure, how much of it is paid, the promise, then the next step as the default button.
    private func head(_ r: Repair, status: RepairStatus, owing: Double) -> some View {
        let total = RepairsKit.repairTotal(r)
        let paid = RepairsKit.repairPaid(r)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Monogram(name: RepairsKit.customer(r), size: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: 3) {
                    Text(RepairsKit.repairSummary(r))
                        .font(.system(wide ? .title : .title3, design: .serif).weight(.semibold))
                        .lineLimit(2).textSelection(.enabled)
                    Text(subtitle(r)).font(.callout).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Pill(RepairsKit.label(status), tone: RepairsKit.tone(status))
                promise(r, status: status)
                Spacer(minLength: 0)
            }
            if owing >= 1 {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Owed").font(.caption).foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text("PKR").font(.system(.callout, design: .serif).weight(.medium)).foregroundStyle(.secondary)
                        Text(HeroAmount.figure(owing, lac: false))
                            .font(.system(wide ? .largeTitle : .title, design: .serif).weight(.semibold))
                            .foregroundStyle(Tone.owed.color).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
            }
            if status != .cancelled && total >= 1 {
                PaidBar(paid: paid, total: total)
            }
            let actions = headActions(r)
            if !actions.isEmpty { MacActionButtons(actions: actions) }
            reach(r)
        }
        .padding(Metrics.cardPadding + (wide ? 4 : 0))
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// Call and WhatsApp: the iPhone's quick actions as a row of buttons.
    @ViewBuilder
    private func reach(_ r: Repair) -> some View {
        if let phone = RepairsKit.filled(r.customerContact) {
            HStack(spacing: 8) {
                if let url = RepairsKit.callURL(phone) {
                    QuickAction(title: "Call", symbol: "phone.fill") { openURL(url) }
                }
                if let url = CustomerKit.whatsAppURL(phone) {
                    QuickAction(title: "WhatsApp", symbol: "message.fill") { openURL(url) }
                }
            }
        }
    }

    /// "REP-000012 · Sana Demo".
    private func subtitle(_ r: Repair) -> String {
        [r.id, RepairsKit.customer(r)].joined(separator: " \u{00B7} ")
    }

    @ViewBuilder
    private func promise(_ r: Repair, status: RepairStatus) -> some View {
        if status == .received {
            RepairsPromiseText(repair: r, now: Date(), font: .callout)
        }
    }

    /// The next step as the default button, with Take Payment beside it (the inspector's head).
    private func headActions(_ r: Repair) -> [MacAction] {
        let all = model.groups([r], owner: session.isOwner, shopName: session.shop.name, open: { openURL($0) }).flatMap { $0 }
        return all.filter { ($0.id == "ready" || $0.id == "collected" || $0.id == "pay") && $0.enabled }
    }

    // MARK: Cards

    /// A card: its heading in the serif (a figure beside it), then its rows, on the house's card.
    private func card<C: View>(_ title: String, trailing: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LedgerHeading(title: title, trailing: trailing)
            content()
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// A label and its value on one line.
    private func line<V: View>(_ label: String, @ViewBuilder _ value: () -> V) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            value().multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    private func customerCard(_ r: Repair) -> some View {
        card("Customer") {
            customerRow(r)
            if let phone = RepairsKit.filled(r.customerContact) {
                line("Phone") {
                    if let url = RepairsKit.callURL(phone) {
                        Link(phone, destination: url)
                    } else {
                        Text(phone)
                    }
                }
            }
            if model.desk.status(r) == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
                Link(destination: url) { Label("Tell Them It's Ready", systemImage: "message") }
            }
            if !wide, let receipt = receiptAction(r) {
                Button { receipt.perform() } label: { Label("Print Receipt", systemImage: "printer") }
                    .buttonStyle(.link)
                    .help(receipt.help)
            }
        }
    }

    /// Print Receipt for the inspector: its head has no room for a third button, the Repair menu (\u{2318}P) and the
    /// right-click menu have it too.
    private func receiptAction(_ r: Repair) -> MacAction? {
        model.groups([r], owner: session.isOwner, shopName: session.shop.name, open: { openURL($0) })
            .flatMap { $0 }.first { $0.id == "print" }
    }

    @ViewBuilder
    private func customerRow(_ r: Repair) -> some View {
        let name = RepairsKit.customer(r)
        if let cid = r.customerId, !cid.isEmpty, !isWalkInName(r.customerName) {
            // The customer opens in a window of their own, as a record does from a list.
            line("Customer") {
                Button(name) { openPlace?(Route(path: "/customers/\(cid)")) }.buttonStyle(.link)
            }
        } else {
            line("Customer") { Text(name) }
        }
    }

    private func piecesCard(_ r: Repair) -> some View {
        card("Pieces", trailing: r.pieces.count > 1 ? "\(r.pieces.count)" : nil) {
            ForEach(r.pieces.indices, id: \.self) { (i: Int) in
                if i > 0 { Divider() }
                pieceRow(r.pieces[i])
            }
        }
    }

    private func pieceRow(_ p: RepairPiece) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.item.isEmpty ? "Piece" : p.item).fontWeight(.medium)
                if !p.work.isEmpty {
                    Text(p.work).font(.callout).foregroundStyle(.secondary)
                }
                if let w = p.weightG, w > 0 {
                    Text(RepairsKit.grams(w)).font(.callout).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            Spacer(minLength: 8)
            if let price = p.price, price > 0 {
                Text(Money.pkr(price)).monospacedDigit()
            }
        }
    }

    private func moneyCard(_ r: Repair, owing: Double) -> some View {
        let total = RepairsKit.repairTotal(r)
        let paid = RepairsKit.repairPaid(r)
        return card("Money") {
            line("Total") { Text(Money.pkr(total)).monospacedDigit() }
            if paid > 0 {
                line("Paid") { Text(Money.pkr(paid)).monospacedDigit() }
            }
            // Nothing owed is the expected state: no zero.
            if owing >= 1 {
                line("Balance due") {
                    Text(Money.pkr(owing)).monospacedDigit().fontWeight(.semibold).foregroundStyle(Tone.owed.color)
                }
            }
            ForEach(r.payments.indices, id: \.self) { (i: Int) in
                paymentLine(r.payments[i])
            }
        }
    }

    /// "Today · Cash · Advance".
    private func paymentLine(_ p: RepairPayment) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(RepairsKit.paymentWords(p))
            Spacer(minLength: 8)
            Text(Money.pkr(p.amount)).monospacedDigit()
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }

    private func detailsCard(_ r: Repair, status: RepairStatus) -> some View {
        card("Details") {
            line("Taken in") { Text(ShopDate.say(r.receivedAt, withTime: true)) }
            // The promise is said under the title while the ticket is in the shop; here once it has moved on.
            if status != .received, let d = RepairsKit.filled(r.promisedDate) {
                line("Ready by") { Text(ShopDate.say(d)) }
            }
            if let d = RepairsKit.filled(r.readyAt) {
                line("Marked ready") { Text(ShopDate.say(d, withTime: true)) }
            }
            if let d = RepairsKit.filled(r.collectedAt) {
                line("Collected") { Text(ShopDate.say(d, withTime: true)) }
            }
            if let k = RepairsKit.filled(r.karigarName) {
                line("Karigar") { Text(k) }
            }
            if let by = RepairsKit.filled(r.takenBy) {
                line("Taken by") { Text(by) }
            }
            // For the shop only: never printed, never sent, and an owner's to read.
            if session.isOwner, let note = RepairsKit.filled(r.internalNote) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Note for the shop").font(.callout).foregroundStyle(.secondary)
                    Text(note).textSelection(.enabled)
                }
            }
        }
    }
}

// MARK: A ticket's own window

/// `/repairs?id=REP-000012` on the Mac: the ticket at a window's size, its actions in the toolbar and the Repair menu.
struct MacRepairsTicketWindow: View {
    let id: String
    var seed: Repair?

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var model = MacRepairsModel()

    private var current: Repair? { book.repairs.item(id) ?? seed }

    var body: some View {
        let groups = actions()
        MacRepairsTicket(id: id, seed: seed, model: model, wide: true)
            .navigationTitle(id)
            .toolbar { windowToolbar(groups) }
            .macRecordMenu(MacRecordMenu(title: "Repair", groups: groups))
            .modifier(MacRepairsDialogs(model: model))
            .onChange(of: model.deleted) { _, gone in
                if gone { dismiss() }
            }
            .onAppear { book.repairs.need() }
    }

    private func actions() -> [[MacAction]] {
        let picked: [Repair] = current.map { [$0] } ?? []
        return model.groups(picked, owner: session.isOwner, shopName: session.shop.name, open: { openURL($0) })
    }

    /// The More menu's actions in two groups: telling the customer, then cancelling and deleting.
    private func moreGroups(_ more: [MacAction]) -> [[MacAction]] {
        let tell: [MacAction] = more.filter { $0.id == "tell" }
        let undo: [MacAction] = more.filter { $0.id != "tell" }
        return [tell, undo].filter { !$0.isEmpty }
    }

    /// The next step, Take Payment, Print Receipt and Edit in the trailing group; the rest in one More menu.
    @ToolbarContentBuilder
    private func windowToolbar(_ groups: [[MacAction]]) -> some ToolbarContent {
        let all = groups.flatMap { $0 }
        let shown = all.filter { (a: MacAction) -> Bool in
            switch a.id {
            case "ready", "collected": return a.enabled
            case "pay", "print", "edit": return true
            default: return false
            }
        }
        let more: [MacAction] = all.filter { ["tell", "cancel", "delete"].contains($0.id) }
        ToolbarItemGroup(placement: .automatic) {
            ForEach(shown) { (a: MacAction) in
                MacToolbarAction(action: a)
            }
            Menu {
                MacActionItems(groups: moreGroups(more))
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
            .help("More things to do with this repair")
        }
    }
}
#endif
