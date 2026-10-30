import SwiftUI
import ERPCore

/// My work (src/app/my-work/page.tsx): a karigar's own portal. What to make, by order, oldest and most urgent first,
/// with the size, weight, finish and the instructions of each piece, a tick to say it is done; and their own account:
/// the gold given and returned, and what they were paid.
///
/// Everything comes from /api/karigar/me, which the server fills by hand (no customer's name or number, no price ever
/// reaches a karigar; they have no Firestore either). The tick is /api/karigar/complete, which re-checks that the piece
/// is theirs. Re-read every minute and whenever the app comes back, as the web does.
///
/// An owner reaches it from a karigar's page (`/my-work?preview=<karigar id>`): the same portal, read only, exactly as that
/// karigar sees it. Anyone else is told there is no work account: the page says the same.
struct MyWorkScreen: View {
    /// "/my-work" or "/my-work?preview=<karigar id>".
    let path: String

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    private enum Phase: Equatable {
        case loading, ready, noAccount
        case failed(String)
    }

    private enum Pane: String, CaseIterable, Identifiable {
        case work = "My work"
        case account = "My account"
        var id: String { rawValue }
    }

    @State private var phase: Phase = .loading
    @State private var portal: KarigarPortal?
    @State private var updatedAt: Date?
    @State private var tab: Pane = .work
    /// The piece whose tick is being sent.
    @State private var busy: String?
    @State private var failure: String?
    @State private var confirmingSignOut = false
    /// Bumped when a tick has gone through, so the success tap fires on the event.
    @State private var tickCount = 0
    @State private var width: CGFloat = 0
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    #if os(macOS)
    @State private var macPick: String?
    @State private var macSort: [KeyPathComparator<KarigarPortalJob>] = []
    /// The pieces in the table's order, made once per reading of the portal and per sort.
    @State private var macRowsMemo = Memo<[KarigarPortalJob]>()
    #endif

