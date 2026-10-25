import SwiftUI
import ERPCore

/// One ticket, as a sheet on the list (the ERP has no /repairs/<id>: its page opens a ticket in a dialog).
/// What is on it: its pieces, the money, where it stands and who has it. Ready, Collected, Take payment,
/// Edit, Cancel and Delete are native and owners' (the ERP lets only an owner write a repair); Delete asks
/// for the delete code, which the ERP checks with the delete, and takes the money paid out of Extra
/// revenue with the ticket. Print receipt is the receipt the ERP's page saves (src/lib/repair-pdf.ts), drawn by
/// its server (/api/app/pdf/repair/[id]) and shown here to print or share. It has its own NavigationStack, as a
/// sheet must.
struct RepairsSheet: View {
    let id: String
    /// What the ERP answered when the ticket was written, until the shelf has it.
    var seed: Repair?

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var desk = RepairsDesk()
    @State private var receipt: InvoicePDFTarget?
    @State private var editing = false
    @State private var deletion: OwnerDeletion?
    /// The ticket is gone: the sheet leaves once the code sheet has.
    @State private var deleted = false
    /// Delete is asked once more before the code: it cannot be taken back.
    @State private var confirmingDelete = false

    private var current: Repair? { book.repairs.item(id) ?? seed }
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    var body: some View {
        #if os(macOS)
        macBody
        #else
        NavigationStack {
            content
                .navigationTitle(id)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { sheetToolbar }
                // The customer's page, and the receipt.
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                .navigationDestination(item: $receipt) { t in
                    PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
                }
        }
        .repairsDesk(desk)
        .sheet(isPresented: $editing) {
            if let r = current { RepairsForm(editing: r) { _, _ in }.presentationSizing(.page) }
        }
        .confirmDestructive(isPresented: $confirmingDelete, title: "Delete \(id)?",
                            message: "It is removed for good. The delete code is asked next.",
                            action: "Delete repair") {
            if let r = current { askDelete(r) }
        }
        .sheet(isPresented: deletionShown, onDismiss: afterDeletion) {
            if let d = deletion {
                OwnerDeleteCodeSheet(deletion: d) { deleted = true }
                    .presentationSizing(.form)
            }
        }
        .onAppear { book.repairs.need() }
        #endif
    }

