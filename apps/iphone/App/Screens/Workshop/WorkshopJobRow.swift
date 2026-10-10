import SwiftUI
import ERPCore

/// One piece on the bench (src/components/karigar/job-card.tsx, the Workshop's JobRow): what it is, who has it,
/// whether it has left the shop, and what an owner does to it, each a write through the ERP. An order's piece and a
/// sold piece (an invoice's line): pick a karigar, tick it Given, tick it Done. A stock job (written up by hand, for
/// the shop's own stock, a repair or a sample) keeps the karigar it was written for: tick it Given, set its status,
/// change its making details, delete it (the delete code). Assigning, handing over and finishing are three different
/// moments, and a name picked is not gold gone. An order's or a sold piece's making details are the ERP's page.
struct WorkshopJobRow: View {
    let job: WorkshopJob
    /// Name the karigar on the row (the stage and list layouts; the karigar layout already says it).
    let showKarigar: Bool
    let isOwner: Bool
    /// A write for this piece is in flight.
    let busy: Bool
    let choices: WorkshopChoices
    let actions: WorkshopActions

    /// Only an owner changes a piece (the ERP refuses anyone else), and only one the ERP can find again.
    private var canWrite: Bool {
        isOwner && WorkshopLogic.writeTarget(job) != nil
    }

    private var isStock: Bool { job.source == .manual }