    /// An iPad's wide window: the orders stand as cards in a grid rather than one long column.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    private var previewId: String? {
        guard let id = WorkPaths.query("preview", in: path), !id.isEmpty else { return nil }
        return id
    }

    /// A karigar's own app: this screen is all they have, so it carries their way out.
    private var isKarigar: Bool { session.role == "karigar" }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .noAccount:
                noAccount
            case .failed(let message):
                // The web portal reads the same /api/karigar/me, so it would fail the same way: trying again is the way
                // through. A karigar keeps Sign out in the toolbar.
                ErrorState(message) {
                    phase = .loading
                    Task { await load() }
                }
            case .ready:
                if let portal {
                    #if os(macOS)
                    macContent(portal)
                    #else
                    content(portal)
                    #endif
                }
            }
        }
        .modifier(HouseGround())
        .navigationTitle(portal?.karigar?.name ?? "My work")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            }
            if isKarigar && portal?.preview != true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { confirmingSignOut = true } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
                }
            }
        }
        // The web's focus handler and its minute timer: a karigar has no live link to the books.
        .task {
            await load()
            LaunchClock.finish("work")
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                await load()
            }
        }
        .onChange(of: scenePhase) { _, now in
            if now == .active { Task { await load() } }
        }
        .failureAlert($failure, title: "Could not update")
        .savedFeedback(trigger: tickCount)
        .confirmDestructive(isPresented: $confirmingSignOut, title: "Sign out?",
                            message: "You will need to sign in again to see your work.",
                            action: "Sign out") { session.signOut() }
    }

    // MARK: Reading

    private func load() async {
        if House.isDemo {
            portal = WorkDemo.portal()
            updatedAt = Date()
            phase = portal?.karigar == nil ? .noAccount : .ready
            return
        }
        let url = previewId.map { "/api/karigar/me?karigarId=" + WorkPaths.component($0) } ?? "/api/karigar/me"
        do {
            let answer: KarigarPortal = try await ERPAPI.shared.get(url)
            portal = answer
            updatedAt = Date()
            phase = answer.karigar == nil ? .noAccount : .ready
        } catch let e as ERPAPI.Failure where e.status == 401 || e.status == 403 {
            // Not a karigar's address (the route answers an owner who named nobody the same way).
            portal = nil
            phase = .noAccount
        } catch {
            // A dropped connection is no reason to blank the work on screen.
            if portal == nil { phase = .failed(error.localizedDescription) }
        }
    }

    /// Says a piece is done, or not (idempotent: the server is told the state wanted, not "flip it").
    private func toggle(_ job: KarigarPortalJob) {
        guard busy == nil, portal?.preview != true else { return }
        // Taken before the Task, so a double tap cannot pass the guard twice.
        busy = job.id
        Task {
            do {
                try await ERPAPI.shared.send("/api/karigar/complete", ["jobId": job.id, "completed": !job.isDone])
                tickCount += 1
                await load()
            } catch {
                failure = error.localizedDescription
            }
            busy = nil
        }
    }

    // MARK: No account

    private var noAccount: some View {
        ContentUnavailableView {
            Label("No work account found", systemImage: "person.crop.circle.badge.questionmark")
        } description: {
            Text("Ask the shop to add your Google address.")
        } actions: {
            if isKarigar {
                Button("Sign out") { confirmingSignOut = true }.buttonStyle(.bordered)
            }
        }
    }

    // MARK: The portal

    private func content(_ p: KarigarPortal) -> some View {
        let readOnly = p.preview
        return List {
            if readOnly, let name = p.karigar?.name {
                Section {
                    Text("Viewing exactly what \(name) sees. Read-only: tick items off from the Workshop dashboard instead.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .houseRows()
            }
            Section {
                figures(p.summary)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } footer: {
                if let updatedAt {
                    Text("Updated \(MyWorkText.clock(updatedAt)) · refreshes automatically")
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
            Section {
                Picker("Show", selection: $tab) {
                    ForEach(Pane.allCases) { (t: Pane) in Text(t.rawValue).tag(t) }
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            switch tab {
            case .work: work(p, readOnly: readOnly)
            case .account: account(p.account)
            }
        }
        .listStyle(.insetGrouped)
        .frame(maxWidth: wide ? 1180 : .infinity)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .refreshable { await load() }
        .motion(tab)
        .selectionFeedback(trigger: tab)
    }

    /// To do, Late (a week or more) and Urgent (two weeks or more).
    private func figures(_ s: KarigarPortalSummary) -> some View {
        FigureRow(alignment: .top, spacing: pt(10)) {
            FigureTile(label: "To do", value: "\(s.active)")
            FigureTile(label: "Late", value: "\(s.late)", tint: s.late > 0 ? Tone.owed.color : .primary)
            FigureTile(label: "Urgent", value: "\(s.critical)", tint: s.critical > 0 ? Tone.late.color : .primary)
        }
        .padding(.vertical, pt(4))
    }

    // MARK: My Work

    @ViewBuilder
    private func work(_ p: KarigarPortal, readOnly: Bool) -> some View {
        let s = KarigarPortalRules.sections(p.jobs)
        if s.active.isEmpty {
            Section {
                ContentUnavailableView("No pending work", systemImage: "checkmark.circle",
                                       description: Text("Nothing is waiting for you at the bench."))
            }
            .houseRows()
        } else {
            // Urgent's and Late's counts are the tiles above (rule 15: not said twice).
            group("Urgent", jobs: s.critical, symbol: "flame", tone: .late, hint: "14+ days", showsCount: false, readOnly: readOnly)
            group("Late", jobs: s.late, symbol: "clock", tone: .owed, hint: "7–14 days", showsCount: false, readOnly: readOnly)
            group("In hand", jobs: s.onTrack, symbol: nil, tone: .quiet, hint: "on track", readOnly: readOnly)
        }
        group("Completed", jobs: s.done, symbol: "checkmark.circle", tone: .quiet, hint: nil, readOnly: readOnly)
    }

    /// One heading of the page and its orders, each order a card of its pieces.
    @ViewBuilder
    private func group(_ title: String, jobs: [KarigarPortalJob], symbol: String?, tone: Tone, hint: String?, showsCount: Bool = true, readOnly: Bool) -> some View {
        if !jobs.isEmpty {
            Section {
                if wide {
                    orderGrid(jobs, readOnly: readOnly)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(KarigarPortalRules.groups(jobs)) { (g: KarigarPortalGroup) in
                        orderHeader(g)
                        ForEach(g.jobs) { (j: KarigarPortalJob) in pieceRow(j, readOnly: readOnly) }
                    }
                }
            } header: {
                LedgerHeading(title: title, count: showsCount ? jobs.count : nil, trailing: hint, tone: tone)
            }
            .houseRows()
        }
    }

    /// An iPad: each order a card of its pieces, as many across as fit.
    private func orderGrid(_ jobs: [KarigarPortalJob], readOnly: Bool) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: pt(12), alignment: .top)], alignment: .leading, spacing: pt(12)) {
            ForEach(KarigarPortalRules.groups(jobs)) { (g: KarigarPortalGroup) in
                VStack(alignment: .leading, spacing: pt(10)) {
                    orderHeader(g)
                    ForEach(g.jobs) { (j: KarigarPortalJob) in pieceRow(j, readOnly: readOnly) }
                }
                .ledgerCard()
            }
        }
    }

    /// The heading a karigar works from: the order's number (or "Stock piece"), how many pieces, when they were given
    /// and how long ago, and a badge once it is a week old.
    private func orderHeader(_ g: KarigarPortalGroup) -> some View {
        let allDone = g.jobs.allSatisfy { $0.isDone }
        let urgency = g.urgency
        let n = g.jobs.count
        let given = KarigarPortalRules.date(g.assignedDate)
        let pieces = "\(n) piece" + (n == 1 ? "" : "s")
        let handed = given.isEmpty ? "" : " · given " + given
        let age = " · \(g.ageDays) day" + (g.ageDays == 1 ? "" : "s") + " ago"
        return HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                if g.isStock {
                    Text("Stock piece").font(.headline)
                } else {
                    Text(g.orderId ?? "").font(Font.headline.monospaced())
                }
                Text(pieces + handed + age)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if !allDone && urgency != "ok" {
                Pill("\(g.ageDays)d", tone: urgency == "critical" ? .late : .owed)
            }
        }
    }

    private func pieceRow(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        HStack(alignment: .top, spacing: pt(12)) {
            tick(j, readOnly: readOnly)
            VStack(alignment: .leading, spacing: pt(8)) {
                Text(j.description)
                    .font(.body.weight(.medium))
                    .strikethrough(j.isDone)
                specs(j)
                if j.sampleGiven {
                    Pill("Sample provided", tone: .quiet)
                }
                if !j.photoSources.isEmpty {
                    // Every reference picture; a tap opens them full screen (PieceGallery.swift).
                    PieceGalleryRow(sources: j.photoSources, title: j.description, size: 120, all: true)
                }
                if let notes = j.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("INSTRUCTIONS").font(.caption2).foregroundStyle(.secondary)
                        Text(notes).font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(pt(8))
                    .background(Tone.owed.color.opacity(0.1), in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                }
            }
        }
        .padding(.vertical, pt(4))
    }

    @ViewBuilder
    private func tick(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        if busy == j.id {
            SkeletonLoading().frame(width: 44, height: 44)
        } else if readOnly {
            Image(systemName: j.isDone ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(j.isDone ? Tone.settled.color : Color.secondary.opacity(0.5))
                .frame(width: 44, height: 44)
                .accessibilityLabel(j.isDone ? "Done" : "Not done")
        } else {
            // The karigar's main action, many times a day: a 44 pt target, a bounce as it flips.
            Button { toggle(j) } label: {
                Image(systemName: j.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(j.isDone ? Tone.settled.color : Color.secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: j.isDone)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(j.isDone ? "Done. Tap to reopen." : "Mark as done")
        }
    }

    /// Size, weight, finish, type, karat, reference, quantity: the boxes under a piece; size and finish stand out.
    @ViewBuilder
    private func specs(_ j: KarigarPortalJob) -> some View {
        let list = KarigarPortalRules.specs(j)
        if !list.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: pt(6))], alignment: .leading, spacing: pt(6)) {
                ForEach(list, id: \.self) { (spec: KarigarPortalRules.Spec) in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(spec.label.uppercased()).font(.caption2).foregroundStyle(.secondary)
                        Text(spec.value)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(spec.accent ? Theme.accent : Color.primary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, pt(10))
                    .padding(.vertical, pt(6))
                    .background(spec.accent ? Theme.accent.opacity(0.12) : Color.secondary.opacity(0.1), in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                }
            }
        }
    }

    // MARK: My Account

    @ViewBuilder
    private func account(_ a: KarigarPortalAccount) -> some View {
        Section {
            FigureRow(alignment: .top, spacing: pt(10)) {
                FigureTile(label: "Received", value: KarigarPortalRules.grams(a.goldGiven))
                FigureTile(label: "Returned", value: KarigarPortalRules.grams(a.goldReceived))
                FigureTile(label: "With you", value: KarigarPortalRules.grams(a.goldNet), tint: a.goldNet > 0 ? Tone.owed.color : .primary)
            }
            .padding(.vertical, pt(4))
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            ForEach(Self.keyed(a.ledger) { "\($0.date)|\($0.description)|\($0.goldOut)|\($0.goldIn)" }) { row in
                goldRow(row.item)
            }
        } header: {
            LedgerHeading(title: "Gold")
        }
        .houseRows()

        Section {
            VStack(alignment: .leading, spacing: 2) {
                HeroAmount(amount: a.totalPaid)
                Text("total paid to you").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Self.keyed(a.payments) { "\($0.date)|\($0.description)|\($0.amount)" }) { row in
                paymentRow(row.item)
            }
        } header: {
            LedgerHeading(title: "Payments received")
        }
        .houseRows()
    }

    private func goldRow(_ l: KarigarPortalGoldLine) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(KarigarPortalRules.date(l.date, shortYear: true)).font(.caption).foregroundStyle(.secondary)
                Text(l.description).font(.subheadline)
            }
            Spacer(minLength: 8)
            Text(l.goldOut != 0 ? "↑ " + KarigarPortalRules.grams(l.goldOut) : "↓ " + KarigarPortalRules.grams(l.goldIn))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(l.goldOut != 0 ? Tone.owed.color : Tone.settled.color)
                .accessibilityLabel((l.goldOut != 0 ? "Given " : "Returned ") + KarigarPortalRules.grams(l.goldOut != 0 ? l.goldOut : l.goldIn))
        }
    }

    private func paymentRow(_ p: KarigarPortalPayment) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(KarigarPortalRules.date(p.date, shortYear: true)).font(.caption).foregroundStyle(.secondary)
                Text(p.description).font(.subheadline)
            }
            Spacer(minLength: 8)
            RowAmount(amount: p.amount)
        }
    }

    /// A line with a stable id (what it is, not where it sits), so a reload does not re-deal the rows.
    private struct Keyed<Item>: Identifiable {
        let id: String
        let item: Item
    }

    private static func keyed<Item>(_ items: [Item], key: (Item) -> String) -> [Keyed<Item>] {
        var seen: [String: Int] = [:]
        return items.map { item in
            let base = key(item)
            let n = seen[base, default: 0]
            seen[base] = n + 1
            return Keyed(id: "\(base)|\(n)", item: item)
        }
    }
}

