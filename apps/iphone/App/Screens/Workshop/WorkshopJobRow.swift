import SwiftUI
import ERPCore

/// One piece on the bench (src/components/karigar/job-card.tsx, the Workshop's JobRow): what it is, who has it,
/// whether it has left the shop, and what an owner does to it, each a write through the ERP. An order's piece and a
/// sold piece (an invoice's line): pick a karigar, tick it Given, tick it Done. A stock job (written up by hand, for
/// the shop's own stock, a repair or a sample) keeps the karigar it was written for: tick it Given, set its status,
/// delete it (the delete code). Any piece's making details are changed in its Details sheet. Assigning, handing over and
/// finishing are three different moments, and a name picked is not gold gone.
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
    @State private var instructionsOpen = false
    /// The Given switch as tapped, held until the write settles so it does not snap back while the shelf catches up.
    @State private var pendingGiven: Bool?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The stock job's status in the ERP's words.
    private var stockStatus: KarigarJobStatus {
        switch job.status {
        case .pending: return .pending
        case .inProgress: return .inProgress
        case .completed: return .completed
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    titleLine
                    badgeLine
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Menu { menuItems } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Actions for " + job.description)
            }
            referenceLine
            if showKarigar && !job.isUnassigned && (job.isDone || (isStock && canWrite)) {
                Label(job.karigarName, systemImage: "hammer").font(.subheadline).foregroundStyle(.secondary)
            }
            specLine
            notesBox
            Divider()
            // The controls stay where they are while a write is in flight: dimmed with a spinner over them, so the
            // card never changes height.
            controls
                .opacity(busy ? 0.35 : 1)
                .overlay { if busy { ProgressView().accessibilityLabel("Updating job") } }
                .motion(busy)
        }
        .padding(.vertical, 4)
        // No swipe actions: the cards share one list row (WorkshopCards' grid), so a swipe would act on whichever
        // card the row picked. The … menu and the long press carry the same actions, on the right piece.
        .contextMenu { menuItems }
    }

    // MARK: What it is

    private var titleLine: some View {
        Text(job.description)
            .font(.headline)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var badgeLine: some View {
        FigureRow(spacing: 8) {
            Label(stageWords, systemImage: stageSymbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(stageTone)
                .contentTransition(.symbolEffect(.replace))
                .motion(stageWords)
            WorkshopAgeBadge(job: job)
            if job.isOnline {
                // A small glyph for where it was sold, not a line of its own.
                Image(systemName: "bag").font(.caption).foregroundStyle(.secondary)
                    .accessibilityLabel("Online sale")
            }
        }
    }

    private var stageWords: String {
        if job.isDone { return "Completed" }
        if job.isUnassigned { return "Needs a karigar" }
        return job.hasGiven ? "On the bench" : "Ready to give"
    }

    private var stageSymbol: String {
        if job.isDone { return "checkmark.circle" }
        if job.isUnassigned { return "person.badge.plus" }
        return job.hasGiven ? "hammer" : "shippingbox"
    }

    private var stageTone: Color {
        // Done is the expected end: no colour (rule 15).
        if job.isDone { return .secondary }
        if job.isUnassigned { return Tone.owed.color }
        return job.hasGiven ? Theme.accent : Tone.owed.color
    }

    /// The order (or invoice) it came off, its customer, and who took it: "on every order in the Workshop".
    @ViewBuilder
    private var referenceLine: some View {
        if let place = referencePlace {
            VStack(alignment: .leading, spacing: 6) {
                Button { actions.open(place) } label: {
                    HStack(spacing: 2) {
                        Text(job.invoiceId ?? job.orderId ?? "")
                            .font(.caption.monospaced().weight(.medium))
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.borderless)
                if !referenceWords.isEmpty {
                    Text(referenceWords)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            Label("Stock work", systemImage: "shippingbox")
                .font(.caption).foregroundStyle(.secondary)
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
        // Only when recorded: "not recorded" is noise on every piece nobody noted.
        if let by = job.takenBy, !by.isEmpty { parts.append("Taken by " + by) }
        // How long it has sat: a quiet caption while on track (a badge only when it needs someone).
        if !job.isDone, job.urgency == .ok, job.ageDays > 0 {
            parts.append(job.ageDays == 1 ? "1 day" : "\(job.ageDays) days")
        }
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
            DisclosureGroup(isExpanded: Binding(
                get: { instructionsOpen },
                set: { on in Motion.run(reduce: reduceMotion) { instructionsOpen = on } }
            )) {
                Text(notes)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            } label: {
                Label("Instructions", systemImage: "note.text")
                    .font(.subheadline.weight(.medium))
                    .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Who has it, and whether it has gone

    @ViewBuilder
    private var controls: some View {
        if canWrite && isStock {
            // A stock job's controls stay while it is done too (the web's): its status can go back, it can be deleted.
            VStack(alignment: .leading, spacing: 12) {
                if !job.isDone && !job.isUnassigned { givenToggle }
                FigureRow(spacing: 12) {
                    statusMenu
                    Button { actions.details(job) } label: {
                        Label("Details", systemImage: "pencil").font(.subheadline)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                }
            }
            .padding(.top, 2)
        } else if canWrite && !job.isDone {
            // Who has it, and whether it has gone: nothing else on the card. A piece with nobody yet has nothing to
            // hand over, so no switch; the ERP's details are in the card's menu.
            VStack(alignment: .leading, spacing: 12) {
                FigureRow(spacing: 12) {
                    assignMenu
                    Spacer(minLength: 0)
                    Button { actions.done(job, true) } label: {
                        Label("Mark done", systemImage: "checkmark.circle")
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                }
                if !job.isUnassigned { givenToggle }
            }
            .padding(.top, 2)
        } else if !job.isDone {
            readOnlyControls
        } else {
            Label(job.hasGiven ? "Given " + ShopDate.say(job.givenAt) : "Completed", systemImage: "checkmark.circle")
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }

    /// An order's or a sold piece's making details (name, size, weight, instructions, sample picture), from the menu; a
    /// stock job's Details sit on the card too.
    private var showsDetails: Bool { canWrite && !isStock }

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
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
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
                .foregroundStyle(assigned ? Color.primary : Theme.accent)
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
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
        let shown = pendingGiven ?? job.hasGiven
        return Toggle(isOn: Binding(get: { shown }, set: { on in pendingGiven = on; actions.given(job, on) })) {
            Text(givenWords(shown))
                .foregroundStyle(shown ? Color.secondary : Color.primary)
                .contentTransition(.opacity)
        }
        .font(.subheadline)
        .frame(minHeight: 44)
        .disabled(job.isUnassigned || busy)
        .motion(job.hasGiven)
        .onChange(of: busy) { _, now in if !now { pendingGiven = nil } }
    }

    private func givenWords(_ given: Bool) -> String {
        if given { return "Given " + ShopDate.say(job.givenAt) }
        if job.isUnassigned { return "Assign a karigar first" }
        return "Given to karigar"
    }

    /// A piece the phone does not change (staff's view): who has it and whether it went.
    @ViewBuilder
    private var readOnlyControls: some View {
        // One row: who has it, and when it went. Amber only for the one thing missing (no karigar).
        if job.isUnassigned {
            Label("No karigar yet", systemImage: "hammer")
                .font(.subheadline).foregroundStyle(Tone.owed.color)
        } else {
            AdaptiveStack(spacing: 8) {
                Label(job.karigarName, systemImage: "hammer").fontWeight(.medium)
                Text(job.hasGiven ? "Given " + ShopDate.say(job.givenAt) : "Not given yet")
                    .foregroundStyle(.secondary)
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
        if showsDetails && !busy {
            Button { actions.details(job) } label: {
                Label("Details", systemImage: "pencil")
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