    /// The stock job's status in the ERP's words.
    private var stockStatus: KarigarJobStatus {
        switch job.status {
        case .pending: return .pending
        case .inProgress: return .inProgress
        case .completed: return .completed
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            tick
            VStack(alignment: .leading, spacing: 6) {
                titleLine
                badgeLine
                referenceLine
                specLine
                notesBox
                controls
            }
        }
        .padding(.vertical, 4)
        .opacity(job.isDone ? 0.6 : 1)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if canWrite && !busy {
                Button { actions.done(job, !job.isDone) } label: {
                    Label(job.isDone ? "Not done" : "Done", systemImage: job.isDone ? "arrow.uturn.backward" : "checkmark")
                }
                .tint(.green)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canWrite && !busy && isStock {
                Button(role: .destructive) { actions.delete(job) } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
            if canWrite && !busy && !job.isDone && !job.isUnassigned {
                Button { actions.given(job, !job.hasGiven) } label: {
                    Label(job.hasGiven ? "Not given" : "Given", systemImage: "shippingbox")
                }
                .tint(.orange)
            }
        }
        .contextMenu { menuItems }
    }

    // MARK: The tick

    @ViewBuilder
    private var tick: some View {
        if busy {
            SkeletonLoading().frame(width: 28, height: 28)
        } else if canWrite {
            Button {
                actions.done(job, !job.isDone)
            } label: {
                Image(systemName: job.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(job.isDone ? Color.green : Color.secondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(job.isDone ? "Done. Tap to mark not done." : "Mark as done")
        } else {
            Image(systemName: job.isDone ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(job.isDone ? Color.green : Color.secondary.opacity(0.5))
                .frame(width: 28, height: 28)
                .accessibilityLabel(job.isDone ? "Done" : "Not done")
        }
    }

    // MARK: What it is

    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(job.description)
                .font(.headline)
                .strikethrough(job.isDone)
            Spacer(minLength: 4)
            WorkshopAgeBadge(job: job)
        }
    }

    private var badgeLine: some View {
        HStack(spacing: 6) {
            switch job.source {
            case .manual: StatusBadge("Stock", color: .purple)
            case .invoice: StatusBadge(job.isOnline ? "Online" : "Sold", color: job.isOnline ? .green : .secondary)
            case .order: StatusBadge("Order", color: .secondary)
            }
            if showKarigar {
                StatusBadge(job.karigarName, color: job.isUnassigned ? .red : .blue)
            }
        }
    }

    /// The order (or invoice) it came off, its customer, and who took it: "on every order in the Workshop".
    @ViewBuilder
    private var referenceLine: some View {
        if let place = referencePlace {
            VStack(alignment: .leading, spacing: 6) {
                Button { actions.open(place) } label: {
                    HStack(spacing: 2) {
                        Text(job.invoiceId ?? job.orderId ?? "")
                            .font(.subheadline.monospaced().weight(.semibold))
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                }
                .buttonStyle(.borderless)
                Text(referenceWords)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The order's own page, or the invoice's page: a sold piece sits on its invoice.
    private var referencePlace: WorkshopPlace? {
        if let inv = job.invoiceId { return WorkshopPlace(path: "/invoices/" + WorkshopLogic.piece(inv), title: "") }
        if let ord = job.orderId { return WorkshopPlace.order(ord) }
        return nil
    }

    private var referenceWords: String {
        var parts: [String] = []
        if let c = job.customerName, !c.isEmpty { parts.append(c) }
        parts.append("Taken by " + ((job.takenBy ?? "").isEmpty ? "not recorded" : (job.takenBy ?? "")))
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var specLine: some View {
        let meta = WorkshopLogic.meta(job)
        if !meta.isEmpty {
            Text(meta).font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var notesBox: some View {
        if let notes = job.notes, !notes.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Label("Instructions", systemImage: "lock.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.orange)
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(Color.orange.opacity(0.1), in: .rect(cornerRadius: 8))
        }
    }

    // MARK: Who has it, and whether it has gone

    @ViewBuilder
    private var controls: some View {
        if canWrite && isStock {
            // A stock job's controls stay while it is done too (the web's): its status can go back, it can be deleted.
            VStack(alignment: .leading, spacing: 6) {
                if !job.isDone && !job.isUnassigned { givenToggle }
                HStack(spacing: 8) {
                    statusMenu
                    Button { actions.details(job) } label: {
                        Label("Details", systemImage: "pencil").font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(busy)
                }
            }
            .padding(.top, 2)
        } else if canWrite && !job.isDone {
            // Who has it, and whether it has gone: nothing else on the card. A piece with nobody yet has nothing to
            // hand over, so no switch; the ERP's details are in the card's menu.
            VStack(alignment: .leading, spacing: 6) {
                assignMenu
                if !job.isUnassigned { givenToggle }
            }
            .padding(.top, 2)
        } else if !job.isDone {
            readOnlyControls
        } else if job.hasGiven {
            Text("Given " + ShopDate.say(job.givenAt)).font(.caption).foregroundStyle(.secondary)
        }
    }

    /// An order's or a sold piece's making details (name, size, weight, instructions, sample picture) are edited on
    /// the ERP's Workshop page; a stock job's are the Details sheet.
    private var showsDetails: Bool { isOwner && !isStock }

    private var statusMenu: some View {
        Menu {
            ForEach(WorkshopStatusWords.choices, id: \.rawValue) { s in
                Button {
                    if s != stockStatus { actions.status(job, s) }
                } label: {
                    if s == stockStatus {
                        Label(WorkshopStatusWords.say(s), systemImage: "checkmark")
                    } else {
                        Label(WorkshopStatusWords.say(s), systemImage: WorkshopStatusWords.symbol(s))
                    }
                }
            }
        } label: {
            Label(WorkshopStatusWords.say(stockStatus), systemImage: WorkshopStatusWords.symbol(stockStatus))
                .font(.subheadline)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(busy)
    }

    private var assignMenu: some View {
        let assigned = !job.isUnassigned
        return Menu {
            if assigned {
                Button(role: .destructive) { actions.assign(job, "none") } label: {
                    Label("Remove karigar", systemImage: "person.crop.circle.badge.minus")
                }
            }
            if !choices.working.isEmpty {
                Section("Has work now") {
                    ForEach(choices.working) { k in karigarButton(k) }
                }
            }
            Section(choices.working.isEmpty ? "Karigars" : "Other karigars") {
                ForEach(choices.others) { k in karigarButton(k) }
            }
        } label: {
            Label(assigned ? job.karigarName : "Assign karigar", systemImage: assigned ? "hammer" : "person.badge.plus")
                .font(.subheadline)
                .foregroundStyle(assigned ? Color.primary : Color.red)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(busy)
    }

    private func karigarButton(_ k: Karigar) -> some View {
        Button {
            if k.id != job.karigarId { actions.assign(job, k.id) }
        } label: {
            if k.id == job.karigarId {
                Label(k.name, systemImage: "checkmark")
            } else {
                Text(k.name)
            }
        }
    }

    private var givenToggle: some View {
        Toggle(isOn: Binding(get: { job.hasGiven }, set: { on in actions.given(job, on) })) {
            Text(givenWords).foregroundStyle(job.hasGiven ? Color.secondary : Color.primary)
        }
        .font(.subheadline)
        .disabled(job.isUnassigned || busy)
    }

    private var givenWords: String {
        if job.hasGiven { return "Given " + ShopDate.say(job.givenAt) }
        if job.isUnassigned { return "Assign a karigar first" }
        return "Given to karigar"
    }

    /// A piece the phone does not change (staff's view): who has it and whether it went.
    @ViewBuilder
    private var readOnlyControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "hammer").foregroundStyle(.secondary)
                if job.isUnassigned {
                    Text("No karigar yet").foregroundStyle(Color.red)
                } else {
                    Text(job.karigarName).fontWeight(.medium)
                    Text("· " + (job.hasGiven ? "given " + ShopDate.say(job.givenAt) : "not given yet"))
                        .foregroundStyle(job.hasGiven ? Color.secondary : Color.orange)
                }
            }
            .font(.subheadline)
        }
    }

    // MARK: Long press

    @ViewBuilder
    private var menuItems: some View {
        if let place = referencePlace {
            Button { actions.open(place) } label: {
                Label("Open " + (job.invoiceId ?? job.orderId ?? ""), systemImage: "doc.text")
            }
        }
        if !job.isUnassigned {
            Button { actions.open(WorkshopPlace.karigar(job.karigarId)) } label: {
                Label("Open " + job.karigarName, systemImage: "hammer")
            }
        }
        if showsDetails {
            Button { actions.open(WorkshopPlace.workshopPage) } label: {
                Label("Details in the ERP", systemImage: "arrow.up.right.square")
            }
        }
        if canWrite && !busy {
            Button { actions.done(job, !job.isDone) } label: {
                Label(job.isDone ? "Mark not done" : "Mark done", systemImage: job.isDone ? "circle" : "checkmark.circle")
            }
            if !job.isDone && !job.isUnassigned {
                Button { actions.given(job, !job.hasGiven) } label: {
                    Label(job.hasGiven ? "Mark not given" : "Mark given", systemImage: "shippingbox")
                }
            }
            if isStock {
                Button { actions.details(job) } label: {
                    Label("Details", systemImage: "pencil")
                }
                Button(role: .destructive) { actions.delete(job) } label: {
                    Label("Delete job", systemImage: "trash")
                }
            }
        }
    }
}