enum MyWorkText {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "h:mm a"
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f
    }()

    /// "4:05 pm", Karachi's clock.
    static func clock(_ d: Date) -> String { formatter.string(from: d) }
}

#if os(macOS)
// The Mac's My work (docs/features/mac-design.md): the pieces as a Table (a tick to say one is done, how old it is, its size and
// weight), the picked piece's specs, instructions and picture in the inspector, "My account" as two tables (the gold, the payments),
// and the figures as the summary bar at the foot, not as tiles. The pane is chosen in the toolbar; the piece's actions are declared
// once for the Piece menu, the toolbar and the right-click menu. The same /api/karigar/complete, the same rules.
extension MyWorkScreen {
    func macContent(_ p: KarigarPortal) -> some View {
        let readOnly = p.preview
        return VStack(spacing: 0) {
            if readOnly, let name = p.karigar?.name {
                Label("Viewing exactly what \(name) sees. Read-only: tick items off from the Workshop dashboard instead.", systemImage: "eye")
                    .font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                Divider()
            }
            if tab == .work {
                macPieces(p, readOnly: readOnly)
            } else {
                macAccount(p.account)
            }
        }
        .macSummaryBar(macSummary(p))
        .toolbar {
            // The pane switch only; the picked piece's Mark as Done is the inspector's, the Piece menu's and the right-click menu's.
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $tab) {
                    ForEach(Pane.allCases) { (t: Pane) in Text(t.rawValue).tag(t) }
                }
                .pickerStyle(.segmented)
                .help("The pieces to make, or your account")
            }
        }
        .macInspector {
            if tab == .work, let job = macPicked(p) {
                macDetail(job, readOnly: readOnly)
            } else if tab == .work {
                MacInspectorEmpty(title: "No Piece Selected", detail: "Click a piece to see its size, weight, finish and instructions.")
            } else {
                MacInspectorEmpty(title: "My Account", detail: "The gold you were given and returned, and what you were paid, are in the tables.")
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Piece", groups: macGroups(macPicked(p), readOnly: readOnly)))
        .macRefresh { Task { await load() } }
    }

    private func macPicked(_ p: KarigarPortal) -> KarigarPortalJob? {
        guard let id = macPick else { return nil }
        return p.jobs.first { $0.id == id }
    }

    /// The figures as the foot of the window: what is to do, late and urgent; or the gold and what was paid; and when it was read.
    private func macSummary(_ p: KarigarPortal) -> [String] {
        var parts: [String] = []
        if tab == .work {
            let s = p.summary
            parts.append("\(s.active) to do")
            if s.late > 0 { parts.append("\(s.late) late") }
            if s.critical > 0 { parts.append("\(s.critical) urgent") }
        } else {
            let a = p.account
            parts.append("Received " + KarigarPortalRules.grams(a.goldGiven))
            parts.append("Returned " + KarigarPortalRules.grams(a.goldReceived))
            parts.append("With you " + KarigarPortalRules.grams(a.goldNet))
            parts.append(Money.pkr(a.totalPaid) + " paid to you")
        }
        if let updatedAt { parts.append("Updated \(MyWorkText.clock(updatedAt))") }
        return parts
    }

    // MARK: The actions, declared once

    private func macDoneAction(_ job: KarigarPortalJob?, readOnly: Bool) -> MacAction {
        MacAction(job?.isDone == true ? "Mark as Not Done" : "Mark as Done",
                  symbol: job?.isDone == true ? "arrow.uturn.backward.circle" : "checkmark.circle",
                  shortcut: KeyboardShortcut(.return, modifiers: .command),
                  enabled: job != nil && !readOnly && busy == nil, isDefault: true) { if let job { toggle(job) } }
    }

    private func macGroups(_ job: KarigarPortalJob?, readOnly: Bool) -> [[MacAction]] {
        let copying = MacAction("Copy Description", symbol: "doc.on.doc", enabled: job != nil) {
            if let job { UIPasteboard.general.string = job.description }
        }
        return [[macDoneAction(job, readOnly: readOnly)], [copying]]
    }

    // MARK: The pieces

    private func macPieces(_ p: KarigarPortal, readOnly: Bool) -> some View {
        // Sorted and sectioned once per reading of the portal (every minute) and per sort, never per click.
        let key: [Int] = [updatedAt.map { Int($0.timeIntervalSince1970 * 1000) } ?? 0, macSort.hashValue, p.jobs.count]
        let sections = macRowsMemo(key) { () -> [KarigarPortalJob] in
            let s = KarigarPortalRules.sections(p.jobs)
            return s.critical + s.late + s.onTrack + s.done
        }
        let groups: [(String, [KarigarPortalJob])] = [
            ("Urgent", sections.filter { !$0.isDone && $0.urgency == "critical" }),
            ("Late", sections.filter { !$0.isDone && $0.urgency != "critical" && $0.urgency != "ok" }),
            ("To do", sections.filter { !$0.isDone && $0.urgency == "ok" }),
            ("Done", sections.filter { $0.isDone }),
        ]
        return List(selection: $macPick) {
            ForEach(groups, id: \.0) { (g: (String, [KarigarPortalJob])) in
                if !g.1.isEmpty {
                    Section {
                        ForEach(g.1) { (j: KarigarPortalJob) in macPieceRow(j, readOnly: readOnly) }
                    } header: {
                        LedgerHeading(title: g.0, count: g.1.count, tone: g.0 == "Urgent" ? .late : .quiet)
                    }
                }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let j = p.jobs.first(where: { $0.id == id }) {
                MacActionItems(groups: macGroups(j, readOnly: readOnly))
            }
        }
        .overlay {
            if sections.isEmpty {
                ContentUnavailableView("No Pending Work", systemImage: "checkmark.circle",
                                       description: Text("Nothing is waiting for you at the bench."))
            }
        }
    }

    /// The iPhone's piece row: a tick, the piece over its order and making, and how old it is.
    private func macPieceRow(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        HStack(spacing: 10) {
            if busy == j.id {
                ProgressView().controlSize(.small)
            } else {
                Button { toggle(j) } label: {
                    Image(systemName: j.isDone ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(j.isDone ? Tone.settled.color : Color.secondary)
                }
                .buttonStyle(.borderless)
                .disabled(readOnly)
                .help(j.isDone ? "Done. Click to reopen." : "Mark as done")
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(j.description).font(.body).strikethrough(j.isDone).lineLimit(1)
                Text(macPieceLine(j)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            // Rule 15: only a piece that needs someone says so.
            if !j.isDone && j.urgency != "ok" {
                Pill(j.urgency == "critical" ? "Urgent" : "Late", tone: j.urgency == "critical" ? .late : .owed)
            }
            Text("\(j.ageDays) day\(j.ageDays == 1 ? "" : "s")").font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
        .tag(j.id)
        .houseRows()
    }

    /// "ORD-12 \u{00B7} Size 7 \u{00B7} 3.4g \u{00B7} 21K".
    private func macPieceLine(_ j: KarigarPortalJob) -> String {
        var parts: [String] = [j.orderId ?? "Stock piece"]
        if let size = j.size, !size.isEmpty { parts.append("Size " + size) }
        if let w = j.weightG { parts.append(KarigarPortalRules.grams(w)) }
        let finish = [j.karat ?? "", j.plating ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        if !finish.isEmpty { parts.append(finish) }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// Where the piece stands, in a word and a dot.
    private func macPieceStatus(_ j: KarigarPortalJob) -> MacStatus {
        if j.isDone { return MacStatus("Done", tone: .settled) }
        if j.urgency == "critical" { return MacStatus("Urgent", tone: .late) }
        if j.urgency != "ok" { return MacStatus("Late", tone: .owed) }
        return MacStatus("To do", tone: .working)
    }

    /// The picked piece: its head with Mark as Done, its specs, sample picture and instructions.
    private func macDetail(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        let list = KarigarPortalRules.specs(j)
        let status = macPieceStatus(j)
        return MacWorkPage {
            MacWorkHead(title: j.description, subtitle: j.orderId ?? "Stock piece", pill: status.text, pillTone: status.tone) {
                EmptyView()
            }
            if !readOnly { MacActionButtons(actions: [macDoneAction(j, readOnly: readOnly)]) }
            if !list.isEmpty || j.sampleGiven {
                MacWorkCard("Making") {
                    ForEach(list, id: \.self) { (spec: KarigarPortalRules.Spec) in
                        MacWorkFact(spec.label, spec.value)
                    }
                    if j.sampleGiven { MacWorkFact("Sample", "Provided") }
                }
            }
            if !j.photoSources.isEmpty {
                MacWorkCard("Sample") { PieceGalleryRow(sources: j.photoSources, title: j.description, size: 132, all: true) }
            }
            if let notes = j.notes, !notes.isEmpty {
                MacWorkCard("Instructions") { Text(notes).textSelection(.enabled) }
            }
        }
    }

    // MARK: My account

    private func macAccount(_ a: KarigarPortalAccount) -> some View {
        HStack(alignment: .top, spacing: 16) {
            MacWorkCard("Gold") {
                Table(Self.keyed(a.ledger) { "\($0.date)|\($0.description)|\($0.goldOut)|\($0.goldIn)" }) {
                    TableColumn("Date") { (r: Keyed<KarigarPortalGoldLine>) in Text(KarigarPortalRules.date(r.item.date, shortYear: true)).lineLimit(1) }
                        .width(min: 70, ideal: 90)
                    TableColumn("What") { (r: Keyed<KarigarPortalGoldLine>) in Text(r.item.description).lineLimit(1) }
                        .width(min: 80, ideal: 200)
                    TableColumn("Gold") { (r: Keyed<KarigarPortalGoldLine>) in
                        let l = r.item
                        Text(l.goldOut != 0 ? "\u{2191} " + KarigarPortalRules.grams(l.goldOut) : "\u{2193} " + KarigarPortalRules.grams(l.goldIn))
                            .monospacedDigit()
                            .foregroundStyle(l.goldOut != 0 ? Tone.owed.color : Tone.settled.color)
                    }
                    .width(min: 80, ideal: 100)
                }
                .frame(minHeight: 260)
            }
            MacWorkCard("Payments received") {
                Table(Self.keyed(a.payments) { "\($0.date)|\($0.description)|\($0.amount)" }) {
                    TableColumn("Date") { (r: Keyed<KarigarPortalPayment>) in Text(KarigarPortalRules.date(r.item.date, shortYear: true)).lineLimit(1) }
                        .width(min: 70, ideal: 90)
                    TableColumn("What") { (r: Keyed<KarigarPortalPayment>) in Text(r.item.description).lineLimit(1) }
                        .width(min: 80, ideal: 200)
                    TableColumn("Amount") { (r: Keyed<KarigarPortalPayment>) in MacAmount(r.item.amount) }
                        .width(min: 70, ideal: 100)
                }
                .frame(minHeight: 260)
            }
        }
        .padding(16)
        .background(Theme.ground)
    }
}
#endif
