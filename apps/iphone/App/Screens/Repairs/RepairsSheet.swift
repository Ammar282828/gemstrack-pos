import SwiftUI
import ERPCore

/// One ticket, as a sheet on the list (the ERP has no /repairs/<id>: its page opens a ticket in a dialog).
/// What is on it: its pieces, the money, where it stands and who has it. Ready, Collected, Take payment,
/// Edit, Cancel and Delete are native and owners' (the ERP lets only an owner write a repair); Delete asks
/// for the delete code, which the ERP checks with the delete, and takes the money paid out of Extra
/// revenue with the ticket. Print receipt is the ERP's page: the receipt is drawn in the browser
/// (src/lib/repair-pdf.ts, jsPDF and the page's QR codes). It has its own NavigationStack, as a sheet must.
struct RepairsSheet: View {
    let id: String
    /// What the ERP answered when the ticket was written, until the shelf has it.
    var seed: Repair?

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var desk = RepairsDesk()
    @State private var web: RepairsWebTarget?
    @State private var editing = false
    @State private var deletion: OwnerDeletion?
    /// The ticket is gone: the sheet leaves once the code sheet has.
    @State private var deleted = false

    private var current: Repair? { book.repairs.item(id) ?? seed }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(id)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { sheetToolbar }
                // The customer's page, and the ERP's own page for Print receipt.
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                .navigationDestination(item: $web) { target in PlaceScreen(path: target.path) }
        }
        .repairsDesk(desk)
        .sheet(isPresented: $editing) {
            if let r = current { RepairsForm(editing: r) { _, _ in } }
        }
        .sheet(isPresented: deletionShown, onDismiss: afterDeletion) {
            if let d = deletion {
                OwnerDeleteCodeSheet(deletion: d) { deleted = true }
            }
        }
        .onAppear { book.repairs.need() }
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
        if r.status == .received || r.status == .ready { detail += " Cancel repair keeps the record instead." }
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
        List { Group {
            headerSection(r)
            piecesSection(r)
            moneySection(r)
            detailsSection(r)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaBar(edge: .bottom) {
            if session.isOwner && RepairsKit.hasActions(r) { actionBar(r) }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var sheetToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .primaryAction) { ticketMenu }
    }

    /// Print receipt is the ERP's page for this ticket (it draws the PDF), open to everyone who can read
    /// the ticket; Edit, Cancel and Delete are native and owners'. Cancel keeps the record.
    private var ticketMenu: some View {
        let cancellable = current.map { $0.status == .received || $0.status == .ready } ?? false
        return Menu {
            Button { web = RepairsWebTarget(path: RepairsKit.webPath(id)) } label: {
                Label("Print receipt", systemImage: "printer")
            }
            if session.isOwner, let r = current {
                Button { editing = true } label: {
                    Label("Edit", systemImage: "pencil")
                }
                if cancellable {
                    Button(role: .destructive) { desk.askCancel(r) } label: {
                        Label("Cancel repair", systemImage: "xmark.circle")
                    }
                }
                Button(role: .destructive) { askDelete(r) } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    // MARK: Who and where

    private func headerSection(_ r: Repair) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(RepairsKit.repairSummary(r))
                        .font(.title3.weight(.bold))
                    Spacer(minLength: 8)
                    StatusBadge(RepairsKit.label(r.status), color: RepairsKit.color(r.status))
                }
                Text("\(r.id) · in \(RepairsKit.byDay(r.receivedAt))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
            NavigationLink(value: Route(path: "/customers/\(cid)")) {
                LabeledContent("Customer", value: name)
            }
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
        if r.status == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
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
            LedgerHeading(title: "Pieces (\(r.pieces.count))")
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
                Text(Money.pkr(price))
                    .monospacedDigit()
            }
        }
    }

    // MARK: Money

    private func moneySection(_ r: Repair) -> some View {
        let total = RepairsKit.repairTotal(r)
        let paid = RepairsKit.repairPaid(r)
        let owing = RepairsKit.repairBalance(r)
        return Section {
            LabeledContent("Total", value: Money.pkr(total))
            if paid > 0 {
                LabeledContent("Paid") {
                    Text(Money.pkr(paid)).foregroundStyle(.green).monospacedDigit()
                }
            }
            LabeledContent("Balance due") {
                MoneyText(amount: owing, exact: true)
                    .font(.title3.weight(.bold))
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
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    // MARK: Dates, people and the note

    private func detailsSection(_ r: Repair) -> some View {
        Section {
            LabeledContent("Taken in", value: ShopDate.say(r.receivedAt, withTime: true))
            if let d = RepairsKit.filled(r.promisedDate) {
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

    private func actionBar(_ r: Repair) -> some View {
        let busy = desk.isBusy(r.id)
        let owing = r.status != .cancelled && RepairsKit.repairBalance(r) > 0
        return GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                if r.status == .received {
                    primaryButton("Mark ready", "checkmark.circle", busy: busy) { desk.markReady(r) }
                }
                if r.status == .ready {
                    primaryButton("Collected", "shippingbox", busy: busy) { desk.collect(r) }
                }
                if owing {
                    secondaryButton("Take payment", "creditcard", busy: busy) { desk.taking = r }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func primaryButton(_ title: String, _ symbol: String, busy: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity)
        }
        .buttonStyle(.houseProminent)
        .controlSize(.large)
        .disabled(busy)
    }

    private func secondaryButton(_ title: String, _ symbol: String, busy: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .disabled(busy)
    }
}
