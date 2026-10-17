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

    /// The stock job's status in the ERP's words.
    private var stockStatus: KarigarJobStatus {
        switch job.status {
        case .pending: return .pending
        case .inProgress: return .inProgress
        case .completed: return .completed
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    titleLine
                    secondaryLine
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
            controls
            if busy { SkeletonLoading("Updating job").frame(height: 20) }
        }
        .padding(.vertical, 4)
        // No swipe actions: the cards share one list row (WorkshopCards' grid), so a swipe would act on whichever
        // card the row picked. The … menu and the long press carry the same actions, on the right piece.
        .contextMenu { menuItems }
    }

    // MARK: What it is (rule 15: two lines, one colour, and only for what needs a look)

    /// Line one: what it is, and the one thing that needs someone, if any (late, or nobody on it).
    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(job.description)
                .font(.headline)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let flag {
                Text(flag.words)
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(flag.tone.color)
                    .lineLimit(1)
            }
        }
    }

    /// What needs a look: a piece two weeks out is late, one a week out is due a word, one with nobody on it needs a
    /// karigar. On time, on the bench, done: nothing.
    private var flag: (words: String, tone: Tone)? {
        if job.isDone { return nil }
        switch job.urgency {
        case .critical: return ("\(job.ageDays)d", Tone.late)
        case .warning: return ("\(job.ageDays)d", Tone.owed)
        case .ok: return job.isUnassigned ? ("Needs a karigar", Tone.owed) : nil
        }
    }

    /// Line two, quiet and one line: where it came from, who has it, its size and weight. The instructions, who took the
    /// order and the order's page are in the menu.
    private var secondaryLine: some View {
        HStack(spacing: 4) {
            // The one source worth a glyph: an online sale is made for a courier, not the counter.
            if job.isOnline { Image(systemName: "bag").accessibilityLabel("Online sale") }
            Text(secondaryWords)
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    private var secondaryWords: String {
        var parts: [String] = []
        if let ref = job.invoiceId ?? job.orderId { parts.append(ref) } else { parts.append("Stock work") }
        if let c = job.customerName, !c.isEmpty { parts.append(c) }
        if showKarigar && !job.isUnassigned { parts.append(job.karigarName) }
        let meta = WorkshopLogic.meta(job)
        if !meta.isEmpty { parts.append(meta) }
        if job.isDone { parts.append(job.hasGiven ? "Done, given " + ShopDate.say(job.givenAt) : "Done") }
        // Owners have the switch below; anyone else reads whether it went here.
        else if !canWrite && !job.isUnassigned { parts.append(job.hasGiven ? "Given " + ShopDate.say(job.givenAt) : "Not given yet") }
        return parts.joined(separator: " · ")
    }

    /// The order's own page, or the invoice's page: a sold piece sits on its invoice.
    private var referencePlace: WorkshopPlace? {
        if let inv = job.invoiceId { return WorkshopPlace(path: "/invoices/" + WorkshopLogic.piece(inv), title: "") }
        if let ord = job.orderId { return WorkshopPlace.order(ord) }
        return nil
    }

    /// Who took the order or wrote the invoice, for the menu.
    private var takenByWords: String {
        "Taken by " + ((job.takenBy ?? "").isEmpty ? "not recorded" : (job.takenBy ?? ""))
    }

    // MARK: Who has it, and whether it has gone

    @ViewBuilder
    private var controls: some View {
        if canWrite && isStock {
            // A stock job's controls stay while it is done too (the web's): its status can go back, it can be deleted.
            VStack(alignment: .leading, spacing: 12) {
                if !job.isDone && !job.isUnassigned { givenToggle }
                // Details and Delete are in the menu.
                statusMenu
            }
            .padding(.top, 2)
        } else if canWrite && !job.isDone {
            // Who has it, and whether it has gone: nothing else on the card. A piece with nobody yet has nothing to
            // hand over, so no switch; its making details are in the card's menu.
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
        }
        // Read only, or done: line two says who has it and whether it went; nothing more on the card.
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
        Toggle(isOn: Binding(get: { job.hasGiven }, set: { on in actions.given(job, on) })) {
            Text(givenWords).foregroundStyle(job.hasGiven ? Color.secondary : Color.primary)
        }
        .font(.subheadline)
        .frame(minHeight: 44)
        .disabled(job.isUnassigned || busy)
    }

    private var givenWords: String {
        if job.hasGiven { return "Given " + ShopDate.say(job.givenAt) }
        if job.isUnassigned { return "Assign a karigar first" }
        return "Given to karigar"
    }

    // MARK: Long press

    @ViewBuilder
    private var menuItems: some View {
        // What the card leaves out: who took it and the karigar's instructions.
        Section {
            Text(takenByWords)
            if let notes = job.notes, !notes.isEmpty { Text("Instructions: " + notes) }
        }
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
