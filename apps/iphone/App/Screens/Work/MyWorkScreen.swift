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
        case work = "My Work"
        case account = "My Account"
        var id: String { rawValue }
    }

    @State private var phase: Phase = .loading
    @State private var portal: KarigarPortal?
    @State private var updatedAt: Date?
    @State private var tab: Pane = .work
    /// The piece whose tick is being sent.
    @State private var busy: String?
    @State private var failure: String?

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
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .noAccount:
                noAccount
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't load the work", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") {
                        phase = .loading
                        Task { await load() }
                    }
                    .buttonStyle(.glass)
                    // A karigar has nothing else in the app: the ERP's own portal is the way through meanwhile.
                    if isKarigar {
                        NavigationLink("Open the web portal") { WebScreen(path: "/") }
                    }
                }
            case .ready:
                if let portal { content(portal) }
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
                    Button { session.signOut() } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
                }
            }
        }
        // The web's focus handler and its minute timer: a karigar has no live link to the books.
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                await load()
            }
        }
        .onChange(of: scenePhase) { _, now in
            if now == .active { Task { await load() } }
        }
        .alert("Could not update", isPresented: failureShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
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
        Task {
            busy = job.id
            do {
                try await ERPAPI.shared.send("/api/karigar/complete", ["jobId": job.id, "completed": !job.isDone])
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
                Button("Sign out") { session.signOut() }.buttonStyle(.glass)
            }
        }
    }

    // MARK: The portal

    private func content(_ p: KarigarPortal) -> some View {
        let readOnly = p.preview
        return List {
            if readOnly, let name = p.karigar?.name {
                Section {
                    Text("Viewing exactly what \(name) sees. Read-only — tick items off from the Workshop dashboard instead.")
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
    }

    /// To do, Late (a week or more) and Urgent (two weeks or more).
    private func figures(_ s: KarigarPortalSummary) -> some View {
        HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "To do", value: "\(s.active)")
            FigureTile(label: "Late", value: "\(s.late)", tint: s.late > 0 ? .orange : .primary)
            FigureTile(label: "Urgent", value: "\(s.critical)", tint: s.critical > 0 ? .red : .primary)
        }
        .padding(.vertical, 4)
    }

    // MARK: My Work

    @ViewBuilder
    private func work(_ p: KarigarPortal, readOnly: Bool) -> some View {
        let s = KarigarPortalRules.sections(p.jobs)
        if s.active.isEmpty {
            Section {
                VStack(spacing: 6) {
                    Image(systemName: "checkmark.circle").font(.largeTitle).foregroundStyle(.green)
                    Text("No pending work").font(.headline)
                    Text("Nothing is waiting for you at the bench.").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .houseRows()
        } else {
            group("Urgent", jobs: s.critical, symbol: "flame", tone: .red, hint: "14+ days", readOnly: readOnly)
            group("Late", jobs: s.late, symbol: "clock", tone: .orange, hint: "7–14 days", readOnly: readOnly)
            group("In hand", jobs: s.onTrack, symbol: nil, tone: .secondary, hint: "on track", readOnly: readOnly)
        }
        group("Completed", jobs: s.done, symbol: "checkmark.circle", tone: .secondary, hint: nil, readOnly: readOnly)
    }

    /// One heading of the page and its orders, each order a card of its pieces.
    @ViewBuilder
    private func group(_ title: String, jobs: [KarigarPortalJob], symbol: String?, tone: Color, hint: String?, readOnly: Bool) -> some View {
        if !jobs.isEmpty {
            Section {
                ForEach(KarigarPortalRules.groups(jobs)) { (g: KarigarPortalGroup) in
                    orderHeader(g)
                    ForEach(g.jobs) { (j: KarigarPortalJob) in pieceRow(j, readOnly: readOnly) }
                }
            } header: {
                HStack(spacing: 6) {
                    if let symbol { Image(systemName: symbol) }
                    Text(title.uppercased()).fontWeight(.bold)
                    Text("\(jobs.count)").foregroundStyle(.secondary)
                    Spacer()
                    if let hint { Text(hint).font(.caption2).foregroundStyle(.secondary) }
                }
                .foregroundStyle(tone)
                .textCase(nil)
            }
            .houseRows()
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
                StatusBadge("\(g.ageDays)d", color: urgency == "critical" ? .red : .orange)
            }
        }
        .opacity(allDone ? 0.55 : 1)
    }

    private func pieceRow(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            tick(j, readOnly: readOnly)
            VStack(alignment: .leading, spacing: 8) {
                Text(j.description)
                    .font(.body.weight(.medium))
                    .strikethrough(j.isDone)
                specs(j)
                if j.sampleGiven {
                    StatusBadge("Sample provided", color: .secondary)
                }
                if let picture = j.sampleImage, !picture.isEmpty {
                    WorkSamplePhoto(uri: picture, key: j.id)
                }
                if let notes = j.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("INSTRUCTIONS").font(.caption2).foregroundStyle(.secondary)
                        Text(notes).font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color.orange.opacity(0.1), in: .rect(cornerRadius: 8))
                }
            }
        }
        .padding(.vertical, 4)
        .opacity(j.isDone ? 0.6 : 1)
    }

    @ViewBuilder
    private func tick(_ j: KarigarPortalJob, readOnly: Bool) -> some View {
        if busy == j.id {
            ProgressView().frame(width: 28, height: 28)
        } else if readOnly {
            Image(systemName: j.isDone ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(j.isDone ? Color.green : Color.secondary.opacity(0.5))
                .frame(width: 28, height: 28)
                .accessibilityLabel(j.isDone ? "Done" : "Not done")
        } else {
            Button { toggle(j) } label: {
                Image(systemName: j.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(j.isDone ? Color.green : Color.secondary)
                    .frame(width: 28, height: 28)
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
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(list, id: \.self) { (spec: KarigarPortalRules.Spec) in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(spec.label.uppercased()).font(.caption2).foregroundStyle(.secondary)
                        Text(spec.value)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(spec.accent ? Theme.accent : Color.primary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(spec.accent ? Theme.accent.opacity(0.12) : Color.secondary.opacity(0.1), in: .rect(cornerRadius: 8))
                }
            }
        }
    }

    // MARK: My Account

    @ViewBuilder
    private func account(_ a: KarigarPortalAccount) -> some View {
        Section {
            HStack(alignment: .top, spacing: 10) {
                FigureTile(label: "Received", value: KarigarPortalRules.grams(a.goldGiven))
                FigureTile(label: "Returned", value: KarigarPortalRules.grams(a.goldReceived))
                FigureTile(label: "With you", value: KarigarPortalRules.grams(a.goldNet), tint: a.goldNet > 0 ? .red : .primary)
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            ForEach(Array(a.ledger.enumerated()), id: \.offset) { _, line in
                goldRow(line)
            }
        } header: {
            Label("Gold", systemImage: "scalemass").textCase(nil)
        }
        .houseRows()

        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(Money.pkr(a.totalPaid)).font(.title2.weight(.bold)).monospacedDigit()
                Text("total paid to you").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(a.payments.enumerated()), id: \.offset) { _, payment in
                paymentRow(payment)
            }
        } header: {
            Label("Payments received", systemImage: "banknote").textCase(nil)
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
                .foregroundStyle(l.goldOut != 0 ? Color.red : Color.green)
        }
    }

    private func paymentRow(_ p: KarigarPortalPayment) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(KarigarPortalRules.date(p.date, shortYear: true)).font(.caption).foregroundStyle(.secondary)
                Text(p.description).font(.subheadline)
            }
            Spacer(minLength: 8)
            Text(Money.grouped(p.amount)).font(.subheadline.weight(.semibold)).monospacedDigit()
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