    private var deletionShown: Binding<Bool> {
        Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } })
    }

    private func afterDeletion() {
        if deleted { dismiss() }
    }

    /// The web's "cancel or delete?": Delete removes the ticket for good, and the money paid on it comes
    /// out of Extra revenue with it. Said before the code is asked for.
    private func askDelete(_ r: Repair) {
        let id = r.id
        let paid = RepairsKit.repairPaid(r)
        var detail = "\(RepairsKit.repairSummary(r)) \u{2014} \(RepairsKit.customer(r)). Delete removes it for good"
        detail += paid > 0 ? ", and the \(Money.pkr(paid)) paid comes out of Extra revenue with it." : "."
        if desk.status(r) == .received || desk.status(r) == .ready { detail += " Cancel repair keeps the record instead." }
        deletion = OwnerDeletion(what: "Delete repair \(id)", detail: detail) { code in
            _ = try await ERPAPI.shared.write("deleteRepair", ["repairId": id, "deleteCode": code])
        }
    }

    @ViewBuilder
    private var content: some View {
        if let r = current {
            detail(r)
        } else if !book.repairs.loaded {
            SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView(
                "Repair not found",
                systemImage: "wrench.and.screwdriver",
                description: Text("\(id) is not in the book. It may have been deleted.")
            )
        }
    }

    private func detail(_ r: Repair) -> some View {
        #if os(macOS)
        macDetail(r)
        #else
        // The ticket's header left, its pieces, money and details right, once the sheet is wide enough.
        WideDetailList(leftWidth: 340, wideFrom: 720) {
            Group { headerSection(r) }.houseRows()
        } right: {
            Group { piecesSection(r); moneySection(r); detailsSection(r) }.houseRows()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if session.isOwner && RepairsKit.hasActions(r) { actionBar(r) }
        }
        #endif
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var sheetToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button(role: .close) { dismiss() }
        }
        ToolbarItem(placement: .primaryAction) { ticketMenu }
    }

    /// Print receipt is the ERP's receipt for this ticket, open to everyone who can read the ticket (the
    /// ERP prints it for owners and staff); Edit, Cancel and Delete are native and owners'. Cancel keeps the record.
    private var ticketMenu: some View {
        let cancellable = current.map { desk.status($0) == .received || desk.status($0) == .ready } ?? false
        return Menu {
            Button { receipt = RepairsKit.receipt(id) } label: {
                Label("Print receipt", systemImage: "printer")
            }
            if session.isOwner, let r = current {
                Button { editing = true } label: {
                    Label("Edit", systemImage: "pencil")
                }
                // Cancel keeps the record; Delete removes it: two different things, apart.
                if cancellable {
                    Button(role: .destructive) { desk.askCancel(r) } label: {
                        Label("Cancel repair", systemImage: "xmark.circle")
                    }
                }
                Divider()
                Button(role: .destructive) { confirmingDelete = true } label: {
                    Label("Delete repair…", systemImage: "trash")
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    // MARK: Who and where

    private func headerSection(_ r: Repair) -> some View {
        Section {
            VStack(alignment: .leading, spacing: pt(6)) {
                HStack(alignment: .firstTextBaseline) {
                    Text(RepairsKit.repairSummary(r))
                        .font(.title3.weight(.bold))
                    Spacer(minLength: 8)
                    Pill(RepairsKit.label(desk.status(r)), tone: RepairsKit.tone(desk.status(r)))
                }
                // The number is the sheet's title and the day it came in is under Details: the promise only.
                RepairsPromiseText(repair: r, now: Date(), font: .subheadline)
            }
            customerRow(r)
            phoneRow(r)
            tellThemRow(r)
        }
    }

    @ViewBuilder
    private func customerRow(_ r: Repair) -> some View {
        let name = RepairsKit.customer(r)
        if let cid = r.customerId, !cid.isEmpty, !isWalkInName(r.customerName) {
            #if os(macOS)
            // The ticket sits in a column with no stack of its own: the customer opens in a window.
            LabeledContent("Customer") {
                Button(name) { openPlace?(Route(path: "/customers/\(cid)")) }.buttonStyle(.link)
            }
            #else
            NavigationLink(value: Route(path: "/customers/\(cid)")) {
                LabeledContent("Customer", value: name)
            }
            #endif
        } else {
            LabeledContent("Customer", value: name)
        }
    }

    @ViewBuilder
    private func phoneRow(_ r: Repair) -> some View {
        if let phone = RepairsKit.filled(r.customerContact) {
            LabeledContent("Phone") {
                if let url = RepairsKit.callURL(phone) {
                    Link(phone, destination: url)
                } else {
                    Text(phone)
                }
            }
        }
    }

    /// The page's "Tell them": the ready message, on WhatsApp, for a Ready ticket with a number.
    @ViewBuilder
    private func tellThemRow(_ r: Repair) -> some View {
        if desk.status(r) == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
            Link(destination: url) {
                Label("Tell them it's ready", systemImage: "message")
            }
        }
    }

    // MARK: Pieces

    private func piecesSection(_ r: Repair) -> some View {
        Section {
            ForEach(r.pieces.indices, id: \.self) { i in
                pieceRow(r.pieces[i])
            }
        } header: {
            LedgerHeading(title: "Pieces", count: r.pieces.count)
        }
    }

    private func pieceRow(_ p: RepairPiece) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.item.isEmpty ? "Piece" : p.item)
                    .fontWeight(.medium)
                if !p.work.isEmpty {
                    Text(p.work)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let w = p.weightG, w > 0 {
                    Text(RepairsKit.grams(w))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 8)
            if let price = p.price, price > 0 {
                RowAmount(amount: price)
            }
        }
    }

    // MARK: Money

    private func moneySection(_ r: Repair) -> some View {
        let total = RepairsKit.repairTotal(r)
        let paid = RepairsKit.repairPaid(r)
        let owing = RepairsKit.repairBalance(r)
        return Section {
            MoneyRow("Total", total)
            if paid > 0 {
                MoneyRow("Paid", paid)
            }
            // Nothing owed is the expected state: no big zero (CONVENTIONS rule 15).
            if owing >= 1 {
                LabeledContent("Balance due") {
                    HeroAmount(amount: owing)
                }
            }
            ForEach(r.payments.indices, id: \.self) { i in
                paymentLine(r.payments[i])
            }
        } header: {
            LedgerHeading(title: "Money")
        }
    }

    /// "Today · Cash · Advance".
    private func paymentLine(_ p: RepairPayment) -> some View {
        let words = [ShopDate.say(p.date), p.method?.rawValue ?? "", p.note ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return HStack(alignment: .firstTextBaseline) {
            Text(words)
            Spacer(minLength: 8)
            Text(Money.pkr(p.amount)).monospacedDigit()
                .contentTransition(.numericText(value: p.amount))
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    // MARK: Dates, people and the note

    private func detailsSection(_ r: Repair) -> some View {
        Section {
            LabeledContent("Taken in", value: ShopDate.say(r.receivedAt, withTime: true))
            // The promise is said under the title while the ticket is in the shop; here once it has moved on.
            if desk.status(r) != .received, let d = RepairsKit.filled(r.promisedDate) {
                LabeledContent("Ready by", value: ShopDate.say(d))
            }
            if let d = RepairsKit.filled(r.readyAt) {
                LabeledContent("Marked ready", value: ShopDate.say(d, withTime: true))
            }
            if let d = RepairsKit.filled(r.collectedAt) {
                LabeledContent("Collected", value: ShopDate.say(d, withTime: true))
            }
            if let k = RepairsKit.filled(r.karigarName) {
                LabeledContent("Karigar", value: k)
            }
            if let by = RepairsKit.filled(r.takenBy) {
                LabeledContent("Taken by", value: by)
            }
            noteRow(r)
        } header: {
            LedgerHeading(title: "Details")
        }
    }

    /// For the shop only: never printed, never sent, and an owner's to read.
    @ViewBuilder
    private func noteRow(_ r: Repair) -> some View {
        if session.isOwner, let note = RepairsKit.filled(r.internalNote) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Note for the shop")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(note)
            }
        }
    }

    // MARK: The next step

    /// The next step is the bar's one prominent action; a balance is taken beside it, or is the action itself once
    /// the ticket has nothing else to move on to.
    private func actionBar(_ r: Repair) -> some View {
        let busy = desk.isBusy(r.id)
        let owing = desk.status(r) != .cancelled && RepairsKit.repairBalance(r) > 0
        let pay = ActionBar.Action("Take payment", systemImage: "banknote", isBusy: busy) { desk.taking = r }
        switch desk.status(r) {
        case .received:
            return ActionBar(primary: ActionBar.Action("Mark ready", systemImage: "checkmark.circle", isBusy: busy) { desk.markReady(r) },
                             secondary: owing ? [pay] : [])
        case .ready:
            return ActionBar(primary: ActionBar.Action("Collected", systemImage: "shippingbox", isBusy: busy) { desk.collect(r) },
                             secondary: owing ? [pay] : [])
        default:
            return ActionBar(primary: pay)
        }
    }
}

// MARK: The Mac's ticket

#if os(macOS)
extension RepairsSheet {
    /// The ticket as a column or window of its own, not a sheet: no stack of its own (the desk's inspector or the
    /// hub's detail column holds it), its actions in the toolbar and a footer, the receipt through the Mac's print panel.
    @ViewBuilder
    var macBody: some View {
        content
            .navigationTitle(id)
            .toolbar { macToolbar }
            .repairsDesk(desk)
            .sheet(isPresented: $editing) {
                if let r = current { RepairsForm(editing: r) { _, _ in } }
            }
            .confirmDestructive(isPresented: $confirmingDelete, title: "Delete \(id)?",
                                message: "It is removed for good. The delete code is asked next.",
                                action: "Delete repair") {
                if let r = current { askDelete(r) }
            }
            .sheet(isPresented: deletionShown, onDismiss: afterDeletion) {
                if let d = deletion {
                    OwnerDeleteCodeSheet(deletion: d) { deleted = true }
                }
            }
            .onAppear { book.repairs.need() }
    }

    /// Everything on the ticket in one grouped form (header, pieces, money, details), the next step at the foot.
    func macDetail(_ r: Repair) -> some View {
        Form { Group {
            headerSection(r)
            piecesSection(r)
            moneySection(r)
            detailsSection(r)
            }
            .houseRows()
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if session.isOwner && RepairsKit.hasActions(r) { macFooter(r) }
        }
    }

    /// The next step on the right and a balance taken beside it. Not the Return key: a ticket in a column is not a dialog.
    private func macFooter(_ r: Repair) -> some View {
        let busy = desk.isBusy(r.id)
        let owing = desk.status(r) != .cancelled && RepairsKit.repairBalance(r) > 0
        return VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                if owing {
                    Text("\(Money.pkr(RepairsKit.repairBalance(r))) due").font(.callout).foregroundStyle(.secondary).monospacedDigit()
                }
                Spacer(minLength: 8)
                if owing {
                    Button { desk.taking = r } label: { Label("Take payment", systemImage: "banknote") }
                        .disabled(busy)
                }
                switch desk.status(r) {
                case .received:
                    Button { desk.markReady(r) } label: { Label("Mark ready", systemImage: "checkmark.circle") }
                        .buttonStyle(.borderedProminent).disabled(busy)
                case .ready:
                    Button { desk.collect(r) } label: { Label("Collected", systemImage: "shippingbox") }
                        .buttonStyle(.borderedProminent).disabled(busy)
                default:
                    EmptyView()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    @ToolbarContentBuilder
    var macToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button { MacPrint.print(Route(path: repairsTicketPath(id))) } label: { Label("Print receipt", systemImage: "printer") }
                .help("Print the receipt")
            if session.isOwner, let r = current {
                Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
                    .keyboardShortcut("e", modifiers: .command)
                    .help("Edit this ticket (⌘E)")
                Menu {
                    if desk.status(r) == .received || desk.status(r) == .ready {
                        Button(role: .destructive) { desk.askCancel(r) } label: { Label("Cancel repair", systemImage: "xmark.circle") }
                    }
                    Divider()
                    Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete repair…", systemImage: "trash") }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
    }
}
#endif
